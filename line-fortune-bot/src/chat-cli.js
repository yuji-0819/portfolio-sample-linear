// LINE につながずに、ターミナルで占い師と会話して口調や占術の動きを確認するツール
//   npm run chat
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fortuneInfo, replyAsFortuneTeller } from "./fortune.js";
import { clearHistory } from "./history.js";
import { loadWelcomeMessage } from "./prompt.js";
import { toLineMessages } from "./line.js";

// 実際の相談者と記録が混ざらないよう、起動ごとに別のIDを使う
const USER = `local-test-${Date.now()}`;
const rl = readline.createInterface({ input, output });

console.log(`占術: ${fortuneInfo.methods.join(", ") || "（指定なし）"} / 道具: ${fortuneInfo.tools.join(", ") || "なし"}`);
console.log("終了: exit / 会話リセット: リセット\n");
console.log(`占い師> ${loadWelcomeMessage()}\n`);

while (true) {
  const text = (await rl.question("あなた> ")).trim();
  if (!text) continue;
  if (text === "exit") break;
  if (text === "リセット") {
    clearHistory(USER);
    console.log("（会話をリセットしました）\n");
    continue;
  }
  try {
    const reply = await replyAsFortuneTeller(USER, text);
    for (const m of toLineMessages(reply.text)) console.log(`\n占い師> ${m.text}`);
    if (reply.offer) console.log("\n［ここに個別鑑定の案内カード（BASEで申し込むボタン）が表示されます］");
    console.log();
  } catch (err) {
    console.error("エラー:", err.message);
  }
}
rl.close();
