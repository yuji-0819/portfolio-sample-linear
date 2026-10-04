// 有料サービスの案内：出してよいかの判定・AI への誘導指示・案内カード
import { getSettings, offerActive } from "./settings.js";
import { getClient, updateClient } from "./store.js";

const DAY = 24 * 60 * 60 * 1000;

// 命に関わる言葉（見つけたら一定期間、案内を止める）
const CRISIS_WORDS = ["死にたい", "しにたい", "消えたい", "自殺", "生きていたくない", "生きてる意味", "生きる意味がない", "リスカ", "リストカット", "自傷", "楽になりたい"];
export const isCrisisText = (text) => CRISIS_WORDS.some((w) => text.includes(w));
export function noteCrisisSignals(id, text) {
  if (isCrisisText(text)) updateClient(id, { lastCrisisAt: Date.now() });
}

export function countUserTurn(id) {
  updateClient(id, (c) => ({ userTurns: c.userTurns + 1 }));
}

const CONFIRM_VALID_MS = 48 * 60 * 60 * 1000; // 意思確認の質問が有効な時間

/**
 * 案内カードを出してよいか（最終判断はプログラム側）
 * 本人から希望した場合を除き、必ず「意思確認の質問 → 相談者がはっきり YES」の順を踏ませる。
 * 戻り値: { ok: true } / { ok: false, why } / { ok: false, next: "ask_confirmation" }
 */
export function checkOffer(id, { requestedByUser, userAffirmed }) {
  const settings = getSettings();
  if (!offerActive(settings)) return { ok: false, why: "案内機能がオフ" };
  const rules = settings.offerRules;
  const c = getClient(id);
  const now = Date.now();
  if (c.mode === "human") return { ok: false, why: "有人対応中" };
  const crisisWindow = requestedByUser ? DAY : rules.crisisBlockDays * DAY;
  if (now - c.lastCrisisAt < crisisWindow) return { ok: false, why: "心が不安定な時期のため案内しない" };
  if (requestedByUser) return { ok: true };
  if (c.userTurns < rules.minTurns) return { ok: false, why: "まだ信頼関係を築く段階" };
  const cooldownMs = rules.cooldownDays * DAY;
  const last = c.offers.at(-1) ?? 0;
  if (now - last < cooldownMs) return { ok: false, why: "最近すでに案内済み" };
  if (!rules.requireConfirmation) return { ok: true };

  const asked = c.confirmAskedAt && now - c.confirmAskedAt < CONFIRM_VALID_MS;
  if (asked && userAffirmed) return { ok: true };
  if (asked) return { ok: false, why: "意思確認の質問に、相談者がまだはっきり YES と答えていない" };
  // 意思確認は一度したら、断られても同じ期間は繰り返さない
  if (now - (c.confirmAskedAt || 0) < cooldownMs) return { ok: false, why: "最近すでに意思確認済み" };
  updateClient(id, { confirmAskedAt: now });
  return { ok: false, next: "ask_confirmation" };
}

export function recordOffer(id) {
  updateClient(id, (c) => ({ offers: [...c.offers, Date.now()].slice(-20), confirmAskedAt: 0 }));
}

// 各メッセージに添える、この相談者の状況（AI がタイミングを判断する材料）
export function offerContextLine(id) {
  if (!offerActive()) return "";
  const c = getClient(id);
  const parts = [`相談回数: ${c.userTurns}回`];
  const last = c.offers.at(-1);
  parts.push(last ? `有料サービスの案内: ${Math.floor((Date.now() - last) / DAY)}日前に案内済み` : "有料サービスの案内: まだ");
  if (c.confirmAskedAt && Date.now() - c.confirmAskedAt < CONFIRM_VALID_MS) {
    parts.push(`意思確認の質問: ${Math.max(1, Math.round((Date.now() - c.confirmAskedAt) / 60000))}分前に質問済み（その質問への相談者の返事に注目）`);
  }
  if (c.purchases.length) parts.push(`有料サービスの購入歴: ${c.purchases.length}回`);
  return `[相談者の状況: ${parts.join(" / ")}]`;
}

export const offerTool = {
  name: "offer_chat_reading",
  description:
    "有料サービスへの誘導を申請する。プログラムが条件を確認し、結果に応じて (1) next=ask_confirmation: 今回の返信で意思確認の質問をする (2) approved=true: 返信のあとに案内カードが表示される (3) approved=false: 案内に触れず鑑定を続ける、のどれかを返す。<offer> の手順に当てはまるときだけ使うこと。",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      stage: {
        type: "string",
        enum: ["深掘りしたい", "意思確認にYES", "本人から希望"],
        description: "相談者の今の段階",
      },
      reason: { type: "string", description: "そう判断した理由（相談者の言葉を根拠に短く）" },
      requested_by_user: {
        type: "boolean",
        description: "相談者自身が有料サービス・料金について尋ねた、または希望した場合 true",
      },
      user_affirmed: {
        type: "boolean",
        description:
          "直前にあなたがした意思確認の質問に、相談者が今回のメッセージで『知りたい』『動きたい』『お願いしたい』などはっきり前向きに答えた場合 true。迷い・保留・否定・話題が変わった場合は false",
      },
    },
    required: ["stage", "reason", "requested_by_user", "user_affirmed"],
    additionalProperties: false,
  },
};

/** AI への誘導の指示（設定の「誘導の手順」に、商品情報を添える） */
export function offerPromptSection(settings = getSettings()) {
  if (!offerActive(settings)) return "";
  const o = settings.offer;
  const guide = o.guide.replaceAll("{商品名}", o.name).replaceAll("{価格}", o.price || "（価格は案内カードに記載）");
  const confirmNote = settings.offerRules.requireConfirmation
    ? ""
    : "\n※ この設定では意思確認は不要です。offer_chat_reading を申請すると、条件を満たせばすぐ approved=true になります。";
  return `<offer>
このアカウントの運営者本人が対応する有料サービス「${o.name}」${o.price ? `（${o.price}）` : ""}があります。

${o.description}

申込みの流れ:
${o.steps}

${guide}${confirmNote}
</offer>`;
}

/** 案内カード（LINE の Flex メッセージ） */
export function offerCard(settings = getSettings()) {
  const o = settings.offer;
  const body = [];
  if (o.cardLabel) body.push({ type: "text", text: o.cardLabel, size: "sm", color: o.color, weight: "bold" });
  body.push({ type: "text", text: o.name, size: "lg", weight: "bold", wrap: true, margin: "sm" });
  if (o.price) body.push({ type: "text", text: o.price, size: "md", color: "#555555", margin: "sm" });
  if (o.cardNote) {
    body.push(
      { type: "separator", margin: "md" },
      { type: "text", text: o.cardNote, size: "xs", color: "#777777", wrap: true, margin: "md" },
    );
  }
  return {
    type: "flex",
    altText: `${o.name}のご案内`,
    contents: {
      type: "bubble",
      ...(/^https:\/\//.test(o.imageUrl)
        ? { hero: { type: "image", url: o.imageUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover" } }
        : {}),
      body: { type: "box", layout: "vertical", contents: body },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [{ type: "button", style: "primary", color: o.color, action: { type: "uri", label: o.buttonLabel, uri: o.url } }],
      },
    },
  };
}
