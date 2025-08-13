// liff/app.js
(async () => {
  const qs = new URLSearchParams(location.search);
  const uid = qs.get('uid') || '';

  // LIFF 初期化
  const LIFF_ID = window.__LIFF_ENV__?.LIFF_ID || '';
  await liff.init({ liffId: LIFF_ID });

  // 要素
  const el = id => document.getElementById(id);
  const steps = ['step1', 'step2', 'step3', 'step4', 'step5', 'confirm'];
  const show = id => steps.forEach(s => el(s).hidden = (s !== id));

  // 入力
  const name = el('name');
  const tel = el('tel');
  const zip = el('zip');
  const address = el('address');
  const address2 = el('address2');

  // 次へ・戻る
  el('next1').onclick = () => name.value.trim() ? show('step2') : alert('お名前を入力してください');
  el('prev2').onclick = () => show('step1');
  el('next2').onclick = () => tel.value.trim() ? show('step3') : alert('電話番号を入力してください');
  el('prev3').onclick = () => show('step2');
  el('next3').onclick = async () => {
    const z = zip.value.replace(/[^0-9]/g, '');
    if (z.length < 7) return alert('郵便番号（7桁）を入力してください');
    // 住所自動補完
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${z}`);
      const json = await res.json();
      const r = json?.results?.[0];
      if (r) address.value = `${r.address1}${r.address2}${r.address3}`;
    } catch {}
    show('step4');
  };
  el('prev4').onclick = () => show('step3');
  el('next4').onclick = () => address.value.trim() ? show('step5') : alert('住所を入力してください');
  el('prev5').onclick = () => show('step4');

  // 確認
  el('preview').onclick = () => {
    const html = `
      <div><b>お名前：</b>${escapeHtml(name.value)}</div>
      <div><b>電話番号：</b>${escapeHtml(tel.value)}</div>
      <div><b>郵便番号：</b>${escapeHtml(zip.value)}</div>
      <div><b>住所：</b>${escapeHtml(address.value)}</div>
      <div><b>以降の住所：</b>${escapeHtml(address2.value || '（なし）')}</div>
    `;
    el('summary').innerHTML = html;
    show('confirm');
  };
  el('backEdit').onclick = () => show('step5');

  // 送信
  el('submitBtn').onclick = async () => {
    el('thanks').hidden = false;
    try {
      const body = {
        uid,
        name: name.value.trim(),
        tel: tel.value.trim(),
        zip: zip.value.trim(),
        address: address.value.trim(),
        address2: address2.value.trim()
      };
      const res = await fetch('/liff/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!json.ok) throw new Error('送信に失敗しました');
      await liff.sendMessages([{ type: 'text', text: '見積り依頼を送信しました。ありがとうございました。' }]).catch(() => {});
      await liff.closeWindow();
    } catch (e) {
      alert('送信に失敗しました。時間をおいて再度お試しください。');
      el('thanks').hidden = true;
    }
  };

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
})();
