// LINE へ送るためのテキスト整形
const LINE_TEXT_LIMIT = 5000; // LINE のテキストメッセージ1通の上限
const MAX_MESSAGES = 5; // 1回の返信で送れる最大通数

// 長い返信は段落の切れ目で分割して最大 maxMessages 通（既定5通）にする
export function toLineMessages(text, { limit = LINE_TEXT_LIMIT, maxMessages = MAX_MESSAGES } = {}) {
  const chunks = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    const next = current ? `${current}\n\n${para}` : para;
    if (next.length <= limit) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    current = para;
    while (current.length > limit) {
      chunks.push(current.slice(0, limit));
      current = current.slice(limit);
    }
  }
  if (current) chunks.push(current);

  if (chunks.length > maxMessages) {
    const head = chunks.slice(0, maxMessages - 1);
    const tail = chunks.slice(maxMessages - 1).join("\n\n").slice(0, limit);
    chunks.splice(0, chunks.length, ...head, tail);
  }
  return chunks.map((t) => ({ type: "text", text: t }));
}
