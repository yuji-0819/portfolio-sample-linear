// 環境変数をまとめて読む
const int = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  },
  claude: {
    model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  },
  dataDir: process.env.DATA_DIR || "data",
  // 運営者（占い師本人）の LINE ユーザーID。申込通知の送り先・管理コマンドの受付
  adminUserId: process.env.ADMIN_USER_ID ?? "",
  // 管理画面（/admin）のパスワード。未設定なら管理画面は使えない
  adminPassword: process.env.ADMIN_PASSWORD ?? "",

  history: {
    turns: int(process.env.HISTORY_TURNS, 20),
    ttlMs: int(process.env.HISTORY_TTL_MINUTES, 720) * 60 * 1000,
  },
};
