// window.LIFF_ID は /liff/env.js で定義される
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

(async function main(){
  try {
    if (!window.LIFF_ID) throw new Error('LIFF_ID not found');
    await liff.init({ liffId: window.LIFF_ID });

    // 必要に応じてログイン
    if (!liff.isLoggedIn()) liff.login();

    $('status').textContent = 'ログイン済み';
    show($('form'));

    // 送信前プレビュー
    $('previewBtn').onclick = () => {
      const name  = $('name').value.trim();
      const post  = $('postal').value.trim();
      const addr1 = $('addr1').value.trim();
      const addr2 = $('addr2').value.trim();

      if (!name || !post || !addr1) {
        alert('お名前・郵便番号・住所は必須です。');
        return;
      }
      $('previewBody').innerHTML = `
        <div class="card">
          <p><b>お名前：</b>${escapeHtml(name)}</p>
          <p><b>郵便番号：</b>${escapeHtml(post)}</p>
          <p><b>住所：</b>${escapeHtml(addr1)}</p>
          <p><b>建物名等：</b>${escapeHtml(addr2)}</p>
        </div>
      `;
      hide($('form'));
      show($('preview'));
    };

    // 戻る
    $('backBtn').onclick = () => {
      hide($('preview'));
      show($('form'));
    };

    // LIFF からトークへ送信
    $('confirmBtn').onclick = sendMessage;
    $('sendBtn').onclick = sendMessage;

  } catch (e) {
    console.error(e);
    $('status').textContent = '初期化に失敗しました。';
  }
})();

async function sendMessage(){
  const name  = $('name').value.trim();
  const post  = $('postal').value.trim();
  const addr1 = $('addr1').value.trim();
  const addr2 = $('addr2').value.trim();

  const msg = [
    { type:'text', text:'【詳細見積りの依頼】' },
    { type:'text', text:
      `お名前：${name}\n郵便番号：${post}\n住所：${addr1}\n建物名等：${addr2 || 'なし'}` }
  ];

  try {
    await liff.sendMessages(msg);
    await liff.closeWindow();
  } catch (e) {
    console.error(e);
    alert('送信に失敗しました。');
  }
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
