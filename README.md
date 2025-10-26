# line-paint-estimator

外壁塗装の見積もりを Web フォーム + LINE（Messaging API / LIFF）で実現する雛形。  
Render へそのままデプロイ可能。Google スプレッドシート書き込み、管理者メール送信、画像アップロード対応。

## セットアップ（要約）

1. **Google スプレッドシート**
   - 新規シート（タブ: `Sheet1`）。A〜L は `日時 / leadId / lineUserId / 希望 / 築年数 / 階数 / 外壁材 / 概算 / 氏名 / 電話 / 郵便 / メモ` を推奨。
   - サービスアカウント（`GOOGLE_SERVICE_ACCOUNT_EMAIL`）を「編集者」で共有。

2. **LINE Developers**
   - Messaging API チャネルを作成 → `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` を取得。
   - Webhook URL：`https://<RenderのURL>/line/webhook` を設定し有効化。
   - 友だち追加用 URL（`LINE_ADD_FRIEND_URL`）を取得。
   - **LIFF** を作成（Size: Full / Endpoint URL: `https://<RenderのURL>/liff.html`）→ `LIFF_ID` を控える。  
     - `public/liff.html` の `{{LIFF_ID_REPLACED_AT_RUNTIME}}` を**実値に置換**してください。

3. **Render**
   - New Web Service → このリポジトリを指定。
   - Build: `npm install` / Start: `npm start`
   - 環境変数に `.env.example` を参考に投入。

4. **使い方**
   - `https://<RenderのURL>/` で最初のステップフォーム。
   - 確認 → 「LINEの友だち登録」 → 「LINEで見積額を受け取る」で概算金額が LINE に届く。
   - 「詳しい見積もりを依頼する」 → LIFF で詳細入力 → 送信で**メール**送付 & **スプレッドシート**に記録。

## 計算式の差し替え

- `lib/estimate.js` の `BASE / AGE_COEF / FLOOR_ADD / WALL_ADJ` と `computeEstimate()` を編集。

## 注意

- 本番は `lib/store.js` を Redis/Postgres 等へ移行推奨（現在はメモリ）。
- 添付ファイルの恒久保存が要る場合、Google Drive/S3/Cloudinary へ変更してください。
