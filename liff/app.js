(async()=>{
  const $ = (id)=> document.getElementById(id);
  const priceEl = $('price');
  const progEl  = $('prog');
  const prevBox = $('preview');

  // 画像 → base64（長辺1600pxに縮小）
  async function fileToBase64Resized(file){
    const img = new Image();
    const dataUrl = await new Promise((resolve,reject)=>{
      const fr=new FileReader();
      fr.onload = ()=> resolve(fr.result);
      fr.onerror= reject;
      fr.readAsDataURL(file);
    });
    img.src = dataUrl;
    await new Promise(r=> img.onload=r);

    const max = 1600;
    const {width:w0,height:h0} = img;
    const ratio = Math.min(1, max / Math.max(w0,h0));
    const w = Math.round(w0*ratio), h = Math.round(h0*ratio);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0,0,w,h);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  function setProgress(n){ progEl.style.width = `${n}%`; }

  // 郵便番号 → 住所
  async function fillByZip(){
    const z = $('postal').value.replace(/[^\d]/g,'');
    if (!z || z.length<7) return;
    try{
      const url = `https://zipcloud.ibsnet.co.jp/api/search?zipcode=${z}`;
      const resp = await fetch(url); const js = await resp.json();
      if(js && js.results && js.results[0]){
        const r = js.results[0];
        $('addr1').value = `${r.address1}${r.address2}${r.address3}`; // 県市区町
      }else{
        alert('住所が見つかりませんでした');
      }
    }catch(e){ console.log(e); }
  }

  $('zipBtn').addEventListener('click', fillByZip);

  // LIFF 初期化
  await liff.init({ liffId: (window.__LIFF_ENV__||{}).LIFF_ID });
  if (!liff.isLoggedIn()) { liff.login({}); return; }

  // 概算のプレビュー（サーバの回答を取得）
  try{
    const token = liff.getAccessToken();
    const r = await fetch('/liff/prefill',{ headers:{ Authorization:`Bearer ${token}` }});
    const js = await r.json();
    if (js && js.priceYen) priceEl.textContent = js.priceYen;
  }catch(e){ console.log('prefill error', e); }

  // プレビュー
  $('photos').addEventListener('change', ()=>{
    prevBox.innerHTML = '';
    const files = Array.from($('photos').files || []).slice(0,10);
    for(const f of files){
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.src = url; img.className = 'thumb';
      prevBox.appendChild(img);
    }
  });

  // 送信
  $('submitBtn').addEventListener('click', async ()=>{
    const name  = $('name').value.trim();
    const phone = $('phone').value.trim();
    const postal= $('postal').value.trim();
    const addr1 = $('addr1').value.trim();
    const addr2 = $('addr2').value.trim();

    if(!name){ alert('お名前を入力してください'); return; }
    if(!phone){ alert('電話番号を入力してください'); return; }
    if(!postal || postal.replace(/[^\d]/g,'').length!==7){ alert('郵便番号は7桁で入力してください'); return; }
    if(!addr1){ alert('住所（都道府県・市区町村・番地）を入力してください'); return; }

    // 画像をbase64化
    const files = Array.from($('photos').files || []).slice(0,10);
    const total = files.length || 1;
    const b64s = [];
    let i=0;
    for(const f of files){
      i++; setProgress(Math.round(i/total*100));
      const b64 = await fileToBase64Resized(f);
      // dataURL -> 純粋なbase64にして Apps Script に送ってもOKだが
      // ここでは dataURL（"data:image/jpeg;base64,..."）のまま送る
      b64s.push(b64);
    }
    if(files.length===0) setProgress(100);

    try{
      const token = liff.getAccessToken();
      const resp = await fetch('/liff/submit', {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          Authorization:`Bearer ${token}`,
        },
        body: JSON.stringify({ name, phone, postal, addr1, addr2, photosBase64: b64s })
      });
      const js = await resp.json();
      if(js && js.ok){
        alert('送信しました。1〜3営業日以内にLINEでお見積書をお送りします。');
        if (liff.isInClient()) liff.closeWindow();
      }else{
        alert('送信に失敗しました。時間をおいて再度お試しください。');
      }
    }catch(e){
      console.log(e);
      alert('通信エラーが発生しました。');
    }
  });
})();
