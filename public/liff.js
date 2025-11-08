// public/liff.js
(async function() {
  const params = new URLSearchParams(location.search);
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
    form: { name: '', phone: '', postal: '', address: '' },
    files: {},
    thumbnails: {}
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
      <div class="nav-vertical">
        <button class="btn primary" id="start">見積もりを開始する</button>
      </div>
    `;
    document.querySelector('#start').onclick = () => { model.step = 1; render(); };
  }

  function renderContact() {
    ui.root.innerHTML = `
      <div class="badge">1/4</div>
      <h3>ご連絡先</h3>
      <label>お名前<span class="required">*</span></label>
      <input id="name" placeholder="山田 太郎" autocomplete="name" class="input-field"/>
      
      <label>電話番号<span class="required">*</span></label>
      <input id="phone" type="tel" inputmode="numeric" pattern="[0-9-]*" placeholder="090-1234-5678" autocomplete="tel" class="input-field"/>
      
      <label>郵便番号<span class="required">*</span></label>
      <input id="postal" inputmode="numeric" pattern="[0-9]*" placeholder="5300001" autocomplete="postal-code" class="input-field"/>
      <p class="note" style="font-size:12px;margin-top:4px;">郵便番号7桁を入力すると住所が自動入力されます</p>
      
      <label>住所<span class="required">*</span></label>
      <input id="address" placeholder="大阪府大阪市北区梅田1-1-1" autocomplete="address-level1" class="input-field"/>
      <p class="note address-note">こちらの住所は建物の区画を確認するためにのみ利用します。ご連絡なしでの現地調査訪問は一切行っておりませんのでご安心ください。</p>
      
      <div class="nav-vertical">
        <button class="btn primary" id="next">次へ</button>
      </div>
    `;
    
    document.querySelector('#name').value = model.form.name;
    document.querySelector('#phone').value = model.form.phone;
    document.querySelector('#postal').value = model.form.postal;
    document.querySelector('#address').value = model.form.address;
    
    // 郵便番号から住所自動入力
    const postalInput = document.querySelector('#postal');
    const addressInput = document.querySelector('#address');
    
    postalInput.addEventListener('input', async (e) => {
      const postal = e.target.value.replace(/[^0-9]/g, '');
      if (postal.length === 7) {
        try {
          const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${postal}`);
          const data = await res.json();
          if (data.status === 200 && data.results && data.results[0]) {
            const result = data.results[0];
            const address = result.address1 + result.address2 + result.address3;
            addressInput.value = address;
            model.form.address = address;
          }
        } catch (err) {
          console.error('郵便番号検索エラー:', err);
        }
      }
    });
    
    document.querySelector('#next').onclick = () => {
      model.form.name = document.querySelector('#name').value.trim();
      model.form.phone = document.querySelector('#phone').value.trim();
      model.form.postal = document.querySelector('#postal').value.trim();
      model.form.address = document.querySelector('#address').value.trim();
      
      if (!model.form.name || !model.form.phone || !model.form.postal || !model.form.address) {
        return alert('未入力の項目があります。');
      }
      model.step = 2; render();
    };
  }

  function fileInput(id, label, accept, required = false) {
    const req = required ? '<span class="required">*</span>' : '';
    const thumbId = `thumb_${id}`;
    const existingThumb = model.thumbnails[id];
    
    return `
      <div class="file-input-group">
        <label>${label}${req}</label>
        <input class="file-input" id="${id}" type="file" accept="${accept}"/>
        <div id="${thumbId}" class="thumbnail-preview">${existingThumb || ''}</div>
      </div>
    `;
  }

  function attachFileListeners(ids) {
    ids.forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;
      
      input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        model.files[id] = file;
        
        // サムネイル表示
        const thumbContainer = document.getElementById(`thumb_${id}`);
        if (thumbContainer && file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const img = `<img src="${ev.target.result}" alt="プレビュー" class="thumbnail-img"/>`;
            thumbContainer.innerHTML = img;
            model.thumbnails[id] = img;
          };
          reader.readAsDataURL(file);
        } else if (thumbContainer) {
          thumbContainer.innerHTML = `<p class="file-name">📄 ${file.name}</p>`;
          model.thumbnails[id] = `<p class="file-name">📄 ${file.name}</p>`;
        }
      });
    });
  }

  function renderDrawings() {
    ui.root.innerHTML = `
      <div class="badge">2/4</div>
      <h3>お住まいの図面をアップロード</h3>
      <p class="note">立面図・平面図・断面図をアップロードしてください（PDF/画像）。</p>
      
      <div class="reference-images">
        <div class="reference-item">
          <p class="note"><strong>立面図の例：</strong></p>
          <img src="/public/img/elevation_sample.png" alt="立面図の参考例" class="sample-img-small"/>
        </div>
        <div class="reference-item">
          <p class="note"><strong>平面図の例：</strong></p>
          <img src="/public/img/plan_sample.gif" alt="平面図の参考例" class="sample-img-small"/>
        </div>
        <div class="reference-item">
          <p class="note"><strong>断面図の例：</strong></p>
          <img src="/public/img/section_sample.gif" alt="断面図の参考例" class="sample-img-small"/>
        </div>
      </div>
      
      ${fileInput('drawing_elevation','立面図','image/*,application/pdf', true)}
      ${fileInput('drawing_plan','平面図','image/*,application/pdf')}
      ${fileInput('drawing_section','断面図','image/*,application/pdf')}
      
      <div class="nav-vertical">
        <button class="btn primary" id="next">次へ</button>
        <a href="#" id="back" class="back-link">← 戻る</a>
      </div>
    `;
    
    attachFileListeners(['drawing_elevation', 'drawing_plan', 'drawing_section']);
    
    document.querySelector('#next').onclick = () => {
      if (!model.files['drawing_elevation']) {
        return alert('立面図は必須です。');
      }
      model.step = 3; render();
    };
    
    document.querySelector('#back').onclick = (e) => {
      e.preventDefault();
      model.step = 1; render();
    };
  }

  function renderPhotos() {
    ui.root.innerHTML = `
      <div class="badge">3/4</div>
      <h3>建物の写真をアップロード</h3>
      <p class="note">建物の正面・右側面・左側面・背面の写真をアップロードしてください。</p>
      
      <div class="reference-image">
        <p class="note"><strong>建物写真の例：</strong></p>
        <img src="/public/img/building_sample.jpg" alt="建物写真の参考例" class="sample-img-small"/>
      </div>
      
      ${fileInput('photo_front','建物の正面','image/*', true)}
      ${fileInput('photo_right','建物の右側面','image/*')}
      ${fileInput('photo_left','建物の左側面','image/*')}
      ${fileInput('photo_back','建物の背面','image/*')}
      
      <div class="nav-vertical">
        <button class="btn primary" id="next">確認へ</button>
        <a href="#" id="back" class="back-link">← 戻る</a>
      </div>
    `;
    
    attachFileListeners(['photo_front', 'photo_right', 'photo_left', 'photo_back']);
    
    document.querySelector('#next').onclick = () => {
      if (!model.files['photo_front']) {
        return alert('建物の正面写真は必須です。');
      }
      model.step = 4; render();
    };
    
    document.querySelector('#back').onclick = (e) => {
      e.preventDefault();
      model.step = 2; render();
    };
  }

  function renderConfirm() {
    const fileList = Object.keys(model.files).map(id => {
      const labels = {
        'drawing_elevation': '立面図',
        'drawing_plan': '平面図',
        'drawing_section': '断面図',
        'photo_front': '建物正面',
        'photo_right': '建物右側面',
        'photo_left': '建物左側面',
        'photo_back': '建物背面'
      };
      return labels[id] || id;
    }).join('、');
    
    ui.root.innerHTML = `
      <div class="badge">4/4</div>
      <h3>入力内容のご確認</h3>
      <div class="summary">
        <div><strong>お名前</strong><br>${model.form.name}</div>
        <div><strong>電話番号</strong><br>${model.form.phone}</div>
        <div><strong>郵便番号</strong><br>${model.form.postal}</div>
        <div><strong>住所</strong><br>${model.form.address}</div>
        <div><strong>アップロードファイル</strong><br>${fileList}</div>
      </div>
      
      <div class="nav-vertical">
        <button class="btn primary" id="submit">この内容で見積もりを依頼</button>
        <a href="#" id="back" class="back-link">← 戻る</a>
      </div>
    `;
    
    document.querySelector('#submit').onclick = submitAll;
    document.querySelector('#back').onclick = (e) => {
      e.preventDefault();
      model.step = 3; render();
    };
  }

  async function submitAll() {
    // ローディング画面を表示
    showLoading();
    
    const fd = new FormData();
    fd.append('leadId', model.leadId || '');
    fd.append('lineUserId', model.lineUserId || '');
    fd.append('name', model.form.name);
    fd.append('phone', model.form.phone);
    fd.append('postal', model.form.postal);
    fd.append('address', model.form.address);

    // ファイルを追加
    Object.keys(model.files).forEach(id => {
      const file = model.files[id];
      if (file) fd.append(id, file, file.name);
    });

    try {
      const res = await fetch('/api/details', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      
      hideLoading();
      
      if (data && data.error) {
        return alert('送信に失敗しました。再度お試しください。');
      }
      
      model.step = 5; render();
    } catch (err) {
      hideLoading();
      console.error('送信エラー:', err);
      alert('送信に失敗しました。通信状態をご確認ください。');
    }
  }

  function showLoading() {
    const loadingHTML = `
      <div class="loading-overlay">
        <div class="loading-content">
          <div class="loading-dots">
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
          </div>
          <p>送信中...</p>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', loadingHTML);
  }

  function hideLoading() {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) overlay.remove();
  }

  function renderDone() {
    ui.root.innerHTML = `
      <h3>送信完了しました</h3>
      <p>1〜3営業日以内にお見積もりをLINEにて回答いたします。ご利用ありがとうございました。</p>
    `;
  }
})();

