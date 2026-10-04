// fortune/ フォルダの設定ファイルから、占い師のシステムプロンプトを組み立てる
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FORTUNE_DIR = path.resolve(here, "..", "fortune");
const METHODS_DIR = path.join(FORTUNE_DIR, "methods");

const read = (file) => fs.readFileSync(path.join(FORTUNE_DIR, file), "utf8").trim();

// 先頭の --- で囲まれた部分（name / tools）を読み取る
function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const kv = line.match(/^\s*([A-Za-z_]+)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: text.slice(match[0].length).trim() };
}

export function loadMethods() {
  if (!fs.existsSync(METHODS_DIR)) return [];
  return fs
    .readdirSync(METHODS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .filter((e) => !e.name.startsWith("_") && e.name.toLowerCase() !== "readme.md")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => {
      const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(METHODS_DIR, e.name), "utf8"));
      return {
        file: e.name,
        name: meta.name || path.basename(e.name, ".md"),
        tools: (meta.tools || "").split(/[,\s]+/).filter(Boolean),
        body,
      };
    });
}

export function loadWelcomeMessage() {
  return read("welcome.txt");
}

export function buildSystemPrompt(methods) {
  const methodSection = methods.length
    ? [
        "使ってよい占術は次のとおりです。相談内容に合う術を選んで鑑定してください。ここにない占術は使わないでください。",
        ...methods.map((m) => `<method name="${m.name}">\n${m.body}\n</method>`),
      ].join("\n\n")
    : "現在、特定の占術は指定されていません。占い師として相談者の気持ちに寄り添い、心を整えるヒントを伝えてください。";

  return [
    "あなたは公式LINEアカウントで相談者とやり取りする占い師です。以下のキャラクター設定になりきって、LINEのトークで自然に会話してください。",
    `<persona>\n${read("persona.md")}\n</persona>`,
    `<methods>\n${methodSection}\n</methods>`,
    `<rules>\n${read("rules.md")}\n</rules>`,
    [
      "<format>",
      "- 返信はそのままLINEのトークに表示されます。Markdown記法（#、**、表、コードブロック）は使わず、プレーンテキストで書いてください。",
      "- ツールでカードや結果を引いた場合は、その結果だけを使い、結果を自分で作り変えないでください。",
      "- 各ユーザーメッセージ冒頭の [受信日時: …] はシステムが付けたものです。日付や年齢、運勢の時期の計算に使ってください。返信の中で引用する必要はありません。",
      "</format>",
    ].join("\n"),
  ].join("\n\n");
}
