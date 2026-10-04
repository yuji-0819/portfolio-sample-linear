// 個別チャット鑑定（有料）の案内：設定の読み込み・出してよいかの判定・案内カード
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { FORTUNE_DIR, parseFrontMatter } from "./prompt.js";
import { getClient, updateClient } from "./store.js";

const DAY = 24 * 60 * 60 * 1000;

function loadOffer() {
  const file = path.join(FORTUNE_DIR, "offer.md");
  if (!fs.existsSync(file)) return null;
  const { meta, body } = parseFrontMatter(fs.readFileSync(file, "utf8"));
  const section = (title) =>
    body.match(new RegExp(`##\\s*${title}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`))?.[1].trim() ?? "";
  return {
    name: meta.name || "個別チャット鑑定",
    price: meta.price || "",
    baseUrl: meta.base_url || "",
    imageUrl: meta.image_url || "",
    description: section("鑑定の内容"),
    steps: section("申込みの流れ"),
    thanks: section("購入スクショを受け取ったときの返信"),
  };
}

export const offer = loadOffer();
export const offerEnabled = Boolean(offer?.baseUrl?.startsWith("https://"));
if (offer && !offerEnabled) console.warn("[offer] fortune/offer.md の base_url が未設定のため、有料鑑定の案内はオフです");

// 命に関わる言葉（見つけたら一定期間、案内を止める）
const CRISIS_WORDS = ["死にたい", "しにたい", "消えたい", "自殺", "生きていたくない", "生きてる意味", "生きる意味がない", "リスカ", "リストカット", "自傷", "楽になりたい"];
export function noteCrisisSignals(id, text) {
  if (CRISIS_WORDS.some((w) => text.includes(w))) updateClient(id, { lastCrisisAt: Date.now() });
}

export function countUserTurn(id) {
  updateClient(id, (c) => ({ userTurns: c.userTurns + 1 }));
}

/** 案内カードを出してよいか。理由つきで返す（最終判断はプログラム側） */
export function checkOffer(id, { requestedByUser }) {
  if (!offerEnabled) return { ok: false, why: "案内機能がオフ" };
  const c = getClient(id);
  const now = Date.now();
  if (c.mode === "human") return { ok: false, why: "有人対応中" };
  const crisisWindow = requestedByUser ? DAY : config.offer.crisisBlockMs;
  if (now - c.lastCrisisAt < crisisWindow) return { ok: false, why: "心が不安定な時期のため案内しない" };
  if (requestedByUser) return { ok: true };
  if (c.userTurns < config.offer.minTurns) return { ok: false, why: "まだ信頼関係を築く段階" };
  const last = c.offers.at(-1) ?? 0;
  if (now - last < config.offer.cooldownMs) return { ok: false, why: "最近すでに案内済み" };
  return { ok: true };
}

export function recordOffer(id) {
  updateClient(id, (c) => ({ offers: [...c.offers, Date.now()].slice(-20) }));
}

// 各メッセージに添える、この相談者の状況（AI がタイミングを判断する材料）
export function offerContextLine(id) {
  if (!offerEnabled) return "";
  const c = getClient(id);
  const parts = [`相談回数: ${c.userTurns}回`];
  const last = c.offers.at(-1);
  parts.push(last ? `個別鑑定の案内: ${Math.floor((Date.now() - last) / DAY)}日前に案内済み` : "個別鑑定の案内: まだ");
  if (c.purchases.length) parts.push(`個別鑑定の購入歴: ${c.purchases.length}回`);
  return `[相談者の状況: ${parts.join(" / ")}]`;
}

export const offerTool = {
  name: "offer_chat_reading",
  description:
    "有料の個別チャット鑑定の案内カードを、この返信のあとに表示するよう申請する。プログラムが条件を確認し、approved=true のときだけカードが表示される。<offer> の『案内してよいタイミング』に当てはまるときだけ使うこと。",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      stage: {
        type: "string",
        enum: ["手応え", "深掘りしたい", "本人から希望"],
        description: "相談者の今の心の段階",
      },
      reason: { type: "string", description: "そう判断した理由（相談者の言葉を根拠に短く）" },
      requested_by_user: {
        type: "boolean",
        description: "相談者自身が個別鑑定・料金・有料鑑定について尋ねた、または希望した場合 true",
      },
    },
    required: ["stage", "reason", "requested_by_user"],
    additionalProperties: false,
  },
};

export function offerPromptSection() {
  if (!offerEnabled) return "";
  return `<offer>
あなた（占い師）本人による有料の「${offer.name}」${offer.price ? `（${offer.price}）` : ""}があります。

${offer.description}

申込みの流れ:
${offer.steps}

相談者の心の段階:
1. 打ち明け … 不安や迷いを話し始めた段階。共感と無料のミニ鑑定に徹し、案内はしない。
2. 手応え … 「当たってる」「なんで分かるの」など信頼が芽生えた段階。「もっと深く視ることもできますよ」と軽く触れる程度。カードは出さない。
3. 深掘りしたい … 同じテーマで何度も相談している、「相手の本当の気持ち」「具体的な時期」「どうすれば」など、より深く個別に知りたがっている段階。
4. 本人から希望 … 相談者が個別鑑定・料金・もっと詳しく視てほしいと自分から言った。

案内してよいタイミング:
- 段階3または4のときだけ、offer_chat_reading ツールで案内カードを申請する。
- 結果が approved=true なら、返信の最後に「ここから先は、私が直接じっくり視させてください」のような自然な一言で個別鑑定を紹介する。URLは書かない（ボタン付きのカードが自動で下に表示される）。申込み後は購入完了画面のスクリーンショットをこのトークに送ってもらうことも伝える。
- approved=false なら、案内には一切触れず、ふだんどおり鑑定を続ける。
- 段階4（本人から希望）で approved=false のときは、今は申込みを受け付けられない旨をやさしく伝え、まずは目の前の相談に寄り添う。

絶対にしないこと:
- 不安や恐怖をあおって申込みに誘導する（「このままだと悪くなる」「今だけ」「急がないと」など）。
- 無料の鑑定をわざと中途半端にして、続きを有料にする。
- 断られたあとに何度もすすめる。
- 気持ちが大きく落ち込んでいるとき、命に関わる話が出ているときに案内する。
</offer>`;
}

export function offerCard() {
  const body = [
    { type: "text", text: "🔮 個別鑑定のご案内", size: "sm", color: "#8E7CC3", weight: "bold" },
    { type: "text", text: offer.name, size: "lg", weight: "bold", wrap: true, margin: "sm" },
  ];
  if (offer.price) body.push({ type: "text", text: offer.price, size: "md", color: "#555555", margin: "sm" });
  body.push(
    { type: "separator", margin: "md" },
    {
      type: "text",
      text: "お申込み後、購入完了画面のスクリーンショットをこのトークに送ってください。占い師本人からお返事します。",
      size: "xs",
      color: "#777777",
      wrap: true,
      margin: "md",
    },
  );
  return {
    type: "flex",
    altText: `${offer.name}のご案内`,
    contents: {
      type: "bubble",
      ...(offer.imageUrl
        ? { hero: { type: "image", url: offer.imageUrl, size: "full", aspectRatio: "20:13", aspectMode: "cover" } }
        : {}),
      body: { type: "box", layout: "vertical", contents: body },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#8E7CC3",
            action: { type: "uri", label: "BASEで申し込む", uri: offer.baseUrl },
          },
        ],
      },
    },
  };
}
