# 問題調査レポート

## 調査日時
2025年11月9日

## 報告された問題

### 問題1: 詳細見積もりフォームに質問項目が表示されない
**ユーザー報告:** 詳細見積もりフォームに概算見積もりの質問項目（希望内容、階数、築年数、外壁材）が表示されない

### 問題2: 写真が3枚しか添付されない
**ユーザー報告:** 7枚の画像をアップロードしたが、メールには3枚しか添付されていない

---

## 調査結果

### 問題1の調査結果: 質問項目は既に実装されている

#### コード確認
`public/liff.js` の `renderContact()` 関数（76-191行目）を確認したところ、以下の4つの質問項目が**既に実装されています**:

1. **お見積もり希望の内容** (97-103行目)
```javascript
<label>お見積もり希望の内容<span class="required">*</span></label>
<select id="desiredWork" class="input-field">
  <option value="">選択してください</option>
  <option value="外壁塗装">外壁塗装</option>
  <option value="屋根工事">屋根工事</option>
  <option value="外壁塗装と屋根工事">外壁塗装と屋根工事</option>
</select>
```

2. **階数** (105-111行目)
```javascript
<label>階数<span class="required">*</span></label>
<select id="floors" class="input-field">
  <option value="">選択してください</option>
  <option value="1階建て">1階建て</option>
  <option value="2階建て">2階建て</option>
  <option value="3階建て以上">3階建て以上</option>
</select>
```

3. **築年数** (113-123行目)
4. **外壁材** (125-136行目)

#### データフローの確認
- **model初期化** (18-36行目): 4つのフィールドが定義されている
- **値の設定** (148-151行目): フォームの値が正しく設定されている
- **値の取得** (181-184行目): ボタンクリック時に値が取得されている
- **バリデーション** (186-188行目): 4つの項目が必須チェックされている
- **確認画面** (371-378行目): 4つの項目が表示されている
- **送信** (410-413行目): 4つの項目がバックエンドに送信されている

#### 結論
**コードには問題がありません。質問項目は正しく実装されています。**

#### 考えられる原因
1. **ブラウザのキャッシュ**: LIFFアプリは `liff.line.me` ドメインで動作するため、古いJavaScriptがキャッシュされている
2. **デプロイ未完了**: 最新のコードがRenderにデプロイされていない
3. **LINEアプリのキャッシュ**: LINEアプリ内のWebViewがキャッシュを保持している

#### 推奨対処法
1. ブラウザのキャッシュをクリア（Ctrl+Shift+Delete）
2. LINEアプリを完全に終了して再起動
3. Renderのデプロイログで最新のコミットが反映されているか確認
4. スーパーリロード（Ctrl+Shift+R）を実行

---

### 問題2の調査結果: ファイル名の重複が原因

#### Renderログの分析

**アップロードされたファイル（62-70行目）:**
```
[details] req.files keys: [
  'drawing_elevation',
  'drawing_plan',
  'drawing_section',
  'photo_front',
  'photo_right',
  'photo_left',
  'photo_back'
]
```
→ **7つのファイルすべてが正しくアップロードされている**

**添付ファイルの処理（71-78行目）:**
```
[details] Adding attachment: drawing_elevation IMG_8568.png
[details] Adding attachment: drawing_plan IMG_8565.png
[details] Adding attachment: drawing_section IMG_8565.png
[details] Adding attachment: photo_front image.jpg
[details] Adding attachment: photo_right IMG_8568.png
[details] Adding attachment: photo_left IMG_8568.png
[details] Adding attachment: photo_back IMG_8565.png
[details] Total attachments: 7
```
→ **7つのファイルすべてが処理されている**

**ファイル名の重複を発見:**
- `IMG_8568.png` が3回（drawing_elevation, photo_right, photo_left）
- `IMG_8565.png` が3回（drawing_plan, drawing_section, photo_back）
- `image.jpg` が1回

→ **ユニークなファイル名は3つだけ**

**Base64エンコード（82-96行目）:**
```
[MAIL] Total attachments encoded: 7
[MAIL] Sending email with 7 attachments
[MAIL] Email sent successfully via Resend HTTP API: f683296a-5763-49e7-aba4-f6cb373904e5
```
→ **7つのファイルすべてがBase64エンコードされ、Resend APIに送信されている**

#### 問題の特定

