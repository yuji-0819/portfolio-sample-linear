// アカウントごとの設定（キャラ・文章・術・商品・返信タイミングなど）
// - 管理画面から編集し、DATA_DIR/settings.json に保存する
// - 初回起動時はテンプレート（templates/<id>/）から作る
// - 保存すると再起動なしで次の返信から反映される
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = path.resolve(here, "..", "templates");
const file = path.join(config.dataDir, "settings.json");
export const DEFAULT_TEMPLATE = process.env.TEMPLATE || "fortune";

export const KNOWN_TOOLS = ["draw_tarot", "draw_random"];
export const EFFORTS = ["low", "medium", "high"];

// 先頭の --- で囲まれた部分を読み取る
export function parseFrontMatter(text) {
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

const envNum = (name, fallback) => {
  const n = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(TEMPLATES_DIR, e.name, "template.json")))
    .map((e) => {
      const t = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, e.name, "template.json"), "utf8"));
      return { id: e.name, label: t.label ?? e.name, description: t.description ?? "" };
    });
}

/** テンプレートから設定一式を作る */
export function settingsFromTemplate(id = DEFAULT_TEMPLATE) {
  const dir = path.join(TEMPLATES_DIR, id);
  if (!fs.existsSync(path.join(dir, "template.json"))) throw new Error(`テンプレート「${id}」が見つかりません`);
  const t = JSON.parse(fs.readFileSync(path.join(dir, "template.json"), "utf8"));
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8").trim() : "");

  const methodsDir = path.join(dir, "methods");
  const methods = fs.existsSync(methodsDir)
    ? fs
        .readdirSync(methodsDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => {
          const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(methodsDir, f), "utf8"));
          return {
            id: path.basename(f, ".md"),
            name: meta.name || path.basename(f, ".md"),
            enabled: meta.enabled !== "false",
            tools: (meta.tools || "").split(/[,\s]+/).filter(Boolean),
            body,
          };
        })
    : [];

  return normalize({
    template: id,
    account: { ...t.account, effort: process.env.CLAUDE_EFFORT || "medium" },
    persona: read("persona.md"),
    rules: read("rules.md"),
    methodsTitle: t.methodsTitle,
    methodsIntro: t.methodsIntro,
    methodsEmpty: t.methodsEmpty,
    methods,
    messages: { welcome: read("welcome.txt"), ...t.messages },
    offer: { enabled: true, url: "", imageUrl: "", ...t.offer, guide: read("offer-guide.md") },
    offerRules: {
      minTurns: envNum("OFFER_MIN_TURNS", 3),
      cooldownDays: envNum("OFFER_COOLDOWN_DAYS", 7),
      crisisBlockDays: envNum("OFFER_CRISIS_BLOCK_DAYS", 14),
      requireConfirmation: true,
    },
    timing: {
      minMinutes: envNum("REPLY_DELAY_MIN_MINUTES", 5),
      maxMinutes: envNum("REPLY_DELAY_MAX_MINUTES", 40),
      perPendingMinutes: envNum("REPLY_DELAY_PER_PENDING_MINUTES", 2),
      quietEnabled: process.env.QUIET_HOURS !== "",
      quietStart: Number((process.env.QUIET_HOURS || "1-8").split("-")[0]) || 1,
      quietEnd: Number((process.env.QUIET_HOURS || "1-8").split("-")[1]) || 8,
      purchaseMinMinutes: envNum("PURCHASE_REPLY_MIN_MINUTES", 1),
      purchaseMaxMinutes: envNum("PURCHASE_REPLY_MAX_MINUTES", 4),
    },
  });
}

// ---- 入力チェック（管理画面から何が来ても壊れないように整える） ----
const str = (v, max = 20000) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
const bool = (v, d) => (typeof v === "boolean" ? v : d);
const clamp = (v, min, max, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : d;
};

