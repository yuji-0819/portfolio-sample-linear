// 相談者カルテ（会話履歴・案内履歴・有人対応の状態）をファイルに保存する
// 保存先: DATA_DIR/clients.json（既定は ./data）。再起動しても消えない
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const file = path.join(config.dataDir, "clients.json");
let clients = {};
let meta = { lastCaseNo: 1000 };

try {
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  clients = saved.clients ?? {};
  meta = { ...meta, ...saved.meta };
} catch (err) {
  if (err.code !== "ENOENT") console.error(`[store] ${file} を読めませんでした:`, err.message);
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ meta, clients }));
    fs.renameSync(tmp, file);
  }, 200);
}

const blank = () => ({
  history: [],
  historyUpdatedAt: 0,
  userTurns: 0, // これまでの相談メッセージ数（累計）
  offers: [], // 案内カードを出した日時
  lastCrisisAt: 0, // 命に関わる言葉が出た日時
  purchases: [], // 購入スクショを受け取った日時
  mode: "ai", // "ai" | "human"（有人対応中）
  caseNo: null,
  humanSince: 0,
});

export function getClient(id) {
  return { ...blank(), ...clients[id] };
}

export function updateClient(id, patch) {
  const next = { ...getClient(id), ...(typeof patch === "function" ? patch(getClient(id)) : patch) };
  clients[id] = next;
  save();
  return next;
}

export function nextCaseNo() {
  meta.lastCaseNo += 1;
  save();
  return meta.lastCaseNo;
}

export function findByCaseNo(caseNo) {
  return Object.entries(clients).find(([, c]) => c.mode === "human" && c.caseNo === caseNo)?.[0];
}

export function listHuman() {
  return Object.entries(clients)
    .filter(([, c]) => c.mode === "human")
    .map(([id, c]) => ({ id, ...c }));
}

// 終了時に書きかけを確実に保存
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, () => {
    if (timer) {
      clearTimeout(timer);
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ meta, clients }));
    }
    process.exit(0);
  });
}
