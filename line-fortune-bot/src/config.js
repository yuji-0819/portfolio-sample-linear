// 環境変数をまとめて読む
const int = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// 0 も許す数値
const num = (value, fallback) => {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// "1-8" → { start: 1, end: 8 }（日本時間の時。空なら無効）
const hours = (value, fallback) => {
  const m = String(value ?? fallback).match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/);
  return m ? { start: Number(m[1]) % 24, end: Number(m[2]) % 24 } : null;
};

export const config = {
  port: int(process.env.PORT, 3000),
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  },
  claude: {
    model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
    effort: process.env.CLAUDE_EFFORT || "medium",
  },
  dataDir: process.env.DATA_DIR || "data",
  // 運営者（占い師本人）の LINE ユーザーID。申込通知の送り先・管理コマンドの受付
  adminUserId: process.env.ADMIN_USER_ID ?? "",
  offer: {
    minTurns: int(process.env.OFFER_MIN_TURNS, 3),
    cooldownMs: int(process.env.OFFER_COOLDOWN_DAYS, 7) * 24 * 60 * 60 * 1000,
    crisisBlockMs: int(process.env.OFFER_CRISIS_BLOCK_DAYS, 14) * 24 * 60 * 60 * 1000,
  },
  // 人間らしい返信タイミング
  delay: {
    minMinutes: num(process.env.REPLY_DELAY_MIN_MINUTES, 5),
    maxMinutes: num(process.env.REPLY_DELAY_MAX_MINUTES, 40),
    // 返信待ちの相談が1件増えるごとに足す分数（忙しい占い師らしさ）
    perPendingMinutes: num(process.env.REPLY_DELAY_PER_PENDING_MINUTES, 2),
    // この時間帯（日本時間）は返信せず、朝にまとめて返す
    quietHours: hours(process.env.QUIET_HOURS, "1-8"),
    // 購入スクショへのお礼を送るまでの時間
    purchaseMinMinutes: num(process.env.PURCHASE_REPLY_MIN_MINUTES, 1),
    purchaseMaxMinutes: num(process.env.PURCHASE_REPLY_MAX_MINUTES, 4),
  },
  history: {
    turns: int(process.env.HISTORY_TURNS, 20),
    ttlMs: int(process.env.HISTORY_TTL_MINUTES, 720) * 60 * 1000,
  },
};
