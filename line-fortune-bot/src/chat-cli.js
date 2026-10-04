// LINE につながずに、ターミナルでキャラクターと会話して口調やメニューの動きを確認するツール
//   npm run chat
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { botInfo, replyAsFortuneTeller } from "./fortune.js";
import { clearHistory } from "./history.js";
import { getSettings } from "./settings.js";
import { toLineMessages } from "./line.js";

// 実際の相談者と記録が混ざらないよう、起動ごとに別のIDを使う
const USER = `local-test-${Date.now()}`;
const rl = readline.createInterface({ input, output });

const info = botInfo();
console.log(`${info.name} / メニュー: ${info.methods.join(", ") || "（指定なし）"} / 道具: ${info.tools.join(", ") || "なし"}`);
console.log("終了: exit / 会話リセット: リセット\n");
for (const m of toLineMessages(getSettings().messages.welcome)) console.log(`${info.name}> ${m.text}\n`);

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
    for (const m of toLineMessages(reply.text)) console.log(`\n${info.name}> ${m.text}`);
    if (reply.offer) console.log(`\n［ここに「${getSettings().offer.name}」の案内カードが表示されます］`);
    console.log();
  } catch (err) {
    console.error("エラー:", err.message);
  }
}
rl.close();
