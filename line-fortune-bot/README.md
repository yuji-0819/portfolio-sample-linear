# 占い特化 公式LINE 自動返信ボット

公式LINEに届いたメッセージに、**占い師キャラクターとして自動で返信する**ボットです。
返信文は Claude（Anthropic の AI）が作り、口調・キャラクター・使う占術はすべてテキストファイルで指定できます。

```
相談者 ──LINE──▶ 公式LINE ──Webhook──▶ このサーバー ──▶ Claude（占い師として返信を作成）
   ◀────────────── 返信 ◀───────────────────┘
```

## できること

- 占い師キャラクター（名前・口調・鑑定の流れ）になりきって返信
- **使う占術を自分で指定**（`fortune/methods/` にファイルを置くだけ）
- タロット・おみくじ等は、AI が結果を勝手に決めないよう **プログラム側で本当にランダムに引く**
- 相談者ごとに会話の流れを記憶（生年月日などを毎回聞き直さない）
- 友だち追加時のあいさつ、「リセット」で会話のやり直し
- 返信を作っている間は「入力中…」アニメーションを表示
- 不安をあおらない・医療や法律は専門家へ・命に関わる相談は窓口を案内、などの安全ルールを標準搭載

---

## 占い師の設定を変える

| ファイル | 内容 |
|---|---|
| `fortune/persona.md` | 占い師の名前・人物像・口調・鑑定の流れ・返信の長さ |
| `fortune/methods/*.md` | **使う占術（術）**。1つの術 = 1ファイル |
| `fortune/rules.md` | 安全・信頼のためのルール（基本は変更不要） |
| `fortune/welcome.txt` | 友だち追加されたときのあいさつ文 |

### 占術の追加方法

1. `fortune/methods/_template.md` をコピーして、`fortune/methods/好きな名前.md` を作る
2. 「どんなときに使うか」「必要な情報」「鑑定の手順」「結果の伝え方」を日本語で書く
3. カードやくじを引く術なら、先頭の `tools:` に道具を書く
   - `draw_tarot` … タロット（大アルカナ22枚 / 78枚、正逆あり）
   - `draw_random` … ファイル内の「選択肢」からランダムに選ぶ（オラクルカード、おみくじ、ルーン等）
4. サーバーを再起動

記入例が `fortune/methods/examples/` にあります（タロット・数秘術・おみくじ）。
そのまま使いたい場合は `fortune/methods/` にコピーすれば有効になります。

`npm run check` で、どの占術が読み込まれたか・AI に渡される指示文の全体を確認できます。

---

## セットアップ手順

### 1. 必要なもの

- Node.js 20.6 以上
- LINE公式アカウント（無料で作成可）
- Anthropic の API キー（https://console.anthropic.com/ で発行。利用量に応じて課金）

### 2. 手元で動かして口調を確認する（LINE なしで OK）

```bash
cd line-fortune-bot
npm install
cp .env.example .env      # .env を開いて ANTHROPIC_API_KEY を記入
npm run chat              # ターミナル上で占い師と会話できる
```

ここで persona.md や占術ファイルを調整しながら、返信の雰囲気を詰めるのがおすすめです。

### 3. LINE 側の準備

1. [LINE Official Account Manager](https://manager.line.biz/) で公式アカウントを作成
2. 「設定 > Messaging API」で **Messaging API を有効化**（プロバイダーを選択）
3. [LINE Developers コンソール](https://developers.line.biz/console/) で該当チャネルを開き、
   - 「チャネル基本設定」の **チャネルシークレット** → `.env` の `LINE_CHANNEL_SECRET`
   - 「Messaging API設定」の **チャネルアクセストークン（長期）** を発行 → `LINE_CHANNEL_ACCESS_TOKEN`
4. LINE Official Account Manager の「設定 > 応答設定」で
   - **応答メッセージ: オフ**（オンのままだと定型文が二重に送られます）
   - **Webhook: オン**
   - あいさつメッセージ: オフ（このボットの `welcome.txt` を使う場合）

### 4. サーバーを公開する（デプロイ）

Webhook を受けるため、インターネットから HTTPS でアクセスできる場所で動かします。
Render / Railway / Google Cloud Run など Node.js が動くサービスならどれでも可。

- 起動コマンド: `npm start`
- 環境変数: `.env.example` の項目を各サービスの管理画面で設定
- ※ 無料プランで「しばらくアクセスがないと停止する」サービスは、最初の返信が遅れることがあります

### 5. Webhook URL を登録

LINE Developers コンソール「Messaging API設定」で
- Webhook URL: `https://（公開したURL）/webhook`
- 「検証」ボタンで成功を確認 → **Webhook の利用: オン**

これで、公式LINEにメッセージを送ると占い師が返信します。

---

## 設定項目（環境変数）

| 名前 | 既定値 | 説明 |
|---|---|---|
| `LINE_CHANNEL_SECRET` | — | 必須 |
| `LINE_CHANNEL_ACCESS_TOKEN` | — | 必須 |
| `ANTHROPIC_API_KEY` | — | 必須 |
| `CLAUDE_MODEL` | `claude-opus-5-5` | 使う AI モデル |
| `CLAUDE_EFFORT` | `medium` | 考える深さ。`low` にすると速く安くなり、`high` にすると丁寧になるが遅くなる |
| `HISTORY_TURNS` | `20` | 1人あたり覚えておく会話の往復数 |
| `HISTORY_TTL_MINUTES` | `720` | この時間やり取りがなければ新しい相談として扱う |
| `PORT` | `3000` | サーバーのポート |

## 注意点

- 会話の記憶はサーバーのメモリ上にあり、**再起動すると消えます**。長期的に相談者情報（生年月日など）を保存したい場合はデータベース連携を追加してください。
- 返信は通常「リプライ」として送るため無料（月間メッセージ数にカウントされない）ですが、返信に時間がかかりすぎた場合のみプッシュメッセージで送るため、その分は公式LINEの月間メッセージ数にカウントされます。
- AI 占いであることの表示方法や、有料鑑定を行う場合の特定商取引法の表記などは、運営方針に合わせてご確認ください。

## ファイル構成

```
line-fortune-bot/
├── fortune/            ← 占い師の設定（ここを編集する）
│   ├── persona.md
│   ├── rules.md
│   ├── welcome.txt
│   └── methods/        ← 使う占術を置く
│       ├── _template.md
│       └── examples/   ← 記入例（タロット・数秘術・おみくじ）
└── src/
    ├── server.js       ← LINE Webhook サーバー
    ├── fortune.js      ← Claude で占い師の返信を作る
    ├── tools.js        ← タロット・ランダム抽選の道具
    ├── prompt.js       ← 設定ファイルから指示文を組み立てる
    ├── history.js      ← 会話の記憶
    ├── line.js         ← LINE 用に長文を分割
    ├── chat-cli.js     ← LINE なしで試す会話ツール（npm run chat）
    └── check.js        ← 設定の読み込み確認（npm run check）
```
