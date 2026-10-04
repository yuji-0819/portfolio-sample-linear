// 管理画面（/admin）：設定の編集・テスト会話・状況確認・バックアップ
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "../config.js";
import {
  getSettings,
  listTemplates,
  normalize,
  offerActive,
  resetToTemplate,
  saveSettings,
  settingsFromTemplate,
  KNOWN_TOOLS,
} from "../settings.js";
import { botInfo, replyAsFortuneTeller } from "../fortune.js";
import { toLineMessages } from "../line.js";
import { allJobs, countClients, deleteClient, findByCaseNo, getClient, listHuman, updateClient } from "../store.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// ベーシック認証（ブラウザがユーザー名・パスワードを聞いてくる）
function requirePassword(req, res, next) {
  const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
  const pass = scheme === "Basic" ? Buffer.from(encoded ?? "", "base64").toString().split(":").slice(1).join(":") : "";
  const a = crypto.createHash("sha256").update(pass).digest();
  const b = crypto.createHash("sha256").update(config.adminPassword).digest();
  if (pass && crypto.timingSafeEqual(a, b)) return next();
  res.set("WWW-Authenticate", 'Basic realm="admin", charset="UTF-8"').status(401).send("パスワードが必要です");
}

const TEST_PREFIX = "admin-test-";
const testId = (req) => TEST_PREFIX + String(req.body?.session ?? "default").replace(/[^\w-]/g, "").slice(0, 40);

export function adminRouter() {
  const r = express.Router();
  if (!config.adminPassword) {
    r.use((_req, res) => res.status(503).send("管理画面を使うには、環境変数 ADMIN_PASSWORD を設定してください。"));
    return r;
  }
  r.use(requirePassword);
  r.use(express.json({ limit: "2mb" }));

  r.get("/", (_req, res) => res.sendFile(path.join(here, "index.html")));

  r.get("/api/settings", (_req, res) =>
    res.json({ settings: getSettings(), templates: listTemplates(), knownTools: KNOWN_TOOLS, offerActive: offerActive() }),
  );

  r.put("/api/settings", (req, res) => {
    const saved = saveSettings(req.body?.settings ?? {});
    console.log("[admin] 設定を保存しました");
    res.json({ settings: saved, offerActive: offerActive(saved) });
  });

  r.post("/api/settings/template", (req, res) => {
    try {
      const saved = resetToTemplate(String(req.body?.template ?? ""));
      console.log(`[admin] テンプレート「${saved.template}」で設定を作り直しました`);
      res.json({ settings: saved, offerActive: offerActive(saved) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // テンプレートの中身を見るだけ（保存はしない）
  r.get("/api/templates/:id", (req, res) => {
    try {
      res.json({ settings: settingsFromTemplate(req.params.id) });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  r.get("/api/settings/export", (_req, res) => {
    const name = `line-bot-settings-${new Date().toISOString().slice(0, 10)}.json`;
    res.set("Content-Disposition", `attachment; filename="${name}"`);
    res.json({ format: "line-bot-settings", version: 1, settings: getSettings() });
  });

  r.post("/api/settings/import", (req, res) => {
    const incoming = req.body?.settings ?? req.body;
    if (!incoming || typeof incoming !== "object" || !incoming.account) {
      return res.status(400).json({ error: "設定ファイルの形式が正しくありません" });
    }
    const saved = saveSettings(normalize(incoming));
    console.log("[admin] 設定を読み込みました");
    res.json({ settings: saved, offerActive: offerActive(saved) });
  });

  // テスト会話（LINE に送らず、待ち時間なしで返信を作る。保存済みの設定を使う）
  r.post("/api/test/chat", async (req, res) => {
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "メッセージを入力してください" });
    const id = testId(req);
    try {
      const reply = await replyAsFortuneTeller(id, text);
      const c = getClient(id);
      res.json({
        bubbles: toLineMessages(reply.text, { maxMessages: reply.offer ? 4 : 5 }).map((m) => m.text),
        offer: reply.offer,
        events: reply.events,
        state: { userTurns: c.userTurns, offers: c.offers.length, confirmAsked: Boolean(c.confirmAskedAt) },
      });
    } catch (err) {
      console.error("[admin] テスト会話でエラー:", err);
      res.status(500).json({ error: `返信を作れませんでした: ${err.message}` });
    }
  });

  r.post("/api/test/reset", (req, res) => {
    deleteClient(testId(req));
    res.json({ ok: true });
  });

  r.get("/api/status", (_req, res) => {
    const jobs = allJobs();
    const consults = jobs.filter((j) => j.kind === "consult").sort((a, b) => a.dueAt - b.dueAt);
    res.json({
      bot: botInfo(),
      clients: countClients(),
      waiting: consults.length,
      nextReplyAt: consults[0]?.dueAt ?? null,
      human: listHuman()
        .filter((c) => !c.id.startsWith(TEST_PREFIX))
        .map((c) => ({ caseNo: c.caseNo, since: c.humanSince })),
      adminNotify: Boolean(config.adminUserId),
    });
  });

  r.post("/api/human/:caseNo/end", (req, res) => {
    const id = findByCaseNo(Number(req.params.caseNo));
    if (!id) return res.status(404).json({ error: "その受付番号の有人対応は見つかりませんでした" });
    updateClient(id, { mode: "ai", caseNo: null, humanSince: 0 });
    res.json({ ok: true });
  });

  return r;
}
