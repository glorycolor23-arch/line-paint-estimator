(async function() {
  const params = new URLSearchParams(location.search);
  const leadId = params.get('leadId');
  const forcedStep = params.get('step');

  const ui = { root: document.querySelector('#liff-step'), render };
  let model = {
    profile: null, lineUserId: null, leadId,
    step: forcedStep ? parseInt(forcedStep, 10) : 0,
    form: { name:'', phone:'', postal:'' }, files: {}
  };

  await liff.init({ liffId: (window.LIFF_CONFIG && window.LIFF_CONFIG.LIFF_ID) || '' });
  if (!liff.isLoggedIn()) { liff.login({}); return; }
  model.profile = await liff.getProfile();
  model.lineUserId = model.profile.userId;

  if (leadId) {
    try {
      await fetch('/api/link-line-user', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ leadId, lineUserId: model.lineUserId })
      });
    } catch(e) {}
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
      <button class="btn primary wide large" id="start">見積もりを開始する</button>
    `;
    document.querySelector('#start').onclick = () => { model.step = 1; render(); };
  }

  function renderContact() {
    ui.root.innerHTML = `
      <div class="badge">1/4</div>
      <h3>ご連絡先</h3>
      <label>お名前</label>
      <input id="name" placeholder="山田 太郎" autocomplete="name" />
      <label>電話番号</label>
      <input id="phone" inputmode="numeric" pattern="[0-9]*" placeholder="08012345678" />
      <label>郵便番号</label>
      <input id="postal" inputmode="numeric" pattern="[0-9]*" placeholder="5300001" />
      <button class="btn wide" id="next">次へ</button>
    `;
    document.querySelector('#name').value = model.form.name;
    document.querySelector('#phone').value = model.form.phone;
    document.querySelector('#postal').value = model.form.postal;
    document.querySelector('#next').onclick = () => {
      model.form.name = document.querySelector('#name').value.trim();
      model.form.phone = document.querySelector('#phone').value.trim();
      model.form.postal = document.querySelector('#postal').value.trim();
      if (!model.form.name || !model.form.phone || !model.form.postal) return alert('未入力の項目があります。');
      model.step = 2; render();
    };
  }

  function fileInput(id, label, accept, capture=false) {
    return `
      <label>${label}</label>
      <input class="file" id="${id}" type="file" accept="${accept}" ${capture ? 'capture="environment"' : ''} />
    `;
  }

  function renderDrawings() {
    ui.root.innerHTML = `
      <div class="badge">2/4</div>
      <h3>お住まいの図面をアップロード</h3>
      <p class="note">スマホはカメラ撮影/ファイル選択、PCはファイル選択が利用できます（PDF/画像）。</p>
      ${fileInput('drawing_elevation','立面図','image/*,application/pdf')}
      ${fileInput('drawing_plan','平面図','image/*,application/pdf')}
      ${fileInput('drawing_section','断面図','image/*,application/pdf')}
      <button class="btn wide" id="next">次へ</button>
    `;
    document.querySelector('#next').onclick = () => { model.step = 3; render(); };
  }

  function renderPhotos() {
    ui.root.innerHTML = `
      <div class="badge">3/4</div>
      <h3>建物の写真をアップロード</h3>
      ${fileInput('photo_front','建物の正面','image/*', true)}
      ${fileInput('photo_right','建物の右側面','image/*', true)}
      ${fileInput('photo_left','建物の左側面','image/*', true)}
      ${fileInput('photo_back','建物の背面','image/*', true)}
      <button class="btn wide" id="next">確認へ</button>
    `;
    document.querySelector('#next').onclick = () => { model.step = 4; render(); };
  }

  function renderConfirm() {
    ui.root.innerHTML = `
      <div class="badge">4/4</div>
      <h3>入力内容のご確認</h3>
      <div class="summary">
        <div>お名前：<b>${model.form.name}</b></div>
        <div>電話番号：<b>${model.form.phone}</b></div>
        <div>郵便番号：<b>${model.form.postal}</b></div>
        <div>図面：立面/平面/断面</div>
        <div>写真：正面/右/左/背面</div>
      </div>
      <button class="btn primary wide" id="submit">この内容で見積もりを依頼</button>
    `;
    document.querySelector('#submit').onclick = submitAll;
  }

  async function submitAll() {
    const fd = new FormData();
    fd.append('leadId', model.leadId || '');
    fd.append('lineUserId', model.lineUserId || '');
    fd.append('name', model.form.name);
    fd.append('phone', model.form.phone);
    fd.append('postal', model.form.postal);

    const ids = ['drawing_elevation','drawing_plan','drawing_section','photo_front','photo_right','photo_left','photo_back'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.files && el.files[0]) fd.append(id, el.files[0], el.files[0].name);
    }

    try{
      const res = await fetch('/api/details', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      if (data.error) throw new Error('api error');
      model.step = 5; render();
    }catch(_e){
      alert('送信に失敗しました。 再度お試しください。');
    }
  }

  function renderDone() {
    ui.root.innerHTML = `
      <h3>送信完了しました</h3>
      <p>1〜3営業日以内にお見積もりをLINEにて回答いたします。ご利用ありがとうございました。</p>
    `;
  }
})();
