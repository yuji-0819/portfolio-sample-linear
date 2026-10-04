// 購入スクショの確認 → 有人対応への切り替え → 運営者への通知・管理コマンド
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod";
import { config } from "./config.js";
import { getSettings } from "./settings.js";
import { findByCaseNo, getClient, listHuman, nextCaseNo, updateClient } from "./store.js";

const client = new Anthropic();

const ScreenshotCheck = z.object({
  is_purchase_complete: z.boolean(),
  item_name: z.string(),
});

/** 画像が購入完了画面（注文完了・注文確認メールなど）に見えるかを判定する */
export async function looksLikePurchaseScreenshot(imageBuffer, mediaType) {
  const offer = getSettings().offer;
  const response = await client.beta.messages.parse({
    model: config.claude.model,
    max_tokens: 2000,
    output_config: { effort: "low", format: betaZodOutputFormat(ScreenshotCheck) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBuffer.toString("base64") } },
          {
            type: "text",
            text: `この画像は、ネットショップ「${offer.shop}」での購入（注文）が完了したことを示す画面またはメールのスクリーンショットですか？
対象商品: ${offer.name}
is_purchase_complete: 注文完了画面・注文確認メールなど購入が済んだことが読み取れれば true。カート画面や商品ページ、無関係な画像は false。
item_name: 画像から読み取れる商品名（読めなければ空文字）`,
          },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return { is_purchase_complete: false, item_name: "" };
  return response.parsed_output;
}

/** 有人対応に切り替え、受付番号を返す */
export function startHumanMode(id) {
  const caseNo = nextCaseNo();
  updateClient(id, (c) => ({
    mode: "human",
    caseNo,
    humanSince: Date.now(),
    purchases: [...c.purchases, Date.now()],
  }));
  return caseNo;
}

export function isHumanMode(id) {
  return getClient(id).mode === "human";
}

export function purchaseThanksMessage() {
  return getSettings().offer.thanks || "お申込みありがとうございます。順番にお返事しますので、少しお待ちください。";
}

/** 運営者への通知文 */
export function adminNotice({ caseNo, displayName, itemName, id }) {
  const recent = getClient(id)
    .history.filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => `・${String(m.content).replace(/^\[.*\]\n/gm, "").slice(0, 80)}`)
    .join("\n");
  return [
    `【${getSettings().offer.name} 申込】受付番号 ${caseNo}`,
    `お名前: ${displayName}`,
    itemName ? `画像の商品名: ${itemName}` : null,
    "",
    "最近の相談:",
    recent || "（履歴なし）",
    "",
    "▼ 対応のしかた",
    `1. ${getSettings().offer.shop} の管理画面で注文が入っているか確認`,
    "2. LINE公式アカウントのチャット画面から、この方に直接返信",
    `3. 鑑定が終わったら、このトークに「#終了 ${caseNo}」と送るとAIの自動返信に戻ります`,
    "（有人対応中は、この方へのAIの返信は止まっています）",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function isAdmin(userId) {
  return Boolean(config.adminUserId) && userId === config.adminUserId;
}

/** 運営者からの管理コマンド。コマンドでなければ null を返す */
export function handleAdminCommand(text) {
  const t = text.replace(/＃/g, "#").trim();
  if (!t.startsWith("#")) return null;

  if (/^#(一覧|いちらん)$/.test(t)) {
    const list = listHuman();
    if (!list.length) return "有人対応中の方はいません。";
    return [
      `有人対応中: ${list.length}件`,
      ...list.map((c) => `・受付番号 ${c.caseNo}（${new Date(c.humanSince).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}〜）`),
    ].join("\n");
  }

  const end = t.match(/^#終了\s*(\d+)$/);
  if (end) {
    const caseNo = Number(end[1]);
    const id = findByCaseNo(caseNo);
    if (!id) return `受付番号 ${caseNo} の有人対応は見つかりませんでした。「#一覧」で確認できます。`;
    updateClient(id, { mode: "ai", caseNo: null, humanSince: 0 });
    return `受付番号 ${caseNo} の対応を終了しました。この方には再びAIが自動返信します。`;
  }

  return "管理コマンド:\n#一覧 … 有人対応中の一覧\n#終了 番号 … 有人対応を終えてAI返信に戻す";
}
