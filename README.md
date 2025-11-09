# v21-v19 変更内容

## 概要
詳細見積もりフォームに概算見積もりの質問項目を追加し、メールレイアウトを改善しました。

## 変更ファイル

### 1. public/liff.js
**変更内容:**
- 確認画面（renderConfirm関数）に以下の4項目を追加表示:
  - お見積もり希望の内容（desiredWork）
  - 階数（floors）
  - 築年数（ageRange）
  - 外壁材（wallMaterial）
- submitAll関数で上記4項目をFormDataに追加して送信

**影響範囲:**
- 詳細見積もりフォームの確認画面
- バックエンドへのデータ送信

### 2. routes/details.js
**変更内容:**
- req.bodyから4つの新規項目（desiredWork, floors, ageRange, wallMaterial）を受信
- メールのHTMLレイアウトを変更:
  - 順序: 名前 → 電話番号 → 郵便番号 → 住所 → 見積もり内容 → LINE表示名 → LINE回答URL
  - 見積もり内容セクションで、詳細フォームから送信された項目を優先表示（概算見積もりデータがない場合にも対応）
  - 重複していた「希望の工事内容」を削除

**影響範囲:**
- 管理者に送信されるメールの内容と順序

### 3. lib/mailer.js
**変更内容:**
- ファイル添付処理に詳細なログを追加:
  - 添付ファイル数
  - 各ファイルの読み込み状況
  - Base64エンコード後のサイズ
  - 送信時の添付ファイル数

**目的:**
- 画像添付の問題（7枚中2-3枚しか届かない）をデバッグするため
- Renderのログで添付ファイルの処理状況を確認可能に

## デプロイ手順

1. 変更ファイルをプロジェクトにコピー:
```bash
cp v21-v19/liff.js line-paint-estimator-main/public/
cp v21-v19/details.js line-paint-estimator-main/routes/
cp v21-v19/mailer.js line-paint-estimator-main/lib/
```

2. Gitにコミット&プッシュ:
```bash
cd line-paint-estimator-main
git add public/liff.js routes/details.js lib/mailer.js
git commit -m "v21-v19: 詳細フォームに概算項目追加、メールレイアウト改善、添付ログ追加"
git push origin main
```

3. Renderで自動デプロイを確認

## テスト項目

1. **詳細見積もりフォームの確認画面**
   - 4つの見積もり項目（希望内容、階数、築年数、外壁材）が表示されるか確認

2. **メール受信確認**
   - graphitystaff@gmail.comにメールが届くか確認
   - メールの項目順序が正しいか確認（名前→電話→郵便→住所→見積もり内容→LINE表示名→LINE回答URL）
   - 見積もり内容セクションに4項目が表示されるか確認

3. **画像添付の確認**
   - Renderのログで添付ファイルのログを確認
   - 7枚の画像すべてが添付されているか確認
   - ログに「Total attachments encoded: 7」と表示されるか確認

## 既知の問題と調査中の項目

### 画像添付問題
- **症状**: 7枚の画像のうち2-3枚しかメールに添付されない
- **調査**: lib/mailer.jsに詳細ログを追加済み
- **次のステップ**: 
  1. Renderのログで「Total attachments encoded」の数を確認
  2. すべて7と表示される場合、Resend APIの制限を確認
  3. 一部しかエンコードされていない場合、ファイル読み込みエラーを調査

## 備考
- 概算見積もりを経由せず、直接詳細フォームにアクセスした場合でも、4項目は「（未回答）」と表示されます
- leadIdがある場合は、概算見積もりのデータ（lead.answers）も参照されます