export function normalize(s = {}) {
  const a = s.account ?? {};
  const o = s.offer ?? {};
  const r = s.offerRules ?? {};
  const t = s.timing ?? {};
  const m = s.messages ?? {};
  const timing = {
    minMinutes: clamp(t.minMinutes, 0, 1440, 5),
    maxMinutes: clamp(t.maxMinutes, 0, 1440, 40),
    perPendingMinutes: clamp(t.perPendingMinutes, 0, 120, 2),
    quietEnabled: bool(t.quietEnabled, true),
    quietStart: Math.trunc(clamp(t.quietStart, 0, 23, 1)),
    quietEnd: Math.trunc(clamp(t.quietEnd, 0, 23, 8)),
    purchaseMinMinutes: clamp(t.purchaseMinMinutes, 0, 120, 1),
    purchaseMaxMinutes: clamp(t.purchaseMaxMinutes, 0, 120, 4),
  };
  if (timing.maxMinutes < timing.minMinutes) timing.maxMinutes = timing.minMinutes;
  if (timing.purchaseMaxMinutes < timing.purchaseMinMinutes) timing.purchaseMaxMinutes = timing.purchaseMinMinutes;

  const usedIds = new Set();
  const methods = (Array.isArray(s.methods) ? s.methods : []).slice(0, 50).map((x, i) => {
    let id = str(x?.id, 60).replace(/[^\w-]/g, "") || `m${i + 1}`;
    while (usedIds.has(id)) id += "_";
    usedIds.add(id);
    return {
      id,
      name: str(x?.name, 100) || `メニュー${i + 1}`,
      enabled: bool(x?.enabled, true),
      tools: (Array.isArray(x?.tools) ? x.tools : []).filter((n) => KNOWN_TOOLS.includes(n)),
      body: str(x?.body),
    };
  });

  return {
    template: str(s.template, 60),
    account: {
      name: str(a.name, 100),
      role: str(a.role, 300) || "公式LINEアカウントで相談者とやり取りする相談役",
      effort: EFFORTS.includes(a.effort) ? a.effort : "medium",
    },
    persona: str(s.persona, 50000),
    rules: str(s.rules, 50000),
    methodsTitle: str(s.methodsTitle, 40) || "メニュー",
    methodsIntro: str(s.methodsIntro, 2000),
    methodsEmpty: str(s.methodsEmpty, 2000),
    methods,
    messages: {
      welcome: str(m.welcome, 5000),
      reset: str(m.reset, 5000) || "これまでのお話をリセットしました。",
      error: str(m.error, 5000) || "少し時間をおいて、もう一度メッセージを送ってください。",
      refusal: str(m.refusal, 5000) || "そのご相談はこの場ではお受けできません。",
    },
    offer: {
      enabled: bool(o.enabled, true),
      name: str(o.name, 100) || "個別相談",
      price: str(o.price, 100),
      shop: str(o.shop, 40) || "BASE",
      url: str(o.url, 2000).trim(),
      imageUrl: str(o.imageUrl, 2000).trim(),
      description: str(o.description, 5000),
      steps: str(o.steps, 5000),
      thanks: str(o.thanks, 5000),
      cardLabel: str(o.cardLabel, 60),
      cardNote: str(o.cardNote, 300),
      buttonLabel: str(o.buttonLabel, 20) || "申し込む",
      color: /^#[0-9a-fA-F]{6}$/.test(o.color ?? "") ? o.color : "#8E7CC3",
      guide: str(o.guide, 50000),
    },
    offerRules: {
      minTurns: Math.trunc(clamp(r.minTurns, 0, 100, 3)),
      cooldownDays: clamp(r.cooldownDays, 0, 365, 7),
      crisisBlockDays: clamp(r.crisisBlockDays, 0, 365, 14),
      requireConfirmation: bool(r.requireConfirmation, true),
    },
    timing,
  };
}

// ---- 読み込み・保存 ----
let current;
let revision = 0;

function load() {
  try {
    current = normalize(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (err) {
    if (err.code !== "ENOENT") console.error(`[settings] ${file} を読めませんでした。テンプレートから作り直します:`, err.message);
    current = settingsFromTemplate();
    write(current);
  }
  revision += 1;
}

function write(s) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, file);
}

/** 今の設定（読み取り専用として扱うこと） */
export function getSettings() {
  if (!current) load();
  return current;
}

/** 設定が変わるたびに増える番号（作り直しが必要かの判定用） */
export function settingsRevision() {
  getSettings();
  return revision;
}

export function saveSettings(next) {
  const s = normalize({ ...next, template: next.template ?? getSettings().template });
  write(s);
  current = s;
  revision += 1;
  return s;
}

export function resetToTemplate(id) {
  return saveSettings(settingsFromTemplate(id));
}

/** 有料サービスの案内が使える状態か（URL が https で始まっていること） */
export function offerActive(s = getSettings()) {
  return s.offer.enabled && /^https:\/\/\S+$/.test(s.offer.url);
}
