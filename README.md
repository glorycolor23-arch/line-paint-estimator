# 外壁塗装見積もりシステム 修正ファイル v13

## エラーの原因

デプロイ後のテストで以下のエラーが発生しました:

### エラー1: 「サーバーへ接続が出来ません」
概算見積もりアンケート後、LINE友だち登録連携で発生。

### エラー2: 「送信に失敗しました: lead not found」
詳細見積もりアンケート回答後送信で発生。

**Renderのログ**:
```
[details] Received request: {
  leadId: undefined,  ← leadIdがない
  lineUserId: 'U75d7aa29d88e9899d97db953e0fea88d',
  displayName: 'Kenji Matsuo',
  ...
}
[details] lead not found { leadId: undefined }
```

---

## 問題の原因

`routes/details.js` の `/api/details` エンドポイントで、**leadIdを必須として処理している**ため、leadIdがない場合に「lead not found」エラーが発生していました。

```javascript
// 問題のあったコード
const lead = getLead(leadId);
if (!lead) return res.status(404).json({ error: 'lead not found' });
```

詳細見積もりフォームは概算見積もりから独立したフォームに変更したため、leadIdは存在しません。しかし、サーバー側のコードはleadIdを必須として処理していたため、エラーになっていました。

---

## 修正内容

### routes/details.js の修正

**leadId必須チェックを削除**し、leadIdがなくても動作するように変更しました。

#### 修正前:
```javascript
const lead = getLead(leadId);
if (!lead) return res.status(404).json({ error: 'lead not found' });
```

#### 修正後:
```javascript
// leadIdは任意: 概算見積もりから来た場合のみ存在する
let lead = null;
if (leadId) {
  lead = getLead(leadId);
  if (lead) {
    console.log('[details] Lead found:', lead);
    updateLeadDetails(leadId, { name, phone, postal, address, addressDetail, lineUserId, displayName });
  } else {
    console.warn('[details] leadId provided but lead not found:', { leadId });
  }
} else {
  console.log('[details] No leadId provided (independent detail form)');
}
```

#### その他の変更:
- スプレッドシートに保存する際、leadIdがない場合は「N/A」を記録
- メール送信時、leadIdがない場合は「独立フォーム」と表示
- 概算金額がない場合は「N/A」を表示

---

## ファイル配置方法

### GitHub Desktopを使用する場合:

1. **Repository → Show in Finder** でリポジトリフォルダを開く
2. ZIPファイルを解凍して、以下のファイルを配置:
   - `routes/details.js` → リポジトリの `routes` フォルダに上書き
3. GitHub Desktopでコミット:
   - Summary: `v13: leadId必須チェックを削除、独立フォーム対応`
4. **Push origin** をクリック
5. Renderで自動デプロイを確認

---

### GitHubブラウザを使用する場合:

1. https://github.com/glorycolor23-arch/line-paint-estimator を開く
2. `routes/details.js` を開いて編集ボタン(鉛筆アイコン)をクリック
3. ファイル内容を全て削除して、修正ファイルの内容をコピー&ペースト
4. **Commit changes** をクリック
5. Renderで自動デプロイが開始されることを確認

---

## デプロイ後の動作確認

### 1. 詳細見積もりフォームの送信確認
1. ✅ LINEから詳細見積もりフォームを開く
2. ✅ 全ての項目を入力
3. ✅ 送信ボタンをクリック
4. ✅ **「送信に失敗しました: lead not found」エラーが出ないことを確認**
5. ✅ 「詳細見積もりのご依頼ありがとうございます」のLINEメッセージが届くことを確認

### 2. 概算見積もり完了後の確認
1. ✅ 新しく概算見積もりを完了
2. ✅ LINE友だち追加
3. ✅ **「サーバーへ接続が出来ません」エラーが出ないことを確認**
4. ✅ LINEに概算見積もりのメッセージが届くことを確認

---

## 修正ファイル一覧

- `routes/details.js` - leadId必須チェックを削除、独立フォーム対応

---

## バージョン履歴

- **v13** (2025-11-08): leadId必須チェックを削除、独立フォーム対応
- **v12** (2025-11-08): 構文エラー修正、LINEメッセージ変更、leadId削除、サムネイル表示追加
- **v11** (2025-11-08): LINEメッセージ変更、サムネイル表示追加、leadIdエラー修正
- **v10** (2025-11-08): LINEメッセージ改善、建物写真参考画像追加、サムネイル拡大

