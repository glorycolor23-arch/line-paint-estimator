# 外壁塗装見積もりシステム

外壁塗装の概算見積もりを簡単に取得できるシステムです。LIFFアプリと通常のWebアプリの2つの方法で利用できます。

## 機能

### LIFFアプリ（LINE内で動作）
- 12の質問に答えるだけで概算見積もりを取得
- 建物の階数、間取り、築年数などの情報を入力
- 外壁材や屋根材の選択
- 概算見積もり結果の表示

### 通常のWebアプリ
- Webブラウザで利用可能な見積もりフォーム
- LINE友達登録による概算見積もり結果の確認
- 詳細見積もり依頼フォーム（お客様情報と建物の写真をアップロード）

## システム構成

### フロントエンド
- LIFFアプリ（LINE Frontend Framework）
- 通常のWebアプリ（HTML/CSS/JavaScript）

### バックエンド
- Node.js/Express
- LINE Messaging API
- Google Sheets API（データ保存）
- Cloudinary（画像管理）

## セットアップ方法

### 必要な環境変数
`.env`ファイルに以下の環境変数を設定してください：

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

### インストール方法

```bash
# 依存関係のインストール
npm install

# サーバーの起動
npm start
```

## ディレクトリ構造

```
/
├── liff/               # LIFFアプリ
│   ├── app.js          # LIFFアプリのメインスクリプト
│   ├── index.html      # LIFFアプリのHTML
│   ├── style.css       # LIFFアプリのスタイル
│   └── ...
├── public/             # 通常のWebアプリ
│   ├── css/            # スタイルシート
│   ├── js/             # JavaScript
│   ├── images/         # 画像ファイル
│   ├── index.html      # メインページ
│   ├── form.html       # 質問フォーム
│   ├── line-register.html # LINE友達登録ページ
│   └── detail-form.html # 詳細見積もり依頼フォーム
├── data/               # データ保存ディレクトリ
├── uploads/            # アップロードファイル保存ディレクトリ
├── server.js           # サーバーファイル
├── server_integrated.js # 統合サーバーファイル（新旧システム対応）
└── package.json        # 依存関係
```

## 使用方法

### LIFFアプリ
1. LINEアプリ内でLIFFアプリを開く
2. 12の質問に回答
3. 概算見積もり結果を確認

### 通常のWebアプリ
1. Webブラウザでアクセス
2. 12の質問に回答
3. LINE友達登録で概算見積もり結果を確認
4. 詳細見積もり依頼フォームに情報を入力

## デプロイ

Renderを使用してデプロイします：

1. GitHubリポジトリをRenderに接続
2. 環境変数を設定
3. デプロイを実行

## 注意事項

- 概算見積もりは参考価格です。正確な見積もりは現地調査後に提供されます。
- 写真アップロードのファイルサイズ上限は5MBです。
- 個人情報は厳重に管理され、営業目的での連絡はいたしません。

## ライセンス

このプロジェクトは独自のライセンスで提供されています。詳細はお問い合わせください。

