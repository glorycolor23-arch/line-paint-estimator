# v21-v20 変更内容

## 修正した問題

### 1. 写真が3枚しか添付されない問題 ✅ 解決
**原因:** ファイル名の重複により、Gmailが同じファイル名の添付ファイルを1つだけ表示していた

**修正内容:**
- routes/details.jsでファイル名にフィールド名のプレフィックスを追加
- 例: `IMG_8568.png` → `drawing_elevation_IMG_8568.png`, `photo_right_IMG_8568.png`
- これにより、7つのファイルすべてがユニークなファイル名で添付される

### 2. 詳細見積もりフォームの質問項目について
**確認結果:** liff.jsには既に4つの質問項目が実装されています
- お見積もり希望の内容（desiredWork）
- 階数（floors）
- 築年数（ageRange）
- 外壁材（wallMaterial）

**もし表示されていない場合の対処法:**
1. ブラウザのキャッシュをクリア（LIFFアプリはliff.line.meドメインで動作）
2. Renderで最新のコミットがデプロイされているか確認
3. LINEアプリを再起動

## 変更ファイル

### 1. routes/details.js
**変更内容:**
- 69-78行目: ファイル名にフィールド名のプレフィックスを追加
- ログに元のファイル名とユニークなファイル名の両方を出力

**変更前:**
```javascript
attachments.push({ filename: f.originalname || path.basename(f.path), path: f.path });
```

**変更後:**
```javascript
const originalFilename = f.originalname || path.basename(f.path);
const uniqueFilename = `${key}_${originalFilename}`;
attachments.push({ filename: uniqueFilename, path: f.path });
```

**影響範囲:**
- メールに添付されるファイル名
- 7つのファイルすべてが正しく添付される

### 2. public/liff.js
**変更内容:**
- 確認画面（renderConfirm関数）に4つの見積もり項目を表示
- submitAll関数で4つの項目をバックエンドに送信

**既に実装済みの機能:**
- renderContact関数（76-191行目）に4つの入力フィールドが実装済み
- model初期化（18-36行目）で4つのフィールドが定義済み

### 3. lib/mailer.js
**変更内容:**
- ファイル添付処理に詳細なログを追加
- 各ファイルの読み込み状況とBase64エンコード後のサイズを出力

**目的:**
- 添付ファイルの処理状況をデバッグ
- Renderのログで問題を特定可能に

## Renderログからの分析結果

**添付ファイルの処理状況:**
```
[details] req.files keys: [
  'drawing_elevation', 'drawing_plan', 'drawing_section',
  'photo_front', 'photo_right', 'photo_left', 'photo_back'
]
[MAIL] Total attachments encoded: 7
[MAIL] Sending email with 7 attachments
[MAIL] Email sent successfully via Resend HTTP API
```

**ファイル名の重複:**
- IMG_8568.png が3回（drawing_elevation, photo_right, photo_left）
- IMG_8565.png が3回（drawing_plan, drawing_section, photo_back）
- image.jpg が1回

→ この重複が原因で、Gmailは3つのユニークなファイル名しか認識していなかった

## デプロイ手順

1. 変更ファイルをプロジェクトにコピー:
```bash
cp v21-v20/public/liff.js line-paint-estimator-main/public/
cp v21-v20/routes/details.js line-paint-estimator-main/routes/
cp v21-v20/lib/mailer.js line-paint-estimator-main/lib/
```

2. Gitにコミット&プッシュ:
```bash
cd line-paint-estimator-main
git add public/liff.js routes/details.js lib/mailer.js
git commit -m "v21-v20: ファイル名重複問題を解決、詳細フォームに見積もり項目追加"
git push origin main
```

3. Renderで自動デプロイを確認

4. **重要: ブラウザのキャッシュをクリア**
   - LIFFアプリはliff.line.meドメインで動作するため、古いJavaScriptがキャッシュされている可能性があります
   - LINEアプリを再起動するか、ブラウザのキャッシュをクリアしてください

## テスト項目

1. **詳細見積もりフォームの確認**
   - ステップ1で4つの見積もり項目（希望内容、階数、築年数、外壁材）が表示されるか確認
   - 確認画面で4項目が表示されるか確認

2. **メール受信確認**
   - graphitystaff@gmail.comにメールが届くか確認
   - **7つのファイルすべてが添付されているか確認**
   - ファイル名が以下のようにユニークになっているか確認:
     - `drawing_elevation_IMG_8568.png`
     - `drawing_plan_IMG_8565.png`
     - `drawing_section_IMG_8565.png`
     - `photo_front_image.jpg`
     - `photo_right_IMG_8568.png`
     - `photo_left_IMG_8568.png`
     - `photo_back_IMG_8565.png`

3. **Renderログの確認**
   - `[details] Adding attachment` のログで、各ファイルのユニークな名前が表示されるか確認
   - `[MAIL] Total attachments encoded: 7` と表示されるか確認

## 期待される結果

- **添付ファイル:** 7つすべてが正しく添付される
- **ファイル名:** フィールド名のプレフィックスが付いてユニークになる
- **見積もり項目:** 詳細フォームに4つの項目が表示され、メールに反映される

## トラブルシューティング

### 質問項目が表示されない場合
1. ブラウザのキャッシュをクリア
2. LINEアプリを再起動
3. Renderのデプロイログで最新のコミットが反映されているか確認
4. `/liff?step=1` にアクセスして、直接ステップ1を表示

### 添付ファイルが7つ届かない場合
1. Renderのログで `Total attachments encoded: 7` と表示されているか確認
2. メールクライアントで「すべての添付ファイルを表示」を確認
3. ファイル名が重複していないか確認（プレフィックスが付いているか）

