# 外壁塗装見積もりシステム - デプロイガイド

このガイドでは、外壁塗装見積もりシステムをRenderにデプロイする手順を説明します。

## 前提条件

- GitHubアカウント
- Renderアカウント
- LINE Developersアカウント
- Google Cloud Platformアカウント（Google Sheets APIを使用する場合）
- Cloudinaryアカウント（画像管理を使用する場合）

## デプロイ手順

### 1. GitHubリポジトリの準備

1. GitHubにログイン
2. リポジトリ「line-paint-estimator」にアクセス
3. 提供されたZIPファイルの内容をリポジトリにアップロード
   - 既存のファイルを上書きする場合は確認メッセージに注意
4. コミットメッセージ「Integrate new web system with existing LIFF app」を入力
5. 変更をコミット

### 2. 環境変数の設定

以下の環境変数を準備します：

```
# LINE Bot設定
LINE_CHANNEL_ACCESS_TOKEN=your_access_token
LINE_CHANNEL_SECRET=your_channel_secret

# Google Sheets設定
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}

# Cloudinary設定
CLOUDINARY_URL=cloudinary://your_api_key:your_api_secret@your_cloud_name

# メール設定
MAIL_USER=your_email@example.com
MAIL_PASS=your_email_password
```

### 3. Renderでのデプロイ

1. Renderダッシュボードにログイン
2. 「New +」ボタンをクリック
3. 「Web Service」を選択
4. GitHubリポジトリを接続
5. 以下の設定を行う：
   - **Name**: line-paint-estimator
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server_integrated.js`
6. 「Advanced」をクリックして環境変数を設定
7. 「Create Web Service」をクリック

### 4. LINE Developersコンソールの設定

1. LINE Developersコンソールにログイン
2. プロバイダーとチャネルを選択
3. Webhook URLを更新：
   - `https://your-render-app.onrender.com/webhook`
4. Webhook利用を有効化
5. LIFFアプリの設定を更新：
   - エンドポイントURL: `https://your-render-app.onrender.com/liff`

### 5. デプロイの確認

1. Renderのデプロイログを確認
2. デプロイが完了したら、以下のURLにアクセス：
   - メインページ: `https://your-render-app.onrender.com/`
   - LIFFアプリ: `https://your-render-app.onrender.com/liff`
3. 各機能が正常に動作することを確認

## トラブルシューティング

### デプロイに失敗する場合

1. Renderのログを確認
2. 環境変数が正しく設定されているか確認
3. package.jsonの依存関係に問題がないか確認

### Webhookが機能しない場合

1. LINE Developersコンソールで設定を確認
2. Webhook URLが正しいか確認
3. サーバーログでエラーを確認

### 静的ファイルが表示されない場合

1. サーバーコードで静的ファイル配信の設定を確認
2. ファイルパスが正しいか確認

## 本番環境での注意事項

1. **セキュリティ**:
   - 環境変数を適切に管理
   - アップロードされたファイルのバリデーションを確認

2. **パフォーマンス**:
   - 大量のアクセスがある場合はスケーリングを検討
   - 画像の最適化を行う

3. **メンテナンス**:
   - 定期的にログを確認
   - セッションデータの定期的なクリーンアップを実装

## サポート

問題が発生した場合は、以下の方法でサポートを受けることができます：

1. GitHubリポジトリでIssueを作成
2. 開発者に直接連絡
3. このドキュメントのトラブルシューティングセクションを参照

