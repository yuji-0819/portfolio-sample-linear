// 公式LINE の Webhook を受けて、占い師として自動返信するサーバー
import express from "express";
import { messagingApi, middleware, HTTPFetchError } from "@line/bot-sdk";
import { config } from "./config.js";
import { FALLBACK_REPLY, fortuneInfo, replyAsFortuneTeller } from "./fortune.js";
import { clearHistory } from "./history.js";
import { loadWelcomeMessage } from "./prompt.js";
import { toLineMessages } from "./line.js";
import { offerCard, offerEnabled } from "./offer.js";
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
const welcome = loadWelcomeMessage();
const RESET_WORDS = new Set(["リセット", "りせっと", "reset"]);
const text = (t) => ({ type: "text", text: t });

// 同じ人から続けて送られたメッセージは順番に処理する（会話履歴が混ざらないように）
const queues = new Map();
function enqueue(key, task) {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task).finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  queues.set(key, next);
  return next;
}

// 返信トークンの期限切れなどで reply が失敗したら push で送り直す
async function send(event, messages) {
  try {
    await line.replyMessage({ replyToken: event.replyToken, messages });
  } catch (err) {
    const to = event.source.groupId ?? event.source.roomId ?? event.source.userId;
    if (!(err instanceof HTTPFetchError) || !to) throw err;
    console.warn("[line] reply failed, falling back to push:", err.status, err.body);
    await line.pushMessage({ to, messages });
  }
}

function showLoading(event) {
  // 1対1トークでは「入力中…」のアニメーションを出す（グループでは使えない）
  if (event.source.type === "user") {
    line.showLoadingAnimation({ chatId: event.source.userId, loadingSeconds: 60 }).catch(() => {});
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

// 画像：購入完了スクショなら有人対応へ切り替える
async function handleImage(event, convoId) {
  if (!offerEnabled || event.source.type !== "user") {
    return send(event, [text("ありがとうございます🌙\nご相談はぜひ文字で送ってくださいね。")]);
  }
  showLoading(event);
  let check = { is_purchase_complete: false, item_name: "" };
  try {
    const buf = await readStream(await blob.getMessageContent(event.message.id));
    check = await looksLikePurchaseScreenshot(buf, imageMediaType(buf));
  } catch (err) {
    console.error("[image] 判定に失敗:", err);
  }
  if (!check.is_purchase_complete) {
    return send(event, [
      text(
        "画像ありがとうございます🌙\n\n個別鑑定をお申込みいただいた方は、BASEの「注文完了」画面のスクリーンショットを送ってくださいね。\n\nご相談はぜひ文字で送ってください。",
      ),
    ]);
  }

  const caseNo = startHumanMode(convoId);
  await send(event, toLineMessages(purchaseThanksMessage()));
  const displayName = await line
    .getProfile(event.source.userId)
    .then((p) => p.displayName)
    .catch(() => "（取得できず）");
  console.log(`[handoff] 受付番号 ${caseNo} → 有人対応へ`);
  await notifyAdmin(adminNotice({ caseNo, displayName, itemName: check.item_name, id: convoId }));
}

async function handleEvent(event) {
  const userId = event.source.userId;
  const convoId = event.source.groupId ?? event.source.roomId ?? userId;

  if (event.type === "follow") {
    return line.replyMessage({ replyToken: event.replyToken, messages: [text(welcome)] });
  }
  if (event.type !== "message" || !convoId) return;

  // 運営者（占い師本人）からの管理コマンド
  if (event.source.type === "user" && isAdmin(userId) && event.message.type === "text") {
    const result = handleAdminCommand(event.message.text);
    if (result) return line.replyMessage({ replyToken: event.replyToken, messages: [text(result)] });
  }

  // 有人対応中は AI は返信しない（運営者が LINE のチャット画面から直接返信する）
  if (isHumanMode(convoId)) return;

  if (event.message.type === "image") return enqueue(convoId, () => handleImage(event, convoId));

  if (event.message.type !== "text") {
    return line.replyMessage({
      replyToken: event.replyToken,
      messages: [text("ありがとうございます🌙\nご相談はぜひ文字で送ってくださいね。")],
    });
  }

  const userText = event.message.text.trim();
  if (RESET_WORDS.has(userText.toLowerCase())) {
    clearHistory(convoId);
    return line.replyMessage({
      replyToken: event.replyToken,
      messages: [text("これまでのお話をリセットしました✨\n新しいご相談をどうぞ。")],
    });
  }

  return enqueue(convoId, async () => {
    if (isHumanMode(convoId)) return;
    showLoading(event);
    let reply;
    try {
      reply = await replyAsFortuneTeller(convoId, userText);
    } catch (err) {
      console.error("[claude] error:", err);
      reply = { text: FALLBACK_REPLY, offer: false };
    }
    const messages = reply.offer
      ? [...toLineMessages(reply.text, { maxMessages: 4 }), offerCard()]
      : toLineMessages(reply.text);
    await send(event, messages);
  });
}

const app = express();

app.get("/", (_req, res) => res.send("LINE fortune bot is running"));

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
  console.log(`listening on :${config.port}  (webhook: POST /webhook)`);
  console.log(`model=${config.claude.model} effort=${config.claude.effort}`);
  console.log(`占術: ${fortuneInfo.methods.join(", ") || "（指定なし）"}  道具: ${fortuneInfo.tools.join(", ") || "なし"}`);
  console.log(`有料鑑定の案内: ${fortuneInfo.offer ? "オン" : "オフ"}  運営者通知: ${config.adminUserId ? "オン" : "オフ（ADMIN_USER_ID 未設定）"}`);
});
