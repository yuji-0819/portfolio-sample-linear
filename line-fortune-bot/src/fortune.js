// Claude に占い師として返信を作ってもらう
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { buildSystemPrompt, loadMethods } from "./prompt.js";
import { runTool, toolSchemas, toolsFor } from "./tools.js";
import { appendTurn, getHistory } from "./history.js";
import {
  checkOffer,
  countUserTurn,
  noteCrisisSignals,
  offerContextLine,
  offerEnabled,
  offerPromptSection,
  offerTool,
  recordOffer,
} from "./offer.js";

const client = new Anthropic();

// 起動時に一度だけ組み立てる（毎回同じ内容にしてプロンプトキャッシュを効かせる）
const methods = loadMethods();
const system = buildSystemPrompt(methods, [offerPromptSection()]);
const tools = [...toolSchemas(toolsFor(methods)), ...(offerEnabled ? [offerTool] : [])];

export const fortuneInfo = {
  methods: methods.map((m) => m.name),
  tools: tools.map((t) => t.name),
  offer: offerEnabled,
};

const MAX_TOOL_ROUNDS = 5;

export const FALLBACK_REPLY =
  "ごめんなさい、いま星の巡りが少し乱れているようです🌙\n少し時間をおいて、もう一度メッセージを送っていただけますか？";
const REFUSAL_REPLY =
  "ごめんなさい、そのご相談はこの場ではお受けすることができません。\nほかに気になっていることがあれば、どうぞ聞かせてくださいね。";

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

async function callClaude(messages) {
  return client.beta.messages.create({
    model: config.claude.model,
    max_tokens: 16000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    ...(tools.length ? { tools } : {}),
    messages,
    output_config: { effort: config.claude.effort },
    // 安全分類器に止められた場合、サーバー側で別モデルに自動で引き継ぐ
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
}

// 案内カードの申請：出してよいかはプログラムが判定する
function handleOfferRequest(userId, input, state) {
  if (state.offer) return { approved: true, note: "この返信ではすでに承認済み" };
  const check = checkOffer(userId, { requestedByUser: Boolean(input?.requested_by_user) });
  console.log(`[offer] ${userId} stage=${input?.stage} approved=${check.ok} ${check.why ?? ""} / ${input?.reason ?? ""}`);
  if (!check.ok) return { approved: false, reason: check.why };
  state.offer = true;
  return { approved: true };
}

/**
 * 相談者のメッセージに対する占い師の返信を返す。
 * { text, offer } … offer が true なら返信のあとに案内カードを出す
 * 会話履歴・相談回数の記録もここで行う。
 */
export async function replyAsFortuneTeller(userId, userText, { waitedMinutes = 0, messageCount = 1 } = {}) {
  noteCrisisSignals(userId, userText);
  countUserTurn(userId);
  const lines = [stamp(), timingLine(waitedMinutes, messageCount), offerContextLine(userId)].filter(Boolean);
  const userContent = `${lines.join("\n")}\n${userText}`;
  const state = { offer: false };
  const messages = [...getHistory(userId), { role: "user", content: userContent }];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await callClaude(messages);

    if (response.stop_reason === "refusal") {
      console.warn("[claude] refusal", response.stop_details?.category ?? "");
      return { text: REFUSAL_REPLY, offer: false };
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
      return { text: FALLBACK_REPLY, offer: false };
    }
    if (response.stop_reason === "max_tokens") console.warn("[claude] reply hit max_tokens");

    appendTurn(userId, userContent, text);
    if (state.offer) recordOffer(userId);
    return { text, offer: state.offer };
  }

  console.warn("[claude] too many tool rounds");
  return { text: FALLBACK_REPLY, offer: false };
}
