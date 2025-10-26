// public/liff.js - 詳細見積もりフォーム (完全版)
(async () => {
  const params = new URLSearchParams(location.search);
  const leadId = params.get('leadId');
  const forcedStep = params.get('step');

  const ui = {
    root: document.querySelector('#liff-step'),
    render
  };

  let model = {
    profile: null,
    lineUserId: null,
    displayName: '',
    leadId,
    step: forcedStep ? parseInt(forcedStep, 10) : 0,
    form: {
      name: '',
      phone: '',
      postal: '',
      address: '',
      addressDetail: ''
    },
    files: {},
    fileUrls: {},
    initialAnswers: {},
    needsPaint: undefined,
    needsRoof: undefined,
    paintType: '',
    roofWorkType: '',
    buildingAge: '',
    buildingFloors: '',
    wallMaterial: ''
  };

  await liff.init({ liffId: (window.LIFF_CONFIG && window.LIFF_CONFIG.LIFF_ID) || '' });
  if (!liff.isLoggedIn()) { liff.login({}); return; }
  model.profile = await liff.getProfile();
  model.lineUserId = model.profile.userId;
  model.displayName = model.profile.displayName || '';

  console.log('[LIFF] leadId:', leadId);
  console.log('[LIFF] lineUserId:', model.lineUserId);
  console.log('[LIFF] displayName:', model.displayName);

  // leadIdから概算見積もりの回答を取得
  if (leadId) {
    try {
      const leadRes = await fetch(`/api/lead/${leadId}`);
      if (leadRes.ok) {
        const leadData = await leadRes.json();
        model.initialAnswers = leadData.answers || {};
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
    if (model.step === 4) return renderWorkDetails();
    if (model.step === 5) return renderBuildingAge();
    if (model.step === 6) return renderBuildingFloors();
    if (model.step === 7) return renderWallMaterial();
    if (model.step === 8) return renderConfirm();
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
      <div class="badge">1/9</div>
      <h3>お客様情報</h3>
      <label style="display:block;margin-bottom:15px;">
        <div style="font-weight:bold;margin-bottom:5px;">お名前</div>
        <input class="input" id="name" type="text" value="${model.form.name}" placeholder="山田太郎" style="font-size:16px;padding:12px;width:100%;"/>
      </label>
      <label style="display:block;margin-bottom:15px;">
        <div style="font-weight:bold;margin-bottom:5px;">電話番号</div>
        <input class="input" id="phone" type="tel" value="${model.form.phone}" placeholder="090-1234-5678" style="font-size:16px;padding:12px;width:100%;"/>
      </label>
      <label style="display:block;margin-bottom:15px;">
        <div style="font-weight:bold;margin-bottom:5px;">郵便番号</div>
        <input class="input" id="postal" type="tel" inputmode="numeric" pattern="[0-9-]*" value="${model.form.postal}" placeholder="123-4567" style="font-size:16px;padding:12px;width:100%;"/>
        <div style="font-size:12px;color:#666;margin-top:5px;">ハイフンなしでも入力可能です</div>
      </label>
      <label style="display:block;margin-bottom:15px;">
        <div style="font-weight:bold;margin-bottom:5px;">住所</div>
        <input class="input" id="address" type="text" value="${model.form.address}" placeholder="都道府県市区町村" style="font-size:16px;padding:12px;width:100%;margin-bottom:10px;"/>
        <div style="font-size:12px;color:#666;margin-bottom:10px;">※郵便番号を7桁入力すると自動で入力されます</div>
      </label>
      <label style="display:block;margin-bottom:15px;">
        <div style="font-weight:bold;margin-bottom:5px;">番地・建物名など</div>
        <input class="input" id="addressDetail" type="text" value="${model.form.addressDetail}" placeholder="1-2-3 マンション名 101号室" style="font-size:16px;padding:12px;width:100%;"/>
      </label>
      <button class="btn primary" id="next" style="font-size:16px;padding:14px 18px;width:100%;margin-top:10px;">次へ</button>
    `;

    // 郵便番号入力時に住所を自動取得
    const postalInput = document.getElementById('postal');
    const addressInput = document.getElementById('address');
    const fetchAddress = async () => {
      const postal = postalInput.value.replace(/-/g, '');
      if (postal.length === 7) {
        try {
          const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${postal}`);
          const data = await res.json();
          if (data.results && data.results[0]) {
            const result = data.results[0];
            const address = result.address1 + result.address2 + result.address3;
            model.form.address = address;
            addressInput.value = address;
          }
        } catch(e) {
          console.error('[LIFF] Failed to fetch address:', e);
        }
      }
    };
    postalInput.addEventListener('input', fetchAddress);
    postalInput.addEventListener('blur', fetchAddress);

    document.querySelector('#next').onclick = () => {
      model.form.name = document.getElementById('name').value.trim();
      model.form.phone = document.getElementById('phone').value.trim();
      model.form.postal = document.getElementById('postal').value.trim();
      model.form.address = document.getElementById('address').value.trim();
      model.form.addressDetail = document.getElementById('addressDetail').value.trim();
      if (!model.form.name || !model.form.phone || !model.form.postal) {
        return alert('お名前、電話番号、郵便番号を入力してください。');
      }
      model.step = 2; render();
    };
  }

  function renderDrawings() {
    ui.root.innerHTML = `
      <div class="badge">2/9</div>
      <h3>図面のアップロード</h3>
      <p style="margin-bottom:20px;color:#666;">以下は参考例です。工事希望の物件の図面を撮影または保存済みの画像をアップロードしてください。</p>
      
      <div style="margin-bottom:20px;">
        <label>立面図</label>
        <div style="margin-bottom:8px;"><img src="/examples/elevation-drawing.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="立面図の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="drawing_elevation" type="file" accept="image/*" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="margin-bottom:20px;">
        <label>平面図</label>
        <div style="margin-bottom:8px;"><img src="/examples/floor-plan.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="平面図の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="drawing_plan" type="file" accept="image/*" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="margin-bottom:20px;">
        <label>断面図</label>
        <div style="margin-bottom:8px;"><img src="/examples/section-drawing.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="断面図の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="drawing_section" type="file" accept="image/*" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-ghost" id="back" style="font-size:16px;padding:14px 18px;flex:1;">戻る</button>
        <button class="btn" id="next" style="font-size:16px;padding:14px 18px;flex:2;">次へ</button>
      </div>
    `;
    document.querySelector('#back').onclick = () => { model.step = 1; render(); };
    document.querySelector('#next').onclick = () => {
      saveFiles(['drawing_elevation', 'drawing_plan', 'drawing_section']);
      model.step = 3; render();
    };
  }

  function renderPhotos() {
    ui.root.innerHTML = `
      <div class="badge">3/9</div>
      <h3>建物の写真</h3>
      <p style="margin-bottom:20px;color:#666;">以下は参考例です。工事希望の物件の写真を撮影または保存済みの画像をアップロードしてください。</p>
      
      <div style="margin-bottom:20px;">
        <label>建物の正面</label>
        <div style="margin-bottom:8px;"><img src="/examples/house-front.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="建物正面の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="photo_front" type="file" accept="image/*" capture="environment" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="margin-bottom:20px;">
        <label>建物の右側面</label>
        <div style="margin-bottom:8px;"><img src="/examples/house-side.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="建物側面の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="photo_right" type="file" accept="image/*" capture="environment" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="margin-bottom:20px;">
        <label>建物の左側面</label>
        <div style="margin-bottom:8px;"><img src="/examples/house-side.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="建物側面の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="photo_left" type="file" accept="image/*" capture="environment" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="margin-bottom:20px;">
        <label>建物の背面</label>
        <div style="margin-bottom:8px;"><img src="/examples/house-side.png" style="max-width:40%;height:auto;border:1px solid #ddd;border-radius:4px;" alt="建物背面の例"><br><span style="font-size:12px;color:#999;">※参考例</span></div>
        <input class="file" id="photo_back" type="file" accept="image/*" capture="environment" style="font-size:16px;padding:12px"/>
      </div>
      
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-ghost" id="back" style="font-size:16px;padding:14px 18px;flex:1;">戻る</button>
        <button class="btn" id="next" style="font-size:16px;padding:14px 18px;flex:2;">次へ</button>
      </div>
    `;
    document.querySelector('#back').onclick = () => { model.step = 2; render(); };
    document.querySelector('#next').onclick = () => {
      saveFiles(['photo_front', 'photo_right', 'photo_left', 'photo_back']);
      model.step = 4; render();
    };
  }

  function renderWorkDetails() {
    let html = `<div class="badge">4/9</div><h3>工事内容の詳細</h3>`;
    html += `<p style="margin-bottom:20px;color:#666;">ご希望の工事内容をお聞かせください。</p>`;

    // 外壁塗装の希望
    html += `
      <div style="margin-bottom:30px;">
        <label style="font-weight:bold;font-size:16px;margin-bottom:10px;display:block;">外壁塗装を希望しますか?</label>
        <div style="display:flex;gap:10px;margin-bottom:15px;">
          <button class="btn ${model.needsPaint === true ? 'primary' : 'btn-ghost'}" id="paintYes" style="flex:1;font-size:16px;padding:12px;">はい</button>
          <button class="btn ${model.needsPaint === false ? 'primary' : 'btn-ghost'}" id="paintNo" style="flex:1;font-size:16px;padding:12px;">いいえ</button>
        </div>
      </div>
    `;

    // 外壁塗装を希望する場合のみ塗料選択を表示
    if (model.needsPaint === true) {
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

    // 屋根工事の希望
    html += `
      <div style="margin-bottom:30px;">
        <label style="font-weight:bold;font-size:16px;margin-bottom:10px;display:block;">屋根工事を希望しますか?</label>
        <div style="display:flex;gap:10px;margin-bottom:15px;">
          <button class="btn ${model.needsRoof === true ? 'primary' : 'btn-ghost'}" id="roofYes" style="flex:1;font-size:16px;padding:12px;">はい</button>
          <button class="btn ${model.needsRoof === false ? 'primary' : 'btn-ghost'}" id="roofNo" style="flex:1;font-size:16px;padding:12px;">いいえ</button>
        </div>
      </div>
    `;

    // 屋根工事を希望する場合のみ工事内容選択を表示
    if (model.needsRoof === true) {
      html += `
        <div style="margin-bottom:30px;">
          <label style="font-weight:bold;font-size:16px;">希望の工事内容を教えてください</label>
          <div class="vlist" style="margin-top:10px;">
            ${roofOption('painting', '屋根塗装', '既存の屋根材に塗装を施し、防水性や耐久性を回復させます。特徴:コストを抑えつつ、見た目も美しく仕上がります。目安耐用年数:10〜15年', '/examples/roof-painting.png')}
            ${roofOption('cover', 'カバー工法(重ね葺き)', '古い屋根の上に新しい屋根材を重ねて施工します。撤去費用がかからず、断熱・防音性も向上。特徴:工期が短く、費用と耐久性のバランスが良い。目安耐用年数:20〜30年', '/examples/roof-cover.png')}
            ${roofOption('replacement', '葺き替え(全面交換)', '既存の屋根材をすべて撤去し、新しい屋根に張り替える工事です。特徴:劣化が進んだ屋根や雨漏りがある場合に最適。下地から完全にリフレッシュ可能。目安耐用年数:30〜40年', '/examples/roof-replacement.png')}
            ${roofOption('repair', '部分修理・補修', '雨漏り・割れ・サビなど、特定箇所のみを修理する工事です。特徴:予算を抑えつつ、緊急対応や応急処置に適しています。目安耐用年数:状態による(短期〜中期)', '/examples/roof-repair.png')}
            ${roofOption('insulation', '断熱・遮熱リフォーム', '屋根塗装やカバー工法と組み合わせて、遮熱塗料や断熱材を追加。特徴:夏の暑さ・冬の寒さを軽減し、光熱費削減にもつながります。目安耐用年数:施工方法により異なる(10〜20年)', '/examples/roof-insulation.png')}
          </div>
        </div>
      `;
    }

    html += `
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-ghost" id="back" style="font-size:16px;padding:14px 18px;flex:1;">戻る</button>
        <button class="btn" id="next" style="font-size:16px;padding:14px 18px;flex:2;">次へ</button>
      </div>
    `;

    ui.root.innerHTML = html;

    // イベントリスナー
    document.querySelector('#paintYes').onclick = () => { model.needsPaint = true; render(); };
    document.querySelector('#paintNo').onclick = () => { model.needsPaint = false; model.paintType = ''; render(); };
    document.querySelector('#roofYes').onclick = () => { model.needsRoof = true; render(); };
    document.querySelector('#roofNo').onclick = () => { model.needsRoof = false; model.roofWorkType = ''; render(); };

    if (model.needsPaint === true) {
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

    if (model.needsRoof === true) {
      document.querySelectorAll('[data-roof-work-type]').forEach(btn => {
        btn.onclick = () => {
          document.querySelectorAll('[data-roof-work-type]').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          model.roofWorkType = btn.dataset.roofWorkType;
        };
        if (model.roofWorkType === btn.dataset.roofWorkType) {
          btn.classList.add('selected');
        }
      });
    }

    document.querySelector('#back').onclick = () => { model.step = 3; render(); };
    document.querySelector('#next').onclick = () => {
      if (model.needsPaint === undefined || model.needsRoof === undefined) {
        return alert('外壁塗装と屋根工事の希望を選択してください。');
      }
      if (model.needsPaint === true && !model.paintType) {
        return alert('希望の塗料を選択してください。');
      }
      if (model.needsRoof === true && !model.roofWorkType) {
        return alert('希望の工事内容を選択してください。');
      }
      model.step = 5; render();
    };
  }

  function renderBuildingAge() {
    ui.root.innerHTML = `
      <div class="badge">5/9</div>
      <h3>築年数</h3>
      <p style="margin-bottom:20px;color:#666;">建物の築年数をお選びください。</p>
      
      <div class="vlist">
        ${buildingOption('age', '5年未満', '5年未満')}
        ${buildingOption('age', '5〜10年', '5〜10年')}
        ${buildingOption('age', '10〜15年', '10〜15年')}
        ${buildingOption('age', '15〜20年', '15〜20年')}
        ${buildingOption('age', '20年以上', '20年以上')}
      </div>
      
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-ghost" id="back" style="font-size:16px;padding:14px 18px;flex:1;">戻る</button>
        <button class="btn" id="next" style="font-size:16px;padding:14px 18px;flex:2;">次へ</button>
      </div>
    `;

    document.querySelectorAll('[data-building-age]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-building-age]').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        model.buildingAge = btn.dataset.buildingAge;
      };
      if (model.buildingAge === btn.dataset.buildingAge) {
        btn.classList.add('selected');
      }
    });

    document.querySelector('#back').onclick = () => { model.step = 4; render(); };
    document.querySelector('#next').onclick = () => {
      if (!model.buildingAge) {
        return alert('築年数を選択してください。');
      }
      model.step = 6; render();
    };
  }

  function renderBuildingFloors() {
    ui.root.innerHTML = `
      <div class="badge">6/9</div>
      <h3>階数</h3>
      <p style="margin-bottom:20px;color:#666;">建物の階数をお選びください。</p>
      
      <div class="vlist">
        ${buildingOption('floors', '1階建て', '1階建て')}
        ${buildingOption('floors', '2階建て', '2階建て')}
        ${buildingOption('floors', '3階建て', '3階建て')}
        ${buildingOption('floors', '4階建て以上', '4階建て以上')}
      </div>
      
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-ghost" id="back" style="font-size:16px;padding:14px 18px;flex:1;">戻る</button>
        <button class="btn" id="next" style="font-size:16px;padding:14px 18px;flex:2;">次へ</button>
      </div>
    `;

    document.querySelectorAll('[data-building-floors]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-building-floors]').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        model.buildingFloors = btn.dataset.buildingFloors;
      };
      if (model.buildingFloors === btn.dataset.buildingFloors) {
        btn.classList.add('selected');
      }
    });

    document.querySelector('#back').onclick = () => { model.step = 5; render(); };
    document.querySelector('#next').onclick = () => {
      if (!model.buildingFloors) {
        return alert('階数を選択してください。');
      }
      model.step = 7; render();
    };
  }

  function renderWallMaterial() {
    ui.root.innerHTML = `
      <div class="badge">7/9</div>
      <h3>外壁材</h3>
      <p style="margin-bottom:20px;color:#666;">見た目が近いものを選んでください(画像はサンプルです)。</p>
      
      <div class="grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
        ${wallMaterialOption('サイディング', '/img/siding.png')}
        ${wallMaterialOption('ガルバリウム', '/img/galvalume.png')}
        ${wallMaterialOption('モルタル', '/img/mortar.png')}
        ${wallMaterialOption('ALC', '/img/alc.png')}
        ${wallMaterialOption('木', '/img/wood.png')}
        ${wallMaterialOption('RC', '/img/rc.png')}
        ${wallMaterialOption('その他', '/img/other.png')}
        ${wallMaterialOption('わからない', '/img/unknown.png')}
      </div>
      
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-ghost" id="back" style="font-size:16px;padding:14px 18px;flex:1;">戻る</button>
        <button class="btn" id="next" style="font-size:16px;padding:14px 18px;flex:2;">確認へ</button>
      </div>
    `;

    document.querySelectorAll('[data-wall-material]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-wall-material]').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        model.wallMaterial = btn.dataset.wallMaterial;
      };
      if (model.wallMaterial === btn.dataset.wallMaterial) {
        btn.classList.add('selected');
      }
    });

    document.querySelector('#back').onclick = () => { model.step = 6; render(); };
    document.querySelector('#next').onclick = () => {
      if (!model.wallMaterial) {
        return alert('外壁材を選択してください。');
      }
      model.step = 8; render();
    };
  }

  function renderConfirm() {
    const paintLabels = {
      'acrylic': 'コスト重視(アクリル系またはウレタン系塗料)',
      'silicon': 'バランス重視(シリコン系塗料)',
      'fluorine': '高耐久＋機能付き(フッ素系/無機系/ラジカル制御塗料)',
      'thermal': '機能重視(遮熱・断熱塗料)'
    };
    const roofLabels = {
      'painting': '屋根塗装',
      'cover': 'カバー工法(重ね葺き)',
      'replacement': '葺き替え(全面交換)',
      'repair': '部分修理・補修',
      'insulation': '断熱・遮熱リフォーム'
    };

    let additionalInfo = '';
    additionalInfo += `<div>外壁塗装:<b>${model.needsPaint ? '希望する' : '希望しない'}</b></div>`;
    if (model.needsPaint && model.paintType) {
      additionalInfo += `<div style="margin-left:20px;">希望の塗料:<b>${paintLabels[model.paintType] || model.paintType}</b></div>`;
    }
    additionalInfo += `<div>屋根工事:<b>${model.needsRoof ? '希望する' : '希望しない'}</b></div>`;
    if (model.needsRoof && model.roofWorkType) {
      additionalInfo += `<div style="margin-left:20px;">希望の工事内容:<b>${roofLabels[model.roofWorkType] || model.roofWorkType}</b></div>`;
    }

    let drawingThumbs = '';
    for (const key of ['drawing_elevation', 'drawing_plan', 'drawing_section']) {
      if (model.fileUrls[key]) {
        drawingThumbs += `<img src="${model.fileUrls[key]}" style="width:80px;height:80px;object-fit:cover;border:1px solid #ddd;border-radius:4px;"/>`;
      }
    }

    let photoThumbs = '';
    for (const key of ['photo_front', 'photo_right', 'photo_left', 'photo_back']) {
      if (model.fileUrls[key]) {
        photoThumbs += `<img src="${model.fileUrls[key]}" style="width:80px;height:80px;object-fit:cover;border:1px solid #ddd;border-radius:4px;"/>`;
      }
    }

    const fullAddress = model.form.address ? `${model.form.address} ${model.form.addressDetail}` : model.form.postal;

    ui.root.innerHTML = `
      <div class="badge">8/9</div>
      <h3>入力内容のご確認</h3>
      <div class="summary">
        <div>お名前:<b>${model.form.name}</b></div>
        <div>電話番号:<b>${model.form.phone}</b></div>
        <div>郵便番号:<b>${model.form.postal}</b></div>
        <div>住所:<b>${fullAddress}</b></div>
        ${additionalInfo}
        <div>築年数:<b>${model.buildingAge}</b></div>
        <div>階数:<b>${model.buildingFloors}</b></div>
        <div>外壁材:<b>${model.wallMaterial}</b></div>
        <div style="margin-top:12px;">図面:</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">${drawingThumbs}</div>
        <div>建物写真:</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${photoThumbs}</div>
      </div>
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-ghost" id="back" style="font-size:16px;padding:14px 18px;flex:1;">戻る</button>
        <button class="btn primary" id="submit" style="font-size:18px;padding:18px 24px;flex:2;font-weight:bold;">この内容で見積もりを依頼</button>
      </div>
    `;

    document.querySelector('#back').onclick = () => { model.step = 7; render(); };
    document.querySelector('#submit').onclick = submitAll;
  }

  async function submitAll() {
    console.log('[LIFF] Submitting...');
    console.log('[LIFF] leadId:', model.leadId);
    console.log('[LIFF] lineUserId:', model.lineUserId);
    console.log('[LIFF] displayName:', model.displayName);

    if (!model.leadId) {
      console.error('[LIFF] leadId is missing!');
      alert('エラー: 概算見積もりから開始してください。\n\n以下のURLから概算見積もりを開始してください：\nhttps://line-paint.onrender.com/');
      // 概算見積もりページにリダイレクト
      window.location.href = 'https://line-paint.onrender.com/';
      return;
    }

    const fd = new FormData();
    fd.append('leadId', model.leadId);
    fd.append('lineUserId', model.lineUserId);
    fd.append('displayName', model.displayName);
    fd.append('name', model.form.name);
    fd.append('phone', model.form.phone);
    fd.append('postal', model.form.postal);
    fd.append('address', model.form.address || '');
    fd.append('addressDetail', model.form.addressDetail || '');
    fd.append('needsPaint', model.needsPaint ? 'true' : 'false');
    fd.append('needsRoof', model.needsRoof ? 'true' : 'false');
    fd.append('paintType', model.paintType || '');
    fd.append('roofWorkType', model.roofWorkType || '');
    fd.append('buildingAge', model.buildingAge || '');
    fd.append('buildingFloors', model.buildingFloors || '');
    fd.append('wallMaterial', model.wallMaterial || '');

    const ids = ['drawing_elevation','drawing_plan','drawing_section','photo_front','photo_right','photo_left','photo_back'];
    for (const id of ids) {
      if (model.files[id]) {
        fd.append(id, model.files[id], model.files[id].name);
      }
    }

    try {
      const res = await fetch('/api/details', { method: 'POST', body: fd });
      console.log('[LIFF] submit response status:', res.status);
      const data = await res.json().catch(() => ({}));
      console.log('[LIFF] submit response data:', data);
      if (data && data.error) {
        console.error('[LIFF] Submit error:', data.error);
        return alert('送信に失敗しました: ' + data.error);
      }
      model.step = 9; render();
    } catch (e) {
      console.error('[LIFF] Submit exception:', e);
      alert('送信に失敗しました。通信状態をご確認ください。');
    }
  }

  function renderDone() {
    ui.root.innerHTML = `
      <h2 style="color:#10b981;margin-bottom:20px;">送信完了</h2>
      <p>詳細見積もりのご依頼ありがとうございます。<br>
      お見積もりが出来次第LINEでご連絡いたします。<br><br>
      現地調査や営業訪問電話での営業などは一切行いませんのでご安心ください。</p>
    `;
    // LINEアプリを閉じる
    setTimeout(() => {
      if (liff.isInClient()) {
        liff.closeWindow();
      }
    }, 2000);
  }

  function paintOption(value, title, desc, img) {
    return `
      <div class="selectable-card" data-paint-type="${value}">
        <img src="${img}" alt="${title}" style="width:80px;height:60px;object-fit:cover;border-radius:4px;margin-right:12px;">
        <div style="flex:1;">
          <div style="font-weight:bold;font-size:15px;margin-bottom:4px;">${title}</div>
          <div style="font-size:13px;color:#666;">${desc}</div>
        </div>
      </div>
    `;
  }

  function roofOption(value, title, desc, img) {
    return `
      <div class="selectable-card" data-roof-work-type="${value}">
        <img src="${img}" alt="${title}" style="width:80px;height:60px;object-fit:cover;border-radius:4px;margin-right:12px;">
        <div style="flex:1;">
          <div style="font-weight:bold;font-size:15px;margin-bottom:4px;">${title}</div>
          <div style="font-size:13px;color:#666;">${desc}</div>
        </div>
      </div>
    `;
  }

  function buildingOption(type, value, label) {
    const dataAttr = type === 'age' ? 'data-building-age' : type === 'floors' ? 'data-building-floors' : 'data-wall-material';
    return `
      <div class="selectable-card" ${dataAttr}="${value}">
        <div style="font-weight:bold;font-size:15px;">${label}</div>
      </div>
    `;
  }

  function wallMaterialOption(label, img) {
    return `
      <div class="option" data-wall-material="${label}" style="cursor:pointer;">
        <div class="thumb" style="background-image:url('${img}');"></div>
        <div class="label">${label}</div>
      </div>
    `;
  }

  function saveFiles(ids) {
    for (const id of ids) {
      const input = document.getElementById(id);
      if (input && input.files && input.files[0]) {
        model.files[id] = input.files[0];
        model.fileUrls[id] = URL.createObjectURL(input.files[0]);
      }
    }
  }
})();

