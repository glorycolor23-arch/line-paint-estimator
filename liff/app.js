(async () => {
  // 住所自動補完
  const zipEl = document.getElementById('zip');
  const addr1El = document.getElementById('addr1');
  zipEl.addEventListener('change', async () => {
    const z = zipEl.value.replace(/\D/g, '');
    if (z.length !== 7) return;
    try {
      const r = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${z}`);
      const j = await r.json();
      if (j?.results?.length) {
        const a = j.results[0];
        addr1El.value = `${a.address1}${a.address2}${a.address3}`;
      }
    } catch {}
  });

  // LIFF 初期化
  await liff.init({ liffId: window.ENV?.LIFF_ID || '' });
  document.getElementById('addFriend').href = window.ENV?.FRIEND_ADD_URL || '#';

  const form = document.getElementById('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value.trim();
    const tel  = document.getElementById('tel').value.trim();
    const zip  = zipEl.value.trim();
    const a1   = addr1El.value.trim();
    const a2   = document.getElementById('addr2').value.trim();

    // LINEのuserId
    const profile = await liff.getProfile().catch(()=>null);
    const uid = profile?.userId || 'unknown';

    // Apps Script にメール送信を依頼（本文のみ）
    const webapp = (window.ENV?.EMAIL_WEBAPP_URL) || ''; // 今回は server.js では配布せず、別途環境に合わせて直接書く場合はここに
    const to = ''; // Apps Script 側で固定宛先があるので空でも可（payload内に to を入れてもよい）

    const html = `
      <h2>LINE詳細見積りの依頼</h2>
      <p><b>LINE USER ID:</b> ${uid}</p>
      <p><b>お名前:</b> ${name}</p>
      <p><b>電話番号:</b> ${tel}</p>
      <p><b>郵便番号:</b> ${zip}</p>
      <p><b>住所1:</b> ${a1}</p>
      <p><b>住所2:</b> ${a2}</p>
    `;

    try {
      await fetch(window.ENV?.EMAIL_WEBAPP_URL || '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject: 'LINE詳細見積りの依頼', htmlBody: html, photoUrls: [] })
      });
      alert('送信しました。1〜3営業日以内にLINEでお見積書をお送りします。');
      if (liff.isInClient()) liff.closeWindow();
    } catch (e2) {
      alert('送信に失敗しました。時間をおいてお試しください。');
      console.error(e2);
    }
  });
})();
