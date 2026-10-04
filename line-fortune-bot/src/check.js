// 設定ファイルの読み込み結果を表示する（API は呼ばない）
//   npm run check
import { buildSystemPrompt, loadMethods } from "./prompt.js";
import { toolsFor } from "./tools.js";

const methods = loadMethods();
console.log("有効な占術:", methods.map((m) => `${m.name} (${m.file})`).join(", ") || "なし");
console.log("有効な道具:", toolsFor(methods).map((t) => t.name).join(", ") || "なし");
console.log("\n----- システムプロンプト -----\n");
console.log(buildSystemPrompt(methods));
