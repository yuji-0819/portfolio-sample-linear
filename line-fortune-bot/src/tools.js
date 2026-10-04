// 占いで使う「本当にランダムな」道具。モデルが自分で結果を決めないよう、乱数はここで作る
import { randomInt } from "node:crypto";

const MAJOR = [
  "愚者", "魔術師", "女教皇", "女帝", "皇帝", "教皇", "恋人", "戦車", "力", "隠者", "運命の輪",
  "正義", "吊るされた男", "死神", "節制", "悪魔", "塔", "星", "月", "太陽", "審判", "世界",
];
const SUITS = ["ワンド", "カップ", "ソード", "ペンタクル"];
const RANKS = ["エース", "2", "3", "4", "5", "6", "7", "8", "9", "10", "ペイジ", "ナイト", "クイーン", "キング"];
const FULL = [...MAJOR, ...SUITS.flatMap((s) => RANKS.map((r) => `${s}の${r}`))];

function sample(list, count) {
  const pool = [...list];
  const picked = [];
  for (let i = 0; i < count && pool.length; i++) {
    picked.push(pool.splice(randomInt(pool.length), 1)[0]);
  }
  return picked;
}

const definitions = {
  draw_tarot: {
    name: "draw_tarot",
    description:
      "タロットカードをシャッフルしてランダムに引く。タロット鑑定では必ずこのツールでカードを決めること。positions にはスプレッドの各位置の名前を順番に入れる（例: [\"過去\",\"現在\",\"未来\"]）。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        positions: {
          type: "array",
          items: { type: "string" },
          description: "各カードの位置の名前。要素数が引く枚数になる（1〜10枚）",
        },
        deck: {
          type: "string",
          enum: ["major", "full"],
          description: "major = 大アルカナ22枚のみ, full = 78枚すべて",
        },
        allow_reversed: { type: "boolean", description: "逆位置を使うか" },
      },
      required: ["positions", "deck", "allow_reversed"],
      additionalProperties: false,
    },
    run({ positions, deck, allow_reversed }) {
      const names = Array.isArray(positions) && positions.length ? positions.slice(0, 10) : ["結果"];
      const cards = sample(deck === "full" ? FULL : MAJOR, names.length);
      return names.map((position, i) => ({
        position,
        card: cards[i],
        orientation: allow_reversed && randomInt(2) === 1 ? "逆位置" : "正位置",
      }));
    },
  },
  draw_random: {
    name: "draw_random",
    description:
      "与えられた選択肢から本当にランダムに選ぶ（おみくじ、オラクルカード、ルーンなど）。占術の設定で選択肢が決められている場合は、その選択肢をすべて options に入れること。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        options: { type: "array", items: { type: "string" }, description: "選択肢の一覧" },
        count: { type: "integer", description: "選ぶ数（重複なし）" },
      },
      required: ["options", "count"],
      additionalProperties: false,
    },
    run({ options, count }) {
      const list = Array.isArray(options) ? options.filter((o) => typeof o === "string" && o) : [];
      if (!list.length) throw new Error("options が空です");
      const n = Math.min(Math.max(Number(count) || 1, 1), list.length);
      return { picked: sample(list, n) };
    },
  },
};

// メニューで指定された道具だけを有効にする
export function toolsFor(methods) {
  const names = [...new Set(methods.flatMap((m) => m.tools))].filter((n) => definitions[n]);
  for (const m of methods) {
    for (const t of m.tools) {
      if (!definitions[t]) console.warn(`[warn] ${m.name}: 不明な道具 "${t}" は無視します`);
    }
  }
  return names.map((n) => definitions[n]);
}

export function runTool(name, input) {
  const tool = definitions[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.run(input ?? {});
}

export function toolSchemas(tools) {
  return tools.map(({ run, ...schema }) => schema);
}
