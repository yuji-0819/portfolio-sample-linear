// 設定の読み込み結果と、AI に渡す指示文の全体を表示する（API は呼ばない）
//   npm run check
import { buildSystemPrompt } from "./prompt.js";
import { toolsFor } from "./tools.js";
import { offerPromptSection } from "./offer.js";
import { getSettings, offerActive } from "./settings.js";

const s = getSettings();
const methods = s.methods.filter((m) => m.enabled);
console.log("アカウント:", s.account.name, `（テンプレート: ${s.template}）`);
console.log(`有効な${s.methodsTitle}:`, methods.map((m) => m.name).join(", ") || "なし");
console.log("有効な道具:", toolsFor(methods).map((t) => t.name).join(", ") || "なし");
console.log("有料サービスの案内:", offerActive(s) ? `オン（${s.offer.name} ${s.offer.price} → ${s.offer.url}）` : "オフ（管理画面で申込みページのURLを設定するとオン）");
console.log("\n----- システムプロンプト -----\n");
console.log(buildSystemPrompt(s, [offerPromptSection(s)]));
