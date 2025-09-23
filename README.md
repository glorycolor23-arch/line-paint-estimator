# Repo-compatible drop-in for ③以降
この一式は、ルート直下に `webhook.js / lineLogin.js / estimate.js / details.js / server.js / app.js` がある構成です。
既存の不足ファイルはこの内容で**上書き or 追加**してください。

- Webhook: POST /line/webhook
- Login Callback: GET /auth/line/callback
- 概算保存: POST /api/estimate
- 詳細送信: POST /api/details
- LIFF: /public/liff.html
