// 公式LINE の Webhook を受けて、占い師として自動返信するサーバー
import express from "express";
import { messagingApi, middleware, HTTPFetchError } from "@line/bot-sdk";
import { config } from "./config.js";
import { FALLBACK_REPLY, fortuneInfo, replyAsFortuneTeller } from "./fortune.js";
import { clearHistory } from "./history.js";
import { loadWelcomeMessage } from "./prompt.js";
import { toLineMessages } from "./line.js";

if (!config.line.channelSecret || !config.line.channelAccessToken) {
  console.error("LINE_CHANNEL_SECRET と LINE_CHANNEL_ACCESS_TOKEN を設定してください（.env.example 参照）");
  process.exit(1);
}

const line = new messagingApi.MessagingApiClient({ channelAccessToken: config.line.channelAccessToken });
const welcome = loadWelcomeMessage();
const RESET_WORDS = new Set(["リセット", "りせっと", "reset"]);

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

async function handleEvent(event) {
  const userId = event.source.userId;
  const convoId = event.source.groupId ?? event.source.roomId ?? userId;

  if (event.type === "follow") {
    return line.replyMessage({ replyToken: event.replyToken, messages: [{ type: "text", text: welcome }] });
  }
  if (event.type !== "message" || !convoId) return;

  if (event.message.type !== "text") {
    return line.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: "ありがとうございます🌙\nご相談はぜひ文字で送ってくださいね。" }],
    });
  }

  const text = event.message.text.trim();
  if (RESET_WORDS.has(text.toLowerCase())) {
    clearHistory(convoId);
    return line.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: "これまでのお話をリセットしました✨\n新しいご相談をどうぞ。" }],
    });
  }

  return enqueue(convoId, async () => {
    // 1対1トークでは「入力中…」のアニメーションを出す（グループでは使えない）
    if (event.source.type === "user") {
      line.showLoadingAnimation({ chatId: userId, loadingSeconds: 60 }).catch(() => {});
    }
    let reply;
    try {
      reply = await replyAsFortuneTeller(convoId, text);
    } catch (err) {
      console.error("[claude] error:", err);
      reply = FALLBACK_REPLY;
    }
    await send(event, toLineMessages(reply));
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
});
