// ユーザーごとの会話履歴（メモリ上に保存。サーバー再起動で消える）
// 保存するのは「ユーザーの発言」と「占い師の最終的な返信テキスト」だけ
import { config } from "./config.js";

const store = new Map();

export function getHistory(userId) {
  const entry = store.get(userId);
  if (!entry) return [];
  if (Date.now() - entry.updatedAt > config.history.ttlMs) {
    store.delete(userId);
    return [];
  }
  return entry.messages;
}

export function appendTurn(userId, userText, assistantText) {
  const messages = [
    ...getHistory(userId),
    { role: "user", content: userText },
    { role: "assistant", content: assistantText },
  ];
  // 古い往復から捨てる（必ず user から始まるよう 2 件ずつ）
  const max = config.history.turns * 2;
  store.set(userId, {
    messages: messages.length > max ? messages.slice(messages.length - max) : messages,
    updatedAt: Date.now(),
  });
}

export function clearHistory(userId) {
  store.delete(userId);
}
