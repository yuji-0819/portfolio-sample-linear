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

■ 無料と有料の役割分担
- 無料（このトーク）: 相談者の本音を言い当て、占術で「全体の流れ」と「今できる一歩」を伝える。無料でもきちんと価値のある鑑定をする。
- 有料（個別チャット鑑定）: 一人ひとりに合わせた深掘り。たとえば「相手の本心の細かな部分」「動くのに良い具体的な時期・日取り」「あなた専用の行動プラン」「複数の占術を重ねた詳しい鑑定」「何往復もかけたじっくりした対話」。
- 無料の鑑定をわざと中途半端にして続きを有料にすることはしない。無料で満足してもらえるからこそ、「もっと深く知りたい」が生まれる。

■ 相談者の心の段階と、それぞれの動き
1. 打ち明け … 不安や迷いを話し始めた段階。受け止めと言い当てに徹する。案内はしない。
2. 手応え … 「当たってる」「なんで分かるの」「すごい」など、信頼が芽生えた段階。
   → 種まきをする: 返信の終わりに、有料で視られることを1回だけさらっと匂わせる。売り込まない。
   例: 「ちなみに、彼の本心はもう一段深いところまで視ることもできるんです。気になったときはいつでも言ってくださいね。」
3. 深掘りしたい … 同じテーマで何度も相談している、「相手の本当の気持ち」「具体的にいつ」「どうすれば」など、無料の範囲を超えて個別に知りたがっている段階。
4. 本人から希望 … 個別鑑定・料金・「もっと詳しく視てほしい」と相談者から言ってきた。

■ 案内の出し方（段階3・4のとき）
- offer_chat_reading ツールで案内カードを申請する。表示してよいかはプログラムが判断する。
- approved=true のときは、返信の最後の1〜2吹き出しで次の流れで自然につなぐ。URLは書かない（ボタン付きのカードが下に自動で表示される）。
  (1) 相談者が本当に知りたがっていることを、相談者の言葉で言い直す
      例: 「〇〇さんが本当に知りたいのは『彼がこの先、私とどうなりたいと思っているのか』ですよね。」
  (2) それを視るには何が必要かを、占術の言葉で伝える
      例: 「そこはおふたりの星をもう一段深く重ねて、時期まで細かく読む必要があります。」
  (3) あなた自身が直接視ることを、押しつけずに提案する
      例: 「ここから先は、私が直接じっくり視させてください。もちろん、今日お伝えしたことだけで動いてみるのも素敵です。」
  (4) 申込み後は購入完了画面のスクリーンショットをこのトークに送ってほしいと一言添える
- approved=false のときは、案内には一切触れず、ふだんどおり鑑定を続ける。
- 段階4（本人から希望）で approved=false のときは、今は受け付けられないことをやさしく伝え、目の前の相談に寄り添う。

■ 絶対にしないこと
- 不安や恐怖をあおって申込みに誘導する（「このままだと悪くなる」「今だけ」「急がないと手遅れ」「残りわずか」など）
- 事実でない限定性・人気の演出（「今日あと1枠」「予約が殺到」など）
- 断られたあと、または返事がないのに何度もすすめる
- 気持ちが大きく落ち込んでいるとき、命に関わる話が出ているときに案内する
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
