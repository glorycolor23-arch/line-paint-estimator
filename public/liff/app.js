(async function(){
  const STEPS = 5;
  let cur = 1;
  let state = { name:'', postal:'', addr1:'', addr2:'', lat:null, lng:null };
  let idToken = '';

  // LIFF 初期化（IDはチャネルに紐づく設定値が使われる）
  await liff.init({});
  if(!liff.isLoggedIn()){ liff.login(); return; }
  idToken = liff.getIDToken();

  // 初期表示（名前にプロフィールを利用）
  try {
    const prof = await liff.getProfile();
    if (prof?.displayName) document.getElementById('name').value = prof.displayName;
  } catch {}

  function setProgress(){
    document.getElementById('bar').style.width = `${(cur-1)/(STEPS-1)*100}%`;
    document.getElementById('stepLabel').textContent = `${cur} / ${STEPS}`;
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.querySelector(`.step[data-step="${cur}"]`).classList.add('active');
  }

  // 郵便番号 → 住所自動補完（ZipCloud）
  async function fetchZip(zip){
    try{
      const z = (zip||'').replace(/[^\d]/g,'');
      if(z.length!==7) return null;
      const r = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${z}`).then(r=>r.json());
      const a = r?.results?.[0]; if(!a) return null;
      return `${a.address1}${a.address2}${a.address3}`;
    }catch{ return null; }
  }

  // 地図（Leaflet）
  let map, marker;
  function ensureMap(){
    if(map) return;
    map = L.map('map').setView([35.681236,139.767125], 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{ maxZoom:19 }).addTo(map);
    marker = L.marker(map.getCenter(), { draggable:true }).addTo(map);
    const setLL = (latlng)=>{ marker.setLatLng(latlng); state.lat = latlng.lat; state.lng = latlng.lng; };
    marker.on('dragend', ()=> setLL(marker.getLatLng()));
    map.on('click', (e)=> setLL(e.latlng));

    // 位置情報が取れれば中心に
    liff.getGeolocation?.()?.then(pos=>{
      if(!pos) return;
      const latlng = [pos.coords.latitude, pos.coords.longitude];
      map.setView(latlng, 16); marker.setLatLng(latlng);
      state.lat = latlng[0]; state.lng = latlng[1];
    }).catch(()=>{});
  }

  // 入力制御
  document.getElementById('postal').addEventListener('input', (e)=>{
    e.target.value = e.target.value.replace(/[^\d]/g,'').slice(0,7);
  });

  // 画面遷移
  document.querySelectorAll('.next').forEach(b=>b.addEventListener('click', async ()=>{
    if(cur===1){
      state.name = document.getElementById('name').value.trim();
      if(!state.name){ alert('お名前を入力してください'); return; }
    }
    if(cur===2){
      const z = document.getElementById('postal').value.replace(/[^\d]/g,'');
      if(z.length!==7){ alert('郵便番号は7桁で入力してください'); return; }
      state.postal = z;
      // 自動補完
      const addr = await fetchZip(z);
      if(addr){ document.getElementById('addr1').value = addr; }
    }
    if(cur===3){
      state.addr1 = document.getElementById('addr1').value.trim();
      state.addr2 = document.getElementById('addr2').value.trim();
    }
    if(cur===4){
      // 最終確認用に最新の座標をとっておく
      if(marker){
        const p = marker.getLatLng();
        state.lat = p.lat; state.lng = p.lng;
      }
      // プレビュー
      const pv = document.getElementById('preview');
      pv.innerHTML = `
        <table>
          <tr><th>お名前</th><td>${escapeHtml(state.name)}</td></tr>
          <tr><th>郵便番号</th><td>${escapeHtml(state.postal)}</td></tr>
          <tr><th>住所1</th><td>${escapeHtml(state.addr1)}</td></tr>
          <tr><th>住所2</th><td>${escapeHtml(state.addr2)}</td></tr>
          <tr><th>緯度/経度</th><td>${state.lat||''} / ${state.lng||''}</td></tr>
        </table>`;
    }

    cur = Math.min(STEPS, cur+1);
    if(cur===4) ensureMap();
    setProgress();
  }));

  document.querySelectorAll('.back').forEach(b=>b.addEventListener('click', ()=>{
    cur = Math.max(1, cur-1);
    setProgress();
  }));

  // 送信
  document.getElementById('submitBtn').addEventListener('click', async ()=>{
    const consent = document.getElementById('consent').checked;
    if(!consent){ alert('同意にチェックしてください'); return; }

    const payload = {
      idToken,
      name: state.name,
      postal: state.postal,
      addr1: state.addr1,
      addr2: state.addr2,
      lat: state.lat,
      lng: state.lng,
      consent: true
    };
    try{
      const r = await fetch(window.__SUBMIT_ENDPOINT__, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      }).then(r=>r.json());
      if(!r.ok){ throw new Error(r.error||'submit failed'); }

      // 送信成功：LIFFを閉じる（メッセージはBot側がpush）
      if(liff.isInClient()) liff.closeWindow();
      else alert('送信しました。LINEに戻ってご確認ください。');
    }catch(e){
      alert('送信に失敗しました。通信環境をご確認のうえ再度お試しください。');
      console.error(e);
    }
  });

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  setProgress();
})();
