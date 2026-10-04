// 人間らしい返信タイミングを作る予約キュー
// - 受け取ったメッセージはすぐ返さず、ランダムな時間をおいて返す
// - 返信前にまとめて「既読」をつける（読んでから少し考えて返す流れ）
// - 返信を待っている相談が多いほど、返信は遅くなる
// - 深夜は返さず、朝になってから返す
// - ただし命に関わる言葉があるときは、待たせずにすぐ返す
// 予約はファイルに保存されるので、再起動しても消えない
import { config } from "./config.js";
import { allJobs, deleteJob, getJob, setJob } from "./store.js";
import { isCrisisText } from "./offer.js";

const MIN = 60_000;
const rand = (a, b) => a + Math.random() * (b - a);

const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23" });
function inQuietHours(t) {
  const q = config.delay.quietHours;
  if (!q || q.start === q.end) return false;
  const h = Number(hourFmt.format(t));
  return q.start < q.end ? h >= q.start && h < q.end : h >= q.start || h < q.end;
}

// 深夜にかかったら、明けてから 0〜60 分後にずらす
function skipQuietHours(t) {
  if (!inQuietHours(t)) return t;
  let x = t;
  while (inQuietHours(x)) x += 10 * MIN;
  return x + rand(0, 60) * MIN;
}

const waitingConsults = () => allJobs().filter((j) => j.kind === "consult").length;

function pickDueAt(now) {
  const { minMinutes, maxMinutes, perPendingMinutes } = config.delay;
  // 短めが多く、ときどき長め
  const minutes = minMinutes + (maxMinutes - minMinutes) * Math.random() ** 1.5 + waitingConsults() * perPendingMinutes;
  return skipQuietHours(now + minutes * MIN);
}

/** 相談メッセージを予約に追加する（返信前に届いた分は1回の返信にまとめる） */
export function queueConsult({ convoId, userId, sourceType, text, replyToken, markAsReadToken }) {
  const now = Date.now();
  const item = { text, at: now, markAsReadToken: markAsReadToken ?? null, read: false };
  const urgent = isCrisisText(text);
  const urgentDue = now + rand(0.3, 1) * MIN;
  const job = getJob(convoId);
  if (job?.kind === "consult") {
    const dueAt = urgent ? Math.min(job.dueAt, urgentDue) : job.dueAt;
    setJob(convoId, { ...job, items: [...job.items, item], replyToken, dueAt, readAt: Math.min(job.readAt, dueAt) });
    return dueAt;
  }
  const dueAt = urgent ? urgentDue : pickDueAt(now);
  const readAt = Math.min(skipQuietHours(now + (dueAt - now) * rand(0.25, 0.8)), dueAt - 30_000);
  setJob(convoId, { kind: "consult", convoId, userId, sourceType, receivedAt: now, dueAt, readAt, replyToken, items: [item] });
  return dueAt;
}

/** 決まったメッセージを少し後に送る（購入スクショへのお礼など） */
export function queueSend({ convoId, userId, replyToken, messages, minMinutes, maxMinutes }) {
  const dueAt = Date.now() + rand(minMinutes, maxMinutes) * MIN;
  setJob(`${convoId}:send`, { kind: "send", convoId, userId, replyToken, messages, dueAt });
  return dueAt;
}

export function cancelConsult(convoId) {
  if (getJob(convoId)?.kind === "consult") deleteJob(convoId);
}

/**
 * 予約を定期的に確認して実行する
 * handlers: { markRead(tokens), onConsult(job), onSend(job) }
 */
export function startScheduler(handlers, intervalMs = 5_000) {
  const tick = () => {
    const now = Date.now();
    for (const job of allJobs()) {
      const key = job.kind === "send" ? `${job.convoId}:send` : job.convoId;

      // 既読：既読タイミングまでに届いた分は既読タイミングで、それ以降に届いた分は返信の直前につける
      if (job.kind === "consult" && now >= job.readAt) {
        const due = now >= job.dueAt;
        const toRead = job.items.filter((i) => !i.read && (due || i.at <= job.readAt));
        if (toRead.length) {
          const tokens = toRead.map((i) => i.markAsReadToken).filter(Boolean);
          if (tokens.length) handlers.markRead(tokens);
          if (!due) setJob(key, { ...job, items: job.items.map((i) => (toRead.includes(i) ? { ...i, read: true } : i)) });
        }
      }

      if (now >= job.dueAt) {
        deleteJob(key); // 実行中に届いた新しいメッセージは次の予約になる
        const run = job.kind === "send" ? handlers.onSend : handlers.onConsult;
        Promise.resolve(run(getJobSnapshot(job))).catch((err) => console.error(`[scheduler] ${job.kind} failed:`, err));
      }
    }
  };
  tick();
  return setInterval(tick, intervalMs);
}

const getJobSnapshot = (job) => JSON.parse(JSON.stringify(job));

export function describeQueue() {
  return allJobs()
    .map((j) => `${j.kind} ${j.convoId.slice(0, 8)}… → ${new Date(j.dueAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`)
    .join("\n");
}
