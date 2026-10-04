// ユーザーごとの会話履歴
// 保存するのは「ユーザーの発言」と「占い師の最終的な返信テキスト」だけ
import { config } from "./config.js";
import { getClient, updateClient } from "./store.js";

export function getHistory(id) {
  const c = getClient(id);
  if (Date.now() - c.historyUpdatedAt > config.history.ttlMs) return [];
  return c.history;
}

export function appendTurn(id, userText, assistantText) {
  const messages = [
    ...getHistory(id),
    { role: "user", content: userText },
    { role: "assistant", content: assistantText },
  ];
  // 古い往復から捨てる（必ず user から始まるよう 2 件ずつ）
  const max = config.history.turns * 2;
  updateClient(id, {
    history: messages.length > max ? messages.slice(messages.length - max) : messages,
    historyUpdatedAt: Date.now(),
  });
}

export function clearHistory(id) {
  updateClient(id, { history: [], historyUpdatedAt: 0 });
}
