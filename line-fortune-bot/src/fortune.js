// Claude にキャラクターとして返信を作ってもらう
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { buildSystemPrompt } from "./prompt.js";
import { runTool, toolSchemas, toolsFor } from "./tools.js";
import { appendTurn, getHistory } from "./history.js";
import { getSettings, offerActive, settingsRevision } from "./settings.js";
import {
  checkOffer,
  countUserTurn,
  noteCrisisSignals,
  offerContextLine,
  offerPromptSection,
  offerTool,
  recordOffer,
} from "./offer.js";

const client = new Anthropic();

// 設定が変わったときだけ指示文を作り直す（同じ内容ならプロンプトキャッシュが効く）
let built = { revision: -1 };
function current() {
  const revision = settingsRevision();
  if (built.revision !== revision) {
    const s = getSettings();
    const methods = s.methods.filter((m) => m.enabled);
    const tools = [...toolSchemas(toolsFor(methods)), ...(offerActive(s) ? [offerTool] : [])];
    built = { revision, settings: s, system: buildSystemPrompt(s, [offerPromptSection(s)]), tools };
  }
  return built;
}

export function botInfo() {
  const { settings, tools } = current();
  return {
    name: settings.account.name,
    methods: settings.methods.filter((m) => m.enabled).map((m) => m.name),
    tools: tools.map((t) => t.name),
    offer: offerActive(settings),
  };
}

export const errorReply = () => getSettings().messages.error;

const MAX_TOOL_ROUNDS = 5;

function stamp(date = new Date()) {
  const s = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `[受信日時: ${s} 日本時間]`;
}

// 返信までの時間（「お待たせしました」などを自然に入れる材料）
function timingLine(waitedMinutes, messageCount) {
  if (!waitedMinutes && messageCount <= 1) return "";
  const parts = [];
  if (waitedMinutes) {
    parts.push(waitedMinutes >= 60 ? `最初のメッセージから約${Math.round(waitedMinutes / 60)}時間後に返信` : `最初のメッセージから約${waitedMinutes}分後に返信`);
  }
  if (messageCount > 1) parts.push(`返信までに相談者から${messageCount}通`);
  return `[返信のタイミング: ${parts.join(" / ")}]`;
}

// フォールバックが途中で起きた場合、境界より前の thinking / tool_use は送り返さない
function echoable(content) {
  const boundary = content.findLastIndex((b) => b.type === "fallback");
  if (boundary < 0) return content;
  return content.filter(
    (b, i) => i > boundary || !["thinking", "redacted_thinking", "tool_use", "fallback"].includes(b.type),
  );
}

async function callClaude({ system, tools, settings }, messages) {
  return client.beta.messages.create({
    model: config.claude.model,
    max_tokens: 16000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    ...(tools.length ? { tools } : {}),
    messages,
    output_config: { effort: settings.account.effort },
    // 安全分類器に止められた場合、サーバー側で別モデルに自動で引き継ぐ
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
}

// 案内カードの申請：出してよいかはプログラムが判定する
function handleOfferRequest(userId, input, state) {
  if (state.offer) return { approved: true, note: "この返信ではすでに承認済み" };
  const check = checkOffer(userId, {
    requestedByUser: Boolean(input?.requested_by_user),
    userAffirmed: Boolean(input?.user_affirmed),
  });
  const result = check.ok ? "承認（案内カードを表示）" : check.next ? "意思確認の質問をするよう指示" : `却下（${check.why}）`;
  state.events.push(`案内の申請［${input?.stage ?? "?"}］→ ${result}`);
  console.log(`[offer] ${userId} stage=${input?.stage} affirmed=${input?.user_affirmed} → ${result} / ${input?.reason ?? ""}`);
  if (check.next === "ask_confirmation") {
    return {
      approved: false,
      next: "ask_confirmation",
      instruction:
        "まだカードは出さない。今回の返信は <offer> の『フック＋意思確認』の3拍子（ズバッと言い切る → 根拠を1つ → 本人の意思を確かめる問いで終える）で組み立てること。商品名・価格はまだ出さない。",
    };
  }
  if (!check.ok) return { approved: false, reason: check.why };
  state.offer = true;
  return { approved: true };
}

/**
 * 相談者のメッセージに対する返信を作る。
 * 戻り値 { text, offer, events } … offer が true なら返信のあとに案内カードを出す。events は判断の記録
 * 会話履歴・相談回数の記録もここで行う。
 */
export async function replyAsFortuneTeller(userId, userText, { waitedMinutes = 0, messageCount = 1 } = {}) {
  const ctx = current();
  const { messages: texts } = ctx.settings;
  noteCrisisSignals(userId, userText);
  countUserTurn(userId);
  const lines = [stamp(), timingLine(waitedMinutes, messageCount), offerContextLine(userId)].filter(Boolean);
  const userContent = `${lines.join("\n")}\n${userText}`;
  const state = { offer: false, events: [] };
  const messages = [...getHistory(userId), { role: "user", content: userContent }];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await callClaude(ctx, messages);

    if (response.stop_reason === "refusal") {
      console.warn("[claude] refusal", response.stop_details?.category ?? "");
      state.events.push("AIが応答を控えました（定型文で返信）");
      return { text: texts.refusal, offer: false, events: state.events };
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason === "tool_use" && toolUses.length) {
      messages.push({ role: "assistant", content: echoable(response.content) });
      messages.push({
        role: "user",
        content: toolUses.map((use) => {
          try {
            const result =
              use.name === offerTool.name ? handleOfferRequest(userId, use.input, state) : runTool(use.name, use.input);
            if (use.name !== offerTool.name) state.events.push(`道具「${use.name}」の結果: ${JSON.stringify(result)}`);
            console.log(`[tool] ${use.name}`, JSON.stringify(result));
            return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result) };
          } catch (err) {
            return { type: "tool_result", tool_use_id: use.id, content: String(err.message ?? err), is_error: true };
          }
        }),
      });
      continue;
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) {
      console.warn("[claude] empty reply", response.stop_reason);
      return { text: texts.error, offer: false, events: state.events };
    }
    if (response.stop_reason === "max_tokens") console.warn("[claude] reply hit max_tokens");

    appendTurn(userId, userContent, text);
    if (state.offer) recordOffer(userId);
    return { text, offer: state.offer, events: state.events };
  }

  console.warn("[claude] too many tool rounds");
  return { text: texts.error, offer: false, events: state.events };
}
