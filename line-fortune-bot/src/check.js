// 設定ファイルの読み込み結果を表示する（API は呼ばない）
//   npm run check
import { buildSystemPrompt, loadMethods } from "./prompt.js";
import { toolsFor } from "./tools.js";
import { offer, offerEnabled, offerPromptSection } from "./offer.js";

const methods = loadMethods();
console.log("有効な占術:", methods.map((m) => `${m.name} (${m.file})`).join(", ") || "なし");
console.log("有効な道具:", toolsFor(methods).map((t) => t.name).join(", ") || "なし");
console.log("有料鑑定の案内:", offerEnabled ? `オン（${offer.name} ${offer.price} → ${offer.baseUrl}）` : "オフ（fortune/offer.md の base_url を設定するとオン）");
console.log("\n----- システムプロンプト -----\n");
console.log(buildSystemPrompt(methods, [offerPromptSection()]));
