# LINE塗装見積もりアプリ v21 修正内容

## バージョン: v21
**作成日**: 2025年11月8日

---

## 📋 v21の修正内容

### 1. 概算見積もりアンケート最終確認画面の変更

**変更点:**
- 最終確認画面の「はい」「いいえ」ボタンを削除
- 「次へ」ボタンのテキストを「**この内容で概算見積もりを依頼**」に変更
- ボタンをクリックすると直接見積もり依頼が送信される仕様に変更

**修正ファイル:**
- `public/index.html` - 最終確認画面のHTML構造を変更
- `public/app.js` - ボタンクリック時の処理ロジックを変更

---

## 🚀 デプロイ手順

### 1. GitHub Desktopでのデプロイ

1. このフォルダ全体を既存のプロジェクトフォルダに上書き
2. GitHub Desktopを開く
3. 変更されたファイルを確認:
   - `public/index.html`
   - `public/app.js`
4. コミットメッセージ入力: `v21: 最終確認画面のボタン変更（はい/いいえ削除、依頼ボタンに統一）`
5. 「Commit to main」をクリック
6. 「Push origin」をクリック
7. Renderが自動デプロイを開始（約2-3分）

### 2. Renderでの手動再デプロイ（重要）

**LINEメッセージの内容が更新されない問題の対処:**

以前のバージョンで`routes/estimate.js`を修正済みですが、本番環境に反映されていない可能性があります。
v21デプロイ後、以下の手順で手動再デプロイを実行してください:

1. [Render Dashboard](https://dashboard.render.com/)にログイン
2. 「line-paint-estimator」サービスを選択
3. 右上の「Manual Deploy」をクリック
4. 「Deploy latest commit」を選択
5. デプロイ完了を待つ（約2-3分）

これにより、`routes/estimate.js`の変更（LINEメッセージを2つのバブルに変更）が確実に反映されます。

---

## ⚠️ 既知の問題と対処方法

### 問題1: 管理者メールが届かない

**現象:**
- 詳細見積もりフォーム送信後、管理者メール（matsuo@graphity.co.jp）にメールが届かない
- エラーログに「SMTP connection timeout」が表示される

**原因:**
- Xserver SMTPのポート465での接続がタイムアウトしている可能性

**対処方法A: SMTPポート変更（簡単）**

Renderの環境変数を以下のように変更:

```
SMTP_PORT=587
SMTP_SECURE=false
```

変更手順:
1. Render Dashboard → line-paint-estimator → Environment
2. `SMTP_PORT`の値を`587`に変更
3. `SMTP_SECURE`の値を`false`に変更
4. 「Save Changes」をクリック
5. サービスが自動的に再起動

**対処方法B: SendGrid利用（推奨）**

より安定したメール送信のため、SendGridへの切り替えを推奨します。

必要な環境変数:
```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=（SendGrid APIキー）
SMTP_FROM=line-paint@graphity.co.jp
```

SendGrid設定手順:
1. [SendGrid](https://sendgrid.com/)でアカウント作成（無料プランで月100通まで送信可能）
2. API Keyを作成
3. Renderの環境変数を上記の値に変更
4. 「Save Changes」をクリック

---

## 🧪 テスト項目

v21デプロイ後、以下の項目をテストしてください:

### 概算見積もりアンケート
1. ✅ 各質問に回答できる
2. ✅ 最終確認画面で「この内容で概算見積もりを依頼」ボタンが表示される
3. ✅ ボタンをクリックすると送信される
4. ✅ LINEメッセージが届く（2つのバブル形式）
5. ✅ 送信完了画面が表示される

### 詳細見積もりフォーム
1. ✅ 各項目に入力できる
2. ✅ 画像ファイルをアップロードできる
3. ✅ サムネイル表示される
4. ✅ 送信ボタンをクリックするとローディング画面が表示される
5. ✅ LINEメッセージが届く
6. ✅ 管理者メールが届く（メール設定修正後）

---

## 📁 主要ファイル構成

```
line-paint-estimator-main/
├── server.js                 # メインサーバーファイル
├── routes/
│   ├── estimate.js          # 概算見積もり処理（LINEメッセージ送信）
│   └── details.js           # 詳細見積もり処理（メール送信）
├── public/
│   ├── index.html           # 概算見積もりアンケートHTML（v21で修正）
│   ├── app.js               # 概算見積もりロジック（v21で修正）
│   ├── liff.html            # 詳細見積もりフォームHTML
│   ├── liff.js              # 詳細見積もりロジック
│   └── styles.css           # 共通スタイル
├── lib/
│   ├── mailer.js            # メール送信処理
│   └── sheets.js            # Google Sheets連携（現在無効化）
└── package.json             # 依存パッケージ
```

---

## 🔧 環境変数一覧

Renderで設定されている環境変数:

```
LINE_CHANNEL_ACCESS_TOKEN=（LINEチャネルアクセストークン）
LINE_CHANNEL_SECRET=（LINEチャネルシークレット）
LIFF_ID=（LIFF ID）
ADMIN_EMAIL=matsuo@graphity.co.jp

# メール設定（Xserver SMTP）
SMTP_HOST=sv16187.xserver.jp
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=line-paint@graphity.co.jp
SMTP_PASS=aM.q2eGzmjM=
SMTP_FROM=line-paint@graphity.co.jp

# Google Sheets（現在無効化）
# GOOGLE_SHEETS_ID=（シートID）
# GOOGLE_SERVICE_ACCOUNT_EMAIL=（サービスアカウント）
# GOOGLE_PRIVATE_KEY=（秘密鍵）
```

---

## 📞 サポート

問題が発生した場合は、以下の情報を添えてご連絡ください:

1. 発生した問題の詳細
2. エラーメッセージ（あれば）
3. 操作手順
4. Renderのログ（Dashboard → Logs）

---

## 📝 変更履歴

### v21 (2025-11-08)
- 概算見積もりアンケート最終確認画面のボタン変更
  - 「はい」「いいえ」ボタンを削除
  - 「次へ」ボタンを「この内容で概算見積もりを依頼」に変更
  - クリック時の処理ロジックを修正

### v20 (以前)
- ローディングアニメーションを3点波形に変更
- 詳細フォームのUI改善
- 画像サムネイル表示機能追加
- ボタンレイアウトを縦配置に変更

---

**作成者**: Manus AI Assistant  
**連絡先**: matsuo@graphity.co.jp

