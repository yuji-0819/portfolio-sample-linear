// 公式LINE の Webhook を受けて、設定したキャラクターとして自動返信するサーバー
import express from "express";
import { messagingApi, middleware, HTTPFetchError } from "@line/bot-sdk";
import { config } from "./config.js";
import { botInfo, errorReply, replyAsFortuneTeller } from "./fortune.js";
import { clearHistory } from "./history.js";
import { cancelConsult, queueConsult, queueSend, startScheduler } from "./scheduler.js";
import { getSettings, offerActive } from "./settings.js";
import { adminRouter } from "./admin/router.js";
import { toLineMessages } from "./line.js";
import { offerCard } from "./offer.js";
import {
  adminNotice,
  handleAdminCommand,
  isAdmin,
  isHumanMode,
  looksLikePurchaseScreenshot,
  purchaseThanksMessage,
  startHumanMode,
} from "./handoff.js";

if (!config.line.channelSecret || !config.line.channelAccessToken) {
  console.error("LINE_CHANNEL_SECRET と LINE_CHANNEL_ACCESS_TOKEN を設定してください（.env.example 参照）");
  process.exit(1);
}

const line = new messagingApi.MessagingApiClient({ channelAccessToken: config.line.channelAccessToken });
const blob = new messagingApi.MessagingApiBlobClient({ channelAccessToken: config.line.channelAccessToken });
const RESET_WORDS = new Set(["リセット", "りせっと", "reset"]);
const text = (t) => ({ type: "text", text: t });

// まず無料のリプライで送り、返信トークンが期限切れならプッシュで送り直す
async function sendTo({ replyToken, to }, messages) {
  if (replyToken) {
    try {
      await line.replyMessage({ replyToken, messages });
      return "reply";
    } catch (err) {
      if (!(err instanceof HTTPFetchError) || !to) throw err;
    }
  }
  await line.pushMessage({ to, messages });
  return "push";
}

