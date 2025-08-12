# LINE 外壁塗装・概算見積りボット（超かんたんスターター）

## 0. 事前準備
- Node.js 18+ をインストール
- LINE Developersで **Messaging API** のチャネルを作成
  - Channel secret / Channel access token を控える
  - Botの応答は「Webhookを使用: ON」
  - 自動応答/あいさつメッセージは OFF 推奨（ダブり防止）

## 1. セットアップ
```bash
npm i
cp .env.example .env   # WindowsはコピーでOK
# .env を開いて、CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN を書き換え
```

## 2. 起動
```bash
node server.js
```

## 3. Webhook公開（ローカル開発）
ngrokなどで公開します：
```bash
ngrok http 3000
```
表示された `https://xxxx.ngrok.io/webhook` を LINE Developers の Webhook URL に設定 → Verify で 200 が返ればOK。

## 4. テスト
スマホでBotを友だち追加 → 「見積もり」と送信 → ボタン回答＆写真アップ → 概算金額が出れば成功。

## 5. 本番デプロイ（例: Render）
1) GitHubへこのフォルダをpush  
2) Render（またはRailway/Fly.io等）で新しいWebサービス作成  
3) 環境変数に `CHANNEL_SECRET` と `CHANNEL_ACCESS_TOKEN` を設定  
4) 起動後のURLに `/webhook` を付けてLINEに登録

## よくあるつまづき
- Verifyが失敗：Webhook URLの末尾が `/webhook` になっているか / Botの「Webhookを使用」がONか
- 403/401：Access Tokenが古い or 誤り（再発行）
- ダブル返信：LINE公式アカウントの自動応答メッセージがONになっている

## カスタマイズ
- アイコン画像は `server.js` の `ICONS` を自社CDNのHTTPS画像へ差し替え
- 概算ロジックは `estimateCost()` を実単価へ調整（面積・グレード別など）
- 画像保存は `uploads/` → S3など外部ストレージに変更推奨
