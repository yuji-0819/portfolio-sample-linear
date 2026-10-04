// LINE へ送るためのテキスト整形
const LINE_TEXT_LIMIT = 5000; // LINE のテキストメッセージ1通の上限
const MAX_MESSAGES = 5; // 1回の送信で送れる最大の吹き出し数

// 「---」だけの行で吹き出しを分ける（人がLINEで何通かに分けて送る感じ）
const BUBBLE_BREAK = /^[ \t]*[-ー―─]{3,}[ \t]*$/m;

function chunk(text, limit) {
  const out = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    const next = current ? `${current}\n\n${para}` : para;
    if (next.length <= limit) {
      current = next;
      continue;
    }
    if (current) out.push(current);
    current = para;
    while (current.length > limit) {
      out.push(current.slice(0, limit));
      current = current.slice(limit);
    }
  }
  if (current) out.push(current);
  return out;
}

/** 返信テキストを吹き出しに分け、最大 maxMessages 個（既定5）にする */
export function toLineMessages(text, { limit = LINE_TEXT_LIMIT, maxMessages = MAX_MESSAGES } = {}) {
  const bubbles = text
    .split(new RegExp(BUBBLE_BREAK.source, "gm"))
    .map((b) => b.trim())
    .filter(Boolean)
    .flatMap((b) => chunk(b, limit));

  if (bubbles.length > maxMessages) {
    const head = bubbles.slice(0, maxMessages - 1);
    const tail = bubbles.slice(maxMessages - 1).join("\n\n").slice(0, limit);
    bubbles.splice(0, bubbles.length, ...head, tail);
  }
  return bubbles.map((t) => ({ type: "text", text: t }));
}
