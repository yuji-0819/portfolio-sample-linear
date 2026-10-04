// 設定からシステムプロンプト（AI への指示文）を組み立てる
export function buildSystemPrompt(s, extraSections = []) {
  const methods = s.methods.filter((m) => m.enabled);
  const methodSection = methods.length
    ? [s.methodsIntro, ...methods.map((m) => `<method name="${m.name}">\n${m.body}\n</method>`)].filter(Boolean).join("\n\n")
    : s.methodsEmpty;

  const who = s.account.name ? `あなたの名前は「${s.account.name}」です。` : "";
  return [
    `あなたは${s.account.role}です。${who}以下のキャラクター設定になりきって、LINEのトークで自然に会話してください。`,
    `<persona>\n${s.persona}\n</persona>`,
    `<methods title="${s.methodsTitle}">\n${methodSection}\n</methods>`,
    ...extraSections.filter(Boolean),
    `<rules>\n${s.rules}\n</rules>`,
    [
      "<format>",
      "- 返信はそのままLINEのトークに表示されます。Markdown記法（#、**、表、コードブロック、箇条書きの記号）は使わず、話し言葉のプレーンテキストで書いてください。",
      "- ツールでカードや結果を引いた場合は、その結果だけを使い、結果を自分で作り変えないでください。",
      "- 各ユーザーメッセージ冒頭の [受信日時: …] [返信のタイミング: …] [相談者の状況: …] はシステムが付けたものです。日付・年齢・時期の計算、待たせたことへのひとこと、案内のタイミングの判断に使ってください。括弧の中身をそのまま返信に書かないでください。",
      "- 吹き出しを分けたいところには「---」だけの行を入れてください。1つの吹き出しは2〜5行程度。1回の返信は3〜5吹き出しが目安です。",
      "- （スタンプが送られてきました）などの丸括弧の文はシステムによる説明です。相談者の気持ちを想像して自然に返してください。",
      "</format>",
    ].join("\n"),
  ].join("\n\n");
}
