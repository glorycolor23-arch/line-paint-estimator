# 外壁塗装見積もりシステム 修正ファイル v14

## 問題の原因

Google Sheets APIの認証エラーが発生し、システム全体が動作しなくなっていました。

**エラーログ**:
```
error: 'invalid_grant',
error_description: 'Invalid JWT Signature.'
```

このエラーにより:
- 概算見積もり完了後のLINE友だち登録で「サーバーへ接続が出来ません」エラー
- 詳細見積もりフォームの送信ボタンが反応しない

---

## 修正内容

### lib/sheets.js の修正

**Google Sheets連携を一時的に無効化**しました。

#### 修正前:
```javascript
function canAppend() {
  return Boolean(
    CONFIG.GOOGLE_SHEETS_ID &&
    CONFIG.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    CONFIG.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
}
```

#### 修正後:
```javascript
function canAppend() {
  console.log('[SHEETS] Google Sheets integration is temporarily disabled');
  return false;  // 一時的に無効化
}
```

これにより:
- ✅ Sheets APIエラーが発生しない
- ✅ メール送信とLINEメッセージ送信が正常に動作する
- ✅ 概算見積もり完了後のLINE友だち登録が正常に動作する
- ✅ 詳細見積もりフォームの送信が正常に動作する

---

## ファイル配置方法

### GitHub Desktopを使用する場合:

1. **Repository → Show in Finder** でリポジトリフォルダを開く
2. ZIPファイルを解凍して、以下のファイルを配置:
   - `lib/sheets.js` → リポジトリの `lib` フォルダに上書き
3. GitHub Desktopでコミット:
   - Summary: `v14: Google Sheets連携を一時的に無効化`
4. **Push origin** をクリック
5. Renderで自動デプロイを確認

---

### GitHubブラウザを使用する場合:

1. https://github.com/glorycolor23-arch/line-paint-estimator を開く
2. `lib/sheets.js` を開いて編集ボタン(鉛筆アイコン)をクリック
3. ファイル内容を全て削除して、修正ファイルの内容をコピー&ペースト
4. **Commit changes** をクリック
5. Renderで自動デプロイが開始されることを確認

---

## デプロイ後の動作確認

### 1. 概算見積もり完了後の確認
1. ✅ 新しく概算見積もりを完了
2. ✅ LINE友だち追加
3. ✅ **「サーバーへ接続が出来ません」エラーが出ないことを確認**
4. ✅ LINEに概算見積もりのメッセージが届くことを確認

### 2. 詳細見積もりフォームの確認
1. ✅ LINEから詳細見積もりフォームを開く
2. ✅ 全ての項目を入力
3. ✅ 送信ボタンをクリック
4. ✅ **送信ボタンが正常に動作することを確認**
5. ✅ 「詳細見積もりのご依頼ありがとうございます」のLINEメッセージが届くことを確認

### 3. メール送信の確認
1. ✅ 管理者メールアドレス(matsuo@graphity.co.jp)に見積もり依頼メールが届くことを確認
2. ✅ メールに図面・写真が添付されていることを確認

---

## 今後の対応

Google Sheets連携を再度有効化する場合:

1. Renderの環境変数に `GOOGLE_SERVICE_ACCOUNT_JSON` を追加
2. GoogleからダウンロードしたサービスアカウントJSONファイルの**内容全体**を設定
3. `lib/sheets.js` の `canAppend()` 関数を元に戻す

---

## 修正ファイル一覧

- `lib/sheets.js` - Google Sheets連携を一時的に無効化

---

## バージョン履歴

- **v14** (2025-11-08): Google Sheets連携を一時的に無効化
- **v13** (2025-11-08): leadId必須チェックを削除、独立フォーム対応
- **v12** (2025-11-08): 構文エラー修正、LINEメッセージ変更、leadId削除、サムネイル表示追加
- **v11** (2025-11-08): LINEメッセージ変更、サムネイル表示追加、leadIdエラー修正
- **v10** (2025-11-08): LINEメッセージ改善、建物写真参考画像追加、サムネイル拡大

