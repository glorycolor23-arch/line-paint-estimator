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
    form: { name: '', phone: '', postal: '' },
    files: {},
    fileUrls: {}, // サムネイル用URL
    // 概算見積もりで選択された内容を保持
    initialAnswers: null,
    // 追加質問の回答
    paintType: '',
    roofWorkType: ''
  };

  await liff.init({ liffId: (window.LIFF_CONFIG && window.LIFF_CONFIG.LIFF_ID) || '' });
  if (!liff.isLoggedIn()) { liff.login({}); return; }
  model.profile   = await liff.getProfile();
  model.lineUserId = model.profile.userId;

  // leadIdから概算見積もりの回答を取得
  if (leadId) {
    console.log('[LIFF] leadId:', leadId);
    try {
      const leadRes = await fetch(`/api/lead/${leadId}`);
      console.log('[LIFF] leadRes status:', leadRes.status);
      if (leadRes.ok) {
        const leadData = await leadRes.json();
        console.log('[LIFF] leadData:', leadData);
        model.initialAnswers = leadData.answers || {};
        console.log('[LIFF] initialAnswers:', model.initialAnswers);
      } else {
        console.error('[LIFF] Failed to fetch lead data:', leadRes.status);
      }
    } catch(e) {
      console.error('[LIFF] Error fetching lead:', e);
    }

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
    // 追加質問ステップ
    if (model.step === 4) return renderAdditionalQuestions();
    if (model.step === 5) return renderConfirm();
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
      <div class="badge">1/5</div>
      <h3>ご連絡先の入力</h3>
      <label>お名前</label>
      <input id="name" placeholder="山田 太郎" autocomplete="name" style="font-size:16px;padding:14px"/>
      <label>電話番号</label>
      <input id="phone" inputmode="numeric" pattern="[0-9]*" placeholder="08012345678" style="font-size:16px;padding:14px"/>
      <label>郵便番号</label>
      <input id="postal" inputmode="numeric" pattern="[0-9]*" placeholder="5300001" style="font-size:16px;padding:14px"/>
      <button class="btn" id="next" style="font-size:16px;padding:14px 18px;">次へ</button>
    `;
    document.querySelector('#name').value   = model.form.name;
    document.querySelector('#phone').value  = model.form.phone;
    document.querySelector('#postal').value = model.form.postal;
    document.querySelector('#next').onclick = () => {
      model.form.name   = document.querySelector('#name').value.trim();
      model.form.phone  = document.querySelector('#phone').value.trim();
      model.form.postal = document.querySelector('#postal').value.trim();
      if (!model.form.name || !model.form.phone || !model.form.postal) return alert('未入力の項目があります。');
      model.step = 2; render();
    };
  }

  function fileInput(id, label, accept, capture=false) {
    return `
      <label>${label}</label>
      <input class="file" id="${id}" type="file" accept="${accept}" ${capture ? 'capture="environment"' : ''} style="font-size:16px;padding:12px"/>
    `;
  }

  function renderDrawings() {
    ui.root.innerHTML = `
      <div class="badge">2/5</div>
      <h3>お住まいの図面をアップロード</h3>
      <p class="note">以下は参考例です。工事希望の物件の図面を撮影または保存済みの画像をアップロードしてください。</p>
      
      <div style="margin-bottom:20px;">
        <label>立面図</label>
        <div style="margin-bottom:8px;"><img src="/examples/elevation-drawing.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="立面図の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="drawing_elevation" type="file" accept="image/*,application/pdf" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="margin-bottom:20px;">
        <label>平面図</label>
        <div style="margin-bottom:8px;"><img src="/examples/floor-plan.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="平面図の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="drawing_plan" type="file" accept="image/*,application/pdf" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="margin-bottom:20px;">
        <label>断面図</label>
        <div style="margin-bottom:8px;"><img src="/examples/section-drawing.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="断面図の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="drawing_section" type="file" accept="image/*,application/pdf" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-ghost" id="back" style="font-size:16px;padding:14px 18px;flex:1;">戻る</button>
        <button class="btn" id="next" style="font-size:16px;padding:14px 18px;flex:2;">次へ</button>
      </div>
    `;
    document.querySelector('#back').onclick = () => { model.step = 1; render(); };
    document.querySelector('#next').onclick = () => {
      // ファイルをmodelに保存
      saveFiles(['drawing_elevation', 'drawing_plan', 'drawing_section']);
      model.step = 3; render();
    };
  }

  function renderPhotos() {
    ui.root.innerHTML = `
      <div class="badge">3/5</div>
      <h3>建物の写真をアップロード</h3>
      <p class="note">以下は参考例です。工事希望の物件の写真を撮影または保存済みの画像をアップロードしてください。</p>
      
      <div style="margin-bottom:20px;">
        <label>建物の正面</label>
        <div style="margin-bottom:8px;"><img src="/examples/house-front.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="建物正面の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="photo_front" type="file" accept="image/*" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="margin-bottom:20px;">
        <label>建物の右側面</label>
        <div style="margin-bottom:8px;"><img src="/examples/house-side.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="建物側面の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="photo_right" type="file" accept="image/*" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="margin-bottom:20px;">
        <label>建物の左側面</label>
        <div style="margin-bottom:8px;"><img src="/examples/house-side.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="建物側面の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="photo_left" type="file" accept="image/*" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="margin-bottom:20px;">
        <label>建物の背面</label>
        <div style="margin-bottom:8px;"><img src="/examples/house-side.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="建物背面の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="photo_back" type="file" accept="image/*" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-ghost" id="back" style="font-size:16px;padding:14px 18px;flex:1;">戻る</button>
        <button class="btn" id="next" style="font-size:16px;padding:14px 18px;flex:2;">次へ</button>
      </div>
    `;
    document.querySelector('#back').onclick = () => { model.step = 2; render(); };
    document.querySelector('#next').onclick = () => {
      // ファイルをmodelに保存
      saveFiles(['photo_front', 'photo_right', 'photo_left', 'photo_back']);
      model.step = 4; render();
    };
  }

  function renderAdditionalQuestions() {
    const desiredWork = model.initialAnswers?.desiredWork || '';
    console.log('[LIFF] renderAdditionalQuestions - desiredWork:', desiredWork);
    const needsPaint = desiredWork.includes('外壁塗装');
    const needsRoof = desiredWork.includes('屋根工事');
    console.log('[LIFF] needsPaint:', needsPaint, 'needsRoof:', needsRoof);

    let html = `<div class="badge">4/5</div><h3>工事内容の詳細</h3>`;
    html += `<p style="margin-bottom:20px;color:#666;">概算見積もりで選択した工事内容について、より詳しくお聞かせください。</p>`;

    if (needsPaint) {
      html += `
        <div style="margin-bottom:30px;">
          <label style="font-weight:bold;font-size:16px;">希望の塗料を教えてください</label>
          <div class="vlist" style="margin-top:10px;">
            ${paintOption('acrylic', 'コスト重視(アクリル系またはウレタン系塗料)', 'コストをできるだけ抑えたい方向け。光沢感があり、仕上がりはきれいですが耐久性はやや短め。<br>耐久年数:7〜10年程度', '/examples/paint-acrylic.png')}
            ${paintOption('silicon', 'バランス重視(シリコン系塗料)', '価格と耐久性のバランスが良く、最も人気の高い塗料。汚れにくく、ツヤも長持ちします。<br>耐用年数:10〜13年程度', '/examples/paint-silicon.png')}
            ${paintOption('fluorine', '高耐久＋機能付き(フッ素系/無機系/ラジカル制御塗料)', '色あせ防止・汚れにくさ・熱や紫外線に強いなど、高性能タイプ。塗り替え回数を減らしたい方向け。<br>耐用年数:15〜20年程度', '/examples/paint-fluorine.png')}
            ${paintOption('thermal', '機能重視(遮熱・断熱塗料)', '太陽光の熱を反射・遮断し、室内温度の上昇を抑える塗料。省エネ効果や快適性を重視する方におすすめ。<br>耐用年数:12〜17年程度(使用樹脂により異なる)', '/examples/paint-thermal.png')}
          </div>
        </div>
      `;
    }

    if (needsRoof) {
      html += `
        <div style="margin-bottom:30px;">
          <label style="font-weight:bold;font-size:16px;">希望の工事内容を教えてください</label>
          <div class="vlist" style="margin-top:10px;">
            ${roofOption('painting', '屋根塗装', '既存の屋根を塗り直して、美観を回復し、防水性や耐久性を高める工事です。<br>特徴:費用を抑えやすく、築10年前後の家に最適。<br>目安耐用年数:8〜12年', '/examples/roof-painting.png')}
            ${roofOption('cover', 'カバー工法(重ね葺き)', '古い屋根の上に新しい屋根材を重ねて施工します。撤去費用がかからず、断熱・防音性も向上。<br>特徴:工期が短く、費用と耐久性のバランスが良い。<br>目安耐用年数:20〜30年', '/examples/roof-cover.png')}
            ${roofOption('replacement', '葺き替え(全面交換)', '既存の屋根材をすべて撤去し、新しい屋根に張り替える工事です。<br>特徴:劣化が進んだ屋根や雨漏りがある場合に最適。下地から完全にリフレッシュ可能。<br>目安耐用年数:30〜40年', '/examples/roof-replacement.png')}
            ${roofOption('repair', '部分修理・補修', '雨漏り・割れ・サビなど、特定箇所のみを修理する工事です。<br>特徴:予算を抑えつつ、緊急対応や応急処置に適しています。<br>目安耐用年数:状態による(短期〜中期)', '/examples/roof-repair.png')}
            ${roofOption('insulation', '断熱・遮熱リフォーム', '屋根塗装やカバー工法と組み合わせて、遮熱塗料や断熱材を追加。<br>特徴:夏の暑さ・冬の寒さを軽減し、光熱費削減にもつながります。<br>目安耐用年数:施工方法により異なる(10〜20年)', '/examples/roof-insulation.png')}
          </div>
        </div>
      `;
    }

    // どちらも選択されていない場合でも、確認画面へ進むボタンを表示
    if (!needsPaint && !needsRoof) {
      html += `<p style="color:#999;font-size:14px;">※概算見積もりで選択した内容が取得できませんでした。確認画面に進んでください。</p>`;
    }

    html += `
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-ghost" id="back" style="font-size:16px;padding:14px 18px;flex:1;">戻る</button>
        <button class="btn" id="next" style="font-size:16px;padding:14px 18px;flex:2;">確認へ</button>
      </div>
    `;

    ui.root.innerHTML = html;

    // イベントリスナー設定
    if (needsPaint) {
      document.querySelectorAll('[data-paint-type]').forEach(btn => {
        btn.onclick = () => {
          document.querySelectorAll('[data-paint-type]').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          model.paintType = btn.dataset.paintType;
        };
        if (model.paintType === btn.dataset.paintType) {
          btn.classList.add('selected');
        }
      });
    }

    if (needsRoof) {
      document.querySelectorAll('[data-roof-type]').forEach(btn => {
        btn.onclick = () => {
          document.querySelectorAll('[data-roof-type]').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          model.roofWorkType = btn.dataset.roofType;
        };
        if (model.roofWorkType === btn.dataset.roofType) {
          btn.classList.add('selected');
        }
      });
    }

    document.querySelector('#back').onclick = () => { model.step = 3; render(); };
    document.querySelector('#next').onclick = () => {
      if (needsPaint && !model.paintType) return alert('塗料を選択してください。');
      if (needsRoof && !model.roofWorkType) return alert('工事内容を選択してください。');
      model.step = 5; render();
    };
  }

  function paintOption(value, title, desc, img) {
    return `
      <button type="button" class="option-card" data-paint-type="${value}" style="display:block;width:100%;text-align:left;padding:12px;margin-bottom:12px;border:2px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;">
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="${img}" style="width:80px;height:60px;object-fit:cover;border-radius:4px;" alt="${title}">
          <div style="flex:1;">
            <div style="font-weight:bold;font-size:15px;margin-bottom:4px;">${title}</div>
            <div style="font-size:13px;color:#666;line-height:1.4;">${desc}</div>
          </div>
        </div>
      </button>
    `;
  }

  function roofOption(value, title, desc, img) {
    return `
      <button type="button" class="option-card" data-roof-type="${value}" style="display:block;width:100%;text-align:left;padding:12px;margin-bottom:12px;border:2px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;">
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="${img}" style="width:80px;height:60px;object-fit:cover;border-radius:4px;" alt="${title}">
          <div style="flex:1;">
            <div style="font-weight:bold;font-size:15px;margin-bottom:4px;">${title}</div>
            <div style="font-size:13px;color:#666;line-height:1.4;">${desc}</div>
          </div>
        </div>
      </button>
    `;
  }

  function renderConfirm() {
    // アップロードされたファイルのサムネイル生成
    const drawingThumbs = generateThumbnails(['drawing_elevation', 'drawing_plan', 'drawing_section']);
    const photoThumbs = generateThumbnails(['photo_front', 'photo_right', 'photo_left', 'photo_back']);

    const desiredWork = model.initialAnswers?.desiredWork || '';
    const needsPaint = desiredWork.includes('外壁塗装');
    const needsRoof = desiredWork.includes('屋根工事');

    let additionalInfo = '';
    if (needsPaint && model.paintType) {
      const paintLabels = {
        acrylic: 'コスト重視(アクリル系/ウレタン系)',
        silicon: 'バランス重視(シリコン系)',
        fluorine: '高耐久＋機能付き(フッ素系/無機系/ラジカル制御)',
        thermal: '機能重視(遮熱・断熱)'
      };
      additionalInfo += `<div>希望の塗料:<b>${paintLabels[model.paintType] || model.paintType}</b></div>`;
    }
    if (needsRoof && model.roofWorkType) {
      const roofLabels = {
        painting: '屋根塗装',
        cover: 'カバー工法(重ね葺き)',
        replacement: '葺き替え(全面交換)',
        repair: '部分修理・補修',
        insulation: '断熱・遮熱リフォーム'
      };
      additionalInfo += `<div>希望の工事内容:<b>${roofLabels[model.roofWorkType] || model.roofWorkType}</b></div>`;
    }

    ui.root.innerHTML = `
      <div class="badge">5/5</div>
      <h3>入力内容のご確認</h3>
      <div class="summary">
        <div>お名前:<b>${model.form.name}</b></div>
        <div>電話番号:<b>${model.form.phone}</b></div>
        <div>郵便番号:<b>${model.form.postal}</b></div>
        ${additionalInfo}
        <div style="margin-top:12px;">図面:</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">${drawingThumbs}</div>
        <div>写真:</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${photoThumbs}</div>
      </div>
      <button class="btn primary" id="submit" style="font-size:16px;padding:16px 20px;">この内容で見積もりを依頼</button>
    `;
    document.querySelector('#submit').onclick = submitAll;
  }

  function saveFiles(ids) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.files && el.files[0]) {
        const file = el.files[0];
        model.files[id] = file;
        model.fileUrls[id] = URL.createObjectURL(file);
      }
    }
  }

  function generateThumbnails(ids) {
    let html = '';
    for (const id of ids) {
      if (model.fileUrls[id]) {
        html += `<img src="${model.fileUrls[id]}" style="width:80px;height:80px;object-fit:cover;border:1px solid #ddd;border-radius:4px;" alt="${id}">`;
      }
    }
    return html || '<span style="color:#999;">なし</span>';
  }

  async function submitAll() {
    const fd = new FormData();
    fd.append('leadId', model.leadId || '');
    fd.append('lineUserId', model.lineUserId || '');
    fd.append('name', model.form.name);
    fd.append('phone', model.form.phone);
    fd.append('postal', model.form.postal);
    fd.append('paintType', model.paintType || '');
    fd.append('roofWorkType', model.roofWorkType || '');

    const ids = ['drawing_elevation','drawing_plan','drawing_section','photo_front','photo_right','photo_left','photo_back'];
    for (const id of ids) {
      if (model.files[id]) {
        fd.append(id, model.files[id], model.files[id].name);
      }
    }

    try {
      const res  = await fetch('/api/details', { method: 'POST', body: fd });
      console.log('[LIFF] submit response status:', res.status);
      const data = await res.json().catch((e) => {
        console.error('[LIFF] Failed to parse response:', e);
        return {};
      });
      console.log('[LIFF] submit response data:', data);
      if (data && data.error) {
        console.error('[LIFF] Submit error:', data.error);
        return alert('送信に失敗しました: ' + data.error);
      }
      model.step = 6; render();
    } catch (e) {
      console.error('[LIFF] Submit exception:', e);
      alert('送信に失敗しました。通信状態をご確認ください。');
    }
  }

  function renderDone() {
    ui.root.innerHTML = `
      <h3>送信完了しました</h3>
      <p>1〜3営業日以内にお見積もりをLINEにて回答いたします。ご利用ありがとうございました。</p>
    `;
  }
})();

