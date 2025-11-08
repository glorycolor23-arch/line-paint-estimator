# 外壁塗装見積もりシステム 修正ファイル v17

## ✨ v17の修正内容

### 1. メール送信処理の修正 🔧
**ファイル**: `routes/details.js`

v16で `setImmediate()` を使用していたメール送信処理が実行されない問題を修正しました。

**変更内容**:
- `setImmediate()` を削除
- 通常の非同期処理 `(async () => { ... })()` に変更
- ログ出力を追加して動作を確認しやすくしました

**期待される動作**:
- メール送信が正常に実行される
- ログに `[details] Starting email send...` が表示される
- 成功時: `[details] Admin email sent successfully`
- 失敗時: `[details] sendAdminMail failed (non-fatal): [エラー内容]`

---

## 📦 修正ファイル一覧

- `routes/estimate.js` - LINEメッセージを2つの吹き出しに変更(v16から継続)
- `routes/details.js` - メール送信処理を修正 ✨ **NEW!**
- `public/liff.js` - スクロール位置、区切り線、送信中画面を追加(v16から継続)
- `lib/sheets.js` - Google Sheets連携を一時的に無効化(v14から継続)

---

## 🚀 デプロイ手順

### 重要: routes/estimate.js を必ず上書きしてください!

v16をデプロイした際、`routes/estimate.js` が更新されていない可能性があります。
今回は**必ず全てのファイルを上書き**してください。

### 1. GitHub Desktopでファイルを配置
1. **Repository → Show in Finder** でリポジトリフォルダを開く
2. ZIPファイルを解凍して、**4つのファイル全て**を配置:
   - `routes/estimate.js` → リポジトリの `routes` フォルダに**上書き** ⚠️
   - `routes/details.js` → リポジトリの `routes` フォルダに**上書き**
   - `public/liff.js` → リポジトリの `public` フォルダに**上書き**
   - `lib/sheets.js` → リポジトリの `lib` フォルダに**上書き**

### 2. コミット&プッシュ
3. GitHub Desktopでコミット:
   - Summary: `v17: メール送信処理を修正、LINEメッセージ変更`
4. **Push origin** をクリック

### 3. Renderで自動デプロイを確認
5. Renderのダッシュボードでデプロイログを確認
6. ビルドエラーがないことを確認

---

## ✅ デプロイ後の動作確認

### 1. 概算見積もり完了後のLINEメッセージ ⚠️ 重要!
- [ ] 概算見積もりフォームを送信
- [ ] LINE友だち追加
- [ ] **2つの吹き出し**でメッセージが届くことを確認:
  - 1つ目: 回答内容と金額(テキストメッセージ)
  - 2つ目: 詳細見積もりへの誘導文とボタン(ボタンテンプレート)

**まだ3つの吹き出しの場合**: `routes/estimate.js` が更新されていません。再度上書きしてデプロイしてください。

### 2. 詳細見積もりフォームの送信
- [ ] 詳細見積もりフォームを開く
- [ ] 全ての項目を入力して送信
- [ ] 送信中画面が表示される
- [ ] 送信完了画面が表示される
- [ ] LINEで確認メッセージが届く

### 3. メール送信の確認
- [ ] Renderのログで以下を確認:
  - `[details] Starting email send...` が表示される
  - `[details] Admin email sent successfully` または `[details] sendAdminMail failed (non-fatal):` が表示される
- [ ] `matsuo@graphity.co.jp` にメールが届くことを確認

---

## 🔧 Xserver SMTP設定

現在、以下の設定でXserver SMTPを使用しています:

```
SMTP_HOST=sv16187.xserver.jp
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=line-paint@graphity.co.jp
SMTP_PASS=aM.q2eGzmjM=
SMTP_FROM=line-paint@graphity.co.jp
ADMIN_EMAIL=matsuo@graphity.co.jp
```

### もしメールが届かない場合

#### 1. ポート587(STARTTLS)を試す
Renderの環境変数を以下に変更:
```
SMTP_PORT=587
SMTP_SECURE=false
```

#### 2. Renderのログを確認
- タイムアウトエラーが表示される場合、RenderのIPがブロックされている可能性
- その場合、SendGridなどの別のサービスを検討

---

## 📝 バージョン履歴

### v17 (最新) - 2025-11-08
- メール送信処理を修正(`setImmediate()` → 通常の非同期処理)
- ログ出力を追加してデバッグしやすくした

### v16 - 2025-11-08
- LINEメッセージを2つの吹き出しに変更
- 建物写真アップロード画面のスクロール位置を最上部に
- ファイル選択ボタン間に区切り線を追加
- 送信中の画面を表示

### v15 - 2025-11-08
- メール送信を非同期化してタイムアウトエラーを解決

### v14 - 2025-11-08
- Google Sheets連携を一時的に無効化

### v13 - 2025-11-08
- leadId必須チェックを削除
- 詳細見積もりフォームを独立化

---

## 📧 サポート

問題が発生した場合は、以下の情報をご提供ください:
1. Renderのデプロイログ
2. エラーメッセージのスクリーンショット
3. 発生した操作手順

---

## 📞 連絡先

管理者メールアドレス: matsuo@graphity.co.jp

