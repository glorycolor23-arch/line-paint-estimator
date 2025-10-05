// public/liff.js
(async function() {
  const params = new URLSearchParams(location.search);
  // 古いリンクでも動くように lead も受ける
  const leadId = params.get('leadId') || params.get('lead');
  const forcedStep = params.get('step');

  const ui = {
    root: document.querySelector('#liff-step'),
    render
  };

  let model = {
    profile: null,
    lineUserId: null,
    leadId,
    step: forcedStep ? parseInt(forcedStep, 10) : 0,
    form: { name: '', phone: '', postal: '' },
    files: {}
  };

  await liff.init({ liffId: (window.LIFF_CONFIG && window.LIFF_CONFIG.LIFF_ID) || '' });
  if (!liff.isLoggedIn()) { liff.login({}); return; }
  model.profile   = await liff.getProfile();
  model.lineUserId = model.profile.userId;

  // 先に userId を紐付け → 概算プッシュ（初回のみ）
  if (leadId) {
    try {
      await fetch('/api/link-line-user', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ leadId, lineUserId: model.lineUserId })
      });
    } catch(e) { /* noop */ }
  }

  render();

  function render() {
    if (model.step === 0) return renderIntro();
    if (model.step === 1) return renderContact();
    if (model.step === 2) return renderDrawings();
    if (model.step === 3) return renderPhotos();
    if (model.step === 4) return renderConfirm();
    return renderDone();
  }

  function renderIntro() {
    ui.root.innerHTML = `
      <p>詳細なお見積もりをご提示するため、以下の内容に回答をお願いします。<br>
      お客様情報は管理の為にのみ利用いたします。無断での営業訪問や現地調査での訪問は一切行いません。</p>
      <button class="btn primary" id="start" style="font-size:18px;padding:16px 20px;width:100%;">見積もりを開始する</button>
    `;
    document.querySelector('#start').onclick = () => { model.step = 1; render(); };
  }

  function renderContact() {
    ui.root.innerHTML = `
      <div class="badge">1/4</div>
      <h3>ご連絡先</h3>
      <label>お名前</label>
      <input id="name" placeholder="山田 太郎" autocomplete="name" style="font-size:16px;padding:14px"/>
      <label>電話番号</label>
      <input id="phone" inputmode="numeric" pattern="[0-9]*" placeholder="08012345678" style="font-size:16px;padding:14px"/>
      <label>郵便番号</label>
      <input id="postal" inputmode="numeric" pattern="[0-9]*" placeholder="5300001" style="font-size:16px;padding:14px"/>
      <button class="btn" id=