function showLoading(sourceType, userId) {
  // 1対1トークでは「入力中…」のアニメーションを出す（グループでは使えない）
  if (sourceType === "user") {
    line.showLoadingAnimation({ chatId: userId, loadingSeconds: 60 }).catch(() => {});
  }
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function imageMediaType(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return "image/jpeg";
}

async function notifyAdmin(message) {
  if (!config.adminUserId) {
    console.warn("[admin] ADMIN_USER_ID が未設定のため通知できません:\n" + message);
    return;
  }
  await line.pushMessage({ to: config.adminUserId, messages: [text(message)] }).catch((err) => {
    console.error("[admin] 通知に失敗:", err.status ?? err, err.body ?? "");
  });
}

// 画像：購入完了スクショなら有人対応へ切り替える。それ以外はふつうの相談として返信を予約
async function handleImage(event, convoId) {
  const consult = (text) =>
    queueConsult({
      convoId,
      userId: event.source.userId,
      sourceType: event.source.type,
      text,
      replyToken: event.replyToken,
      markAsReadToken: event.message.markAsReadToken,
    });

  if (!offerActive() || event.source.type !== "user") return consult("（画像が送られてきました）");

  let check = { is_purchase_complete: false, item_name: "" };
  try {
    const buf = await readStream(await blob.getMessageContent(event.message.id));
    check = await looksLikePurchaseScreenshot(buf, imageMediaType(buf));
  } catch (err) {
    console.error("[image] 判定に失敗:", err);
  }
  if (!check.is_purchase_complete) {
    return consult("（画像が送られてきました。有料サービスの購入完了画面ではないようです）");
  }

  const caseNo = startHumanMode(convoId);
  cancelConsult(convoId);
  queueSend({
    convoId,
    userId: event.source.userId,
    replyToken: event.replyToken,
    messages: toLineMessages(purchaseThanksMessage()),
  });
  const displayName = await line
    .getProfile(event.source.userId)
    .then((p) => p.displayName)
    .catch(() => "（取得できず）");
  console.log(`[handoff] 受付番号 ${caseNo} → 有人対応へ`);
  await notifyAdmin(adminNotice({ caseNo, displayName, itemName: check.item_name, id: convoId }));
}

const NON_TEXT_LABEL = {
  sticker: "（スタンプが送られてきました）",
  video: "（動画が送られてきました）",
  audio: "（音声メッセージが送られてきました）",
  file: "（ファイルが送られてきました）",
  location: "（位置情報が送られてきました）",
};

async function handleEvent(event) {
  const userId = event.source.userId;
  const convoId = event.source.groupId ?? event.source.roomId ?? userId;

  if (event.type === "follow") {
    return line.replyMessage({ replyToken: event.replyToken, messages: toLineMessages(getSettings().messages.welcome) });
  }
  if (event.type !== "message" || !convoId) return;

  // 運営者（占い師本人）からの管理コマンド
  if (event.source.type === "user" && isAdmin(userId) && event.message.type === "text") {
    const result = handleAdminCommand(event.message.text);
    if (result) return line.replyMessage({ replyToken: event.replyToken, messages: [text(result)] });
  }

  // 有人対応中は AI は返信しない（運営者が LINE のチャット画面から直接返信する）
  if (isHumanMode(convoId)) return;

  if (event.message.type === "image") return handleImage(event, convoId);

  if (event.message.type === "text") {
    const userText = event.message.text.trim();
    if (RESET_WORDS.has(userText.toLowerCase())) {
      clearHistory(convoId);
      cancelConsult(convoId);
      return line.replyMessage({
        replyToken: event.replyToken,
        messages: toLineMessages(getSettings().messages.reset),
      });
    }
  }

  const userText =
    event.message.type === "text" ? event.message.text.trim() : NON_TEXT_LABEL[event.message.type] ?? "（メッセージが送られてきました）";
  const dueAt = queueConsult({
    convoId,
    userId,
    sourceType: event.source.type,
    text: userText,
    replyToken: event.replyToken,
    markAsReadToken: event.message.markAsReadToken,
  });
  console.log(`[queue] ${convoId.slice(0, 8)}… 返信予定 ${new Date(dueAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`);
}

// 予約した相談に返信する（予約時刻に呼ばれる）
async function replyToConsult(job) {
  if (isHumanMode(job.convoId)) return;
  const to = job.sourceType === "user" ? job.userId : job.convoId;
  showLoading(job.sourceType, job.userId);
  let reply;
  try {
    reply = await replyAsFortuneTeller(job.convoId, job.items.map((i) => i.text).join("\n"), {
      waitedMinutes: Math.round((Date.now() - job.receivedAt) / 60_000),
      messageCount: job.items.length,
    });
  } catch (err) {
    console.error("[claude] error:", err);
    reply = { text: errorReply(), offer: false };
  }
  if (isHumanMode(job.convoId)) return; // 考えている間に購入スクショが届いた場合
  const messages = reply.offer
    ? [...toLineMessages(reply.text, { maxMessages: 4 }), offerCard()]
    : toLineMessages(reply.text);
  const via = await sendTo({ replyToken: job.replyToken, to }, messages);
  console.log(`[send] ${job.convoId.slice(0, 8)}… ${messages.length}吹き出し (${via})`);
}

startScheduler({
  markRead: (tokens) => {
    for (const markAsReadToken of tokens) {
      line.markMessagesAsReadByToken({ markAsReadToken }).catch((err) => {
        console.warn("[line] 既読をつけられませんでした:", err.status ?? err.message);
      });
    }
  },
  onConsult: replyToConsult,
  onSend: async (job) => {
    const via = await sendTo({ replyToken: job.replyToken, to: job.userId }, job.messages);
    console.log(`[send] ${job.convoId.slice(0, 8)}… お礼メッセージ (${via})`);
  },
});

const app = express();

app.get("/", (_req, res) => res.send("LINE bot is running"));

// 管理画面（設定の編集・テスト会話）
app.use("/admin", adminRouter());

// 署名検証は middleware が行う。express.json() より前に置くこと
app.post("/webhook", middleware({ channelSecret: config.line.channelSecret }), (req, res) => {
  // LINE には先に 200 を返し、返信は裏で作る（Webhook のタイムアウト対策）
  res.sendStatus(200);
  for (const event of req.body.events ?? []) {
    handleEvent(event).catch((err) => console.error("[webhook] event failed:", err));
  }
});

app.use((err, _req, res, _next) => {
  console.error("[webhook] rejected:", err.message);
  res.sendStatus(err.name === "SignatureValidationFailed" ? 401 : 400);
});

app.listen(config.port, () => {
  const info = botInfo();
  const t = getSettings().timing;
  console.log(`listening on :${config.port}  (webhook: POST /webhook, 管理画面: /admin)`);
  console.log(`アカウント: ${info.name || "（未設定）"}  model=${config.claude.model} effort=${getSettings().account.effort}`);
  console.log(`メニュー: ${info.methods.join(", ") || "（指定なし）"}  道具: ${info.tools.join(", ") || "なし"}`);
  console.log(`有料サービスの案内: ${info.offer ? "オン" : "オフ"}  運営者通知: ${config.adminUserId ? "オン" : "オフ（ADMIN_USER_ID 未設定）"}  管理画面: ${config.adminPassword ? "オン" : "オフ（ADMIN_PASSWORD 未設定）"}`);
  console.log(`返信までの時間: ${t.minMinutes}〜${t.maxMinutes}分（待ち1件ごとに+${t.perPendingMinutes}分）  深夜休み: ${t.quietEnabled ? `${t.quietStart}時〜${t.quietEnd}時` : "なし"}`);
});
