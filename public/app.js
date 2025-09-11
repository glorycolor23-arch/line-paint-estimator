(() => {
  const el = (h, attrs={}, ...children) => {
    const n = document.createElement(h);
    for (const [k,v] of Object.entries(attrs||{})) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v);
    }
    for (const c of children) {
      if (c==null) continue;
      if (typeof c === 'string') n.appendChild(document.createTextNode(c));
      else n.appendChild(c);
    }
    return n;
  };

  const app = document.getElementById('app');

  const state = {
    step: 0,
    desire: null,
    age: null,
    floors: null,
    material: null
  };

  const materials = [
    { key:'サイディング', img:'/img/materials/siding.jpg' },
    { key:'モルタル',     img:'/img/materials/mortar.jpg' },
    { key:'ALC',         img:'/img/materials/alc.jpg' },
    { key:'ガルバリウム', img:'/img/materials/galvalume.jpg' },
    { key:'木',          img:'/img/materials/wood.jpg' },
    { key:'RC',          img:'/img/materials/rc.jpg' },
    { key:'その他',       img:'/img/materials/other.jpg' },
    { key:'わからない',   img:'/img/materials/unknown.jpg' }
  ];

  function render() {
    app.innerHTML = '';
    const footer = el('div', {class:'footer'});
    const backBtn = el('button', {class:'btn ghost'}, '戻る');
    backBtn.onclick = () => { state.step = Math.max(0, state.step-1); render(); };
    const nextBtn = el('button', {class:'btn primary'}, state.step<4 ? '次へ' : 'この内容で送信');
    nextBtn.onclick = onNext;

    // STEPごとのUI
    if (state.step === 0) {
      app.append(
        el('div', {class:'grid cols-3'},
          ...['外壁','屋根','外壁と屋根'].map(v=>{
            const b = el('button', {class:'opt'+(state.desire===v?' selected':'')}, v);
            b.onclick = ()=>{ state.desire=v; render(); };
            return b;
          })
        )
      );
    }
    if (state.step === 1) {
      app.append(
        el('div', {class:'grid cols-3'},
          ...['1〜5年','6〜10年','11〜15年','16〜20年','21〜25年','26〜30年','31年以上'].map(v=>{
            const b = el('button', {class:'opt'+(state.age===v?' selected':'')}, v);
            b.onclick = ()=>{ state.age=v; render(); };
            return b;
          })
        )
      );
    }
    if (state.step === 2) {
      app.append(
        el('div', {class:'grid cols-3'},
          ...['1階建て','2階建て','3階建て以上'].map(v=>{
            const b = el('button', {class:'opt'+(state.floors===v?' selected':'')}, v);
            b.onclick = ()=>{ state.floors=v; render(); };
            return b;
          })
        )
      );
    }
    if (state.step === 3) {
      const grid = el('div', {class:'grid cols-4'});
      for (const m of materials) {
        const card = el('button', {class:'opt imgopt'+(state.material===m.key?' selected':'')});
        const img = el('img', {src:m.img, alt:m.key});
        img.onerror = () => { img.replaceWith(el('div',{class:'center', html:'🧱'})); };
        const label = el('span', {}, m.key);
        card.append(img, label);
        card.onclick = ()=>{ state.material=m.key; render(); };
        grid.appendChild(card);
      }
      app.append(grid);
    }
    if (state.step === 4) {
      const dl = el('div', {class:'grid cols-2'});
      const addRow = (k,v)=>dl.append(
        el('div', {class:'opt', html:`<b>${k}</b><div>${v}</div>`})
      );
      addRow('■見積もり希望内容', state.desire);
      addRow('■築年数', state.age);
      addRow('■階数', state.floors);
      addRow('■外壁材', state.material);
      app.append(dl);
    }

    // フッター
    if (state.step > 0) footer.append(backBtn);
    footer.append(nextBtn);
    app.append(footer);
  }

  async function onNext() {
    if (state.step === 0 && !state.desire) return alert('選択してください');
    if (state.step === 1 && !state.age) return alert('選択してください');
    if (state.step === 2 && !state.floors) return alert('選択してください');
    if (state.step === 3 && !state.material) return alert('選択してください');

    if (state.step < 4) {
      state.step++;
      render();
      return;
    }

    // 送信
    try {
      const resp = await fetch('/api/estimate', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          desire: state.desire,
          age: state.age,
          floors: state.floors,
          material: state.material
        })
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || '送信に失敗しました');
      // ログインへ遷移（ログイン後は after-login.html でトーク自動起動 → #lead:xxx を送ってもらう）
      location.href = json.loginUrl;
    } catch(e) {
      alert(e.message || '送信に失敗しました');
    }
  }

  render();
})();
