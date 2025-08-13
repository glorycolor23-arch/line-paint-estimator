/* liff/app.js — 連絡先フォーム（数値KB・郵便→住所自動・戻る/プレビュー/送信） */

(async function () {
  const $ = (sel) => document.querySelector(sel);
  const show = (id) => { document.querySelectorAll('.step').forEach(n => n.classList.add('hidden')); $(id).classList.remove('hidden'); };
  const bar = (pct) => { $('#bar').style.width = pct + '%'; };

  // 状態
  const state = { userId: '', name: '', postal: '', addr1: '', addr2: '' };

  // LIFF 初期化
  await liff.init({ liffId: window.__ENV?.LIFF_ID });
  if (!liff.isLoggedIn()) await liff.login();
  const decoded = liff.getDecodedIDToken();
  state.userId = decoded?.sub || '';

  // 進捗
  let step = 1; bar(20); show('#step-name');

  // イベント
  $('#next1').onclick = () => {
    state.name = $('#name').value.trim();
    if (!state.name) return alert('お名前を入力してください');
    step = 2; bar(40); show('#step-postal');
    $('#postal').focus();
  };

  $('#back2').onclick = () => { step = 1; bar(20); show('#step-name'); };
  $('#next2').onclick = async () => {
    const z = $('#postal').value.replace(/[^\d]/g, '');
    if (!/^\d{7}$/.test(z)) return alert('郵便番号は7桁で入力してください');
    state.postal = z;
    // 郵便→住所
    try {
      const r = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${z}`);
      const j = await r.json();
      const a = j?.results?.[0];
      const addr = a ? `${a.address1}${a.address2}${a.address3}` : '';
      $('#addr1').value = addr;
      state.addr1 = addr;
    } catch (e) { /* noop */ }
    step = 3; bar(60); show('#step-addr1');
    $('#addr1').focus();
  };

  $('#back3').onclick = () => { step = 2; bar(40); show('#step-postal'); };
  $('#next3').onclick = () => {
    state.addr1 = $('#addr1').value.trim();
    if (!state.addr1) return alert('住所（都道府県・市区町村・番地など）を入力してください');
    step = 4; bar(80); show('#step-addr2');
    $('#addr2').focus();
  };

  $('#back4').onclick = () => { step = 3; bar(60); show('#step-addr1'); };

  const openPreview = () => {
    state.addr2 = ($('#addr2').value.trim() || '');
    $('#pv-name').textContent = state.name;
    $('#pv-postal').textContent = state.postal;
    $('#pv-addr1').textContent = state.addr1;
    $('#pv-addr2').textContent = state.addr2 || '（なし）';
    bar(90);
    show('#preview-pane');
  };

  $('#preview').onclick = openPreview;

  async function submitNow() {
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.message || '送信に失敗しました');
      bar(100); show('#done');
      try { await liff.sendMessages([{ type: 'text', text: '連絡先を送信しました。担当者から折り返します。' }]); } catch (e) {}
      setTimeout(() => { try { liff.closeWindow(); } catch (e) {} }, 1200);
    } catch (e) {
      alert('送信に失敗しました。通信環境をご確認のうえ再度お試しください。');
    }
  }

  $('#submit').onclick = openPreview;
  $('#backPrev').onclick = () => { show('#step-addr2'); bar(80); };
  $('#submit2').onclick = submitNow;
  $('#close').onclick = () => { try { liff.closeWindow(); } catch (e) { window.history.back(); } };
})();