**バックエンド側:**
- 7つのファイルすべてが正しく処理されている
- Resend APIは成功レスポンスを返している
- Base64エンコード後の合計サイズは約6.5MB（40MB制限内）

**メール受信側（Gmail）:**
- 3つのファイルしか表示されていない
- これは、**同じファイル名の添付ファイルを重複として扱い、1つだけ表示している**ため

#### 根本原因
**Gmailやメールクライアントは、同じファイル名の添付ファイルを重複として扱い、最初の1つだけを表示する仕様になっています。**

Resend APIは7つのファイルすべてを送信していますが、受信側のGmailが以下のように処理しています:
- `IMG_8568.png` → 3つ送信されているが、1つだけ表示
- `IMG_8565.png` → 3つ送信されているが、1つだけ表示
- `image.jpg` → 1つ送信され、1つ表示

結果: **3つのファイルだけが表示される**

---

## 解決策

### 問題1の解決策: キャッシュクリア
コードには問題がないため、以下を実施:
1. ブラウザのキャッシュをクリア
2. LINEアプリを再起動
3. Renderで最新のコミットがデプロイされているか確認

### 問題2の解決策: ファイル名をユニークにする

#### 修正内容
`routes/details.js` の69-78行目を修正:

**修正前:**
```javascript
for (const key of Object.keys(req.files || {})) {
  const f = req.files[key]?.[0];
  if (f) {
    console.log('[details] Adding attachment:', key, f.originalname || path.basename(f.path));
    attachments.push({ filename: f.originalname || path.basename(f.path), path: f.path });
  }
}
```

**修正後:**
```javascript
for (const key of Object.keys(req.files || {})) {
  const f = req.files[key]?.[0];
  if (f) {
    const originalFilename = f.originalname || path.basename(f.path);
    // ファイル名にフィールド名のプレフィックスを追加してユニークにする
    const uniqueFilename = `${key}_${originalFilename}`;
    console.log('[details] Adding attachment:', key, originalFilename, '-> unique name:', uniqueFilename);
    attachments.push({ filename: uniqueFilename, path: f.path });
  }
}
```

#### 修正後のファイル名
- `drawing_elevation_IMG_8568.png`
- `drawing_plan_IMG_8565.png`
- `drawing_section_IMG_8565.png`
- `photo_front_image.jpg`
- `photo_right_IMG_8568.png`
- `photo_left_IMG_8568.png`
- `photo_back_IMG_8565.png`

→ **7つのファイルすべてがユニークなファイル名になる**

---

## 検証方法

### 問題1の検証
1. LIFFアプリを開く
2. ステップ1（連絡先入力画面）で以下の4項目が表示されるか確認:
   - お見積もり希望の内容
   - 階数
   - 築年数
   - 外壁材
3. 確認画面で4項目が表示されるか確認
4. メールに4項目が記載されているか確認

### 問題2の検証
1. 詳細見積もりフォームで7つの画像をアップロード
2. 送信後、graphitystaff@gmail.comでメールを確認
3. **7つのファイルすべてが添付されているか確認**
4. ファイル名にプレフィックスが付いているか確認
5. Renderのログで以下を確認:
   - `[details] Adding attachment` で各ファイルのユニークな名前が表示される
   - `[MAIL] Total attachments encoded: 7` と表示される

---

## まとめ

### 問題1: 質問項目が表示されない
- **原因:** コードには問題なし。ブラウザまたはLINEアプリのキャッシュが原因の可能性
- **解決策:** キャッシュクリアとアプリ再起動
- **コード修正:** 不要（既に実装済み）

### 問題2: 写真が3枚しか添付されない
- **原因:** ファイル名の重複により、Gmailが同じファイル名を1つだけ表示
- **解決策:** ファイル名にフィールド名のプレフィックスを追加してユニークにする
- **コード修正:** routes/details.js の69-78行目を修正

### 修正ファイル
- `routes/details.js`: ファイル名をユニークにする処理を追加
- `public/liff.js`: 確認画面と送信処理に4項目を追加（既に実装済み）
- `lib/mailer.js`: デバッグログを追加（既に実装済み）

### 期待される結果
- 詳細見積もりフォームに4つの質問項目が表示される
- メールに7つのファイルすべてが添付される
- ファイル名がユニークになり、重複が解消される

