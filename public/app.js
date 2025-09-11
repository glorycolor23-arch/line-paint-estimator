// public/app.js
(() => {
  const LINE_ADD_FRIEND_URL =
    window.LINE_ADD_FRIEND_URL || 'https://line.me/R/ti/p/@YOUR_BOT_ID';

  const root =
    document.getElementById('step') ||
    document.getElementById('app') ||
    document.body;

  const state = { desire:null, age:null, floors:null, material:null, leadId:null };

  const QUESTIONS = [
    { key:'desire', title:'お見積もり希望の内容は何ですか？', options:['外壁','屋根','外壁と屋根'] },
    { key:'age',    title:'築年数をお選びください', options:['1〜5年','6〜10年','11〜15年','16〜20年','21〜25年','26〜30年','31年以上'] },
    { key:'floors', title:'何階建てですか？', options:['1階建て','2階建て','3階建て以上'] },
    { key:'material', title:'外壁材を以下からお選びください', options:['サイディング','モルタル','ALC','ガルバリウム','木','RC','その他','わからない'] },
  ];

  let stepIndex = 0;

  function render(html){
    root.innerHTML = `<div class="container"><div class="card">${html}</div></div>`;
    window.scrollTo({ top:0, behavior:'smooth' });
  }
  function buttons(items){
    return `<div class="btns">${items.map(it=>`<button class="btn" data-val="${escapeAttr(it)}">${escapeHtml(it)}</button>`).join('')}</div>`;
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));}
  function escapeAttr(s){return String(s).replace(/"/g,'&quot;');}

  function renderStep(){
    if(stepIndex < QUESTIONS.length){
      const q = QUESTIONS[stepIndex];
      render(`<h1>外壁塗装見積もり</h1><p class="q">${escapeHtml(q.title)}</p>${buttons(q.options)}`);
      bindOptionClick(q.key);
      return;
    }
    renderConfirm();
  }
  function bindOptionClick(key){
    root.querySelectorAll('button.btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        state[key] = btn.dataset.val;
        stepIndex += 1;
        renderStep();
      });
    });
  }
  function renderConfirm(){
    render(`
      <h1>入力内容のご確認</h1>
      <div class="summary">
        <p>■見積もり希望内容：${escapeHtml(state.desire)}</p>
        <p>■築年数：${escapeHtml(state.age)}</p>
        <p>■階数：${escapeHtml(state.floors)}</p>
        <p>■外壁材：${escapeHtml(state.material)}</p>
      </div>
      <div class="btns">
        <button id="yes" class="btn primary">この内容で送信</button>
        <button id="no" class="btn">最初からやり直す</button>
      </div>
    `);
    root.querySelector('#no').addEventListener('click',()=>{
      stepIndex=0; state.desire=state.age=state.floors=state.material=null; renderStep();
    });
    root.querySelector('#yes').addEventListener('click', submitAnswers);
  }
  async function submitAnswers(){
    try{
      render(`<h1>送信中…</h1><p>しばらくお待ちください</p>`);
      const resp = await fetch('/api/estimate',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          desire:state.desire, age:state.age, floors:state.floors, material:state.material
        }),
      });
      const json = await resp.json().catch(()=>({}));
      if(!resp.ok || !json.ok) throw new Error(json.error || '送信に失敗しました');
      state.leadId = json.leadId;
      renderCompletedView();
      const url = `/auth/line/start?lead=${encodeURIComponent(state.leadId)}`;
      setTimeout(()=>{ window.location.href = url; }, 800);
    }catch(e){
      console.error(e);
      render(`<h1>送信に失敗しました</h1><p>通信状態をご確認のうえ、もう一度お試しください。</p><div class="btns"><button id="retry" class="btn">戻る</button></div>`);
      root.querySelector('#retry').addEventListener('click', renderConfirm);
    }
  }
  function renderCompletedView(){
    render(`
      <h1>送信完了</h1>
      <p>ありがとうございます。LINEで結果をお送りします。</p>
      <div class="notice"><p>※ まだ友だち追加がお済みでない場合は、下のボタンから追加してください。</p></div>
      <div class="btns">
        <a class="btn primary" href="${LINE_ADD_FRIEND_URL}" target="_blank" rel="noopener">LINE で友だち追加</a>
      </div>
      <hr />
      <p>このあと自動で連携画面へ移動します。画面が切り替わらない場合は <a id="manualLogin" href="#">こちら</a> をタップしてください。</p>
    `);
    const manual = root.querySelector('#manualLogin');
    manual.addEventListener('click',(e)=>{
      e.preventDefault();
      if(!state.leadId) return;
      const url = `/auth/line/start?lead=${encodeURIComponent(state.leadId)}`;
      window.location.href = url;
    });
  }
  renderStep();
})();
