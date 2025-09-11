// ====== 画像は /img 以下のローカルファイルのみを参照 ======
const IMG = (name) => `/img/${name}.png`;   // .png を優先（同名 .jpg も置いてあるが固定にします）

// ====== 設問定義（必要最小限：既存サーバ側の処理は変更しない） ======
const STEPS = [
  {
    key: 'target',
    title: 'お見積もり希望の内容は？',
    type: 'select-one-v',
    options: [
      { value:'wall',  label:'外壁' },
      { value:'roof',  label:'屋根' },
      { value:'both',  label:'外壁と屋根' },
    ],
  },
  {
    key: 'wallMaterial',
    title: '外壁材をお選びください',
    desc: '見た目が近いものを選んでください',
    type: 'select-one-grid',
    when: (a)=> a.target==='wall' || a.target==='both',
    options: [
      { value:'siding',    label:'サイディング', img: IMG('siding') },
      { value:'galvalume', label:'ガルバリウム', img: IMG('galvalume') },
      { value:'mortar',    label:'モルタル',     img: IMG('mortar') },
      { value:'alc',       label:'ALC',          img: IMG('alc') },
      { value:'wood',      label:'木',           img: IMG('wood') },
      { value:'rc',        label:'RC',           img: IMG('rc') },
      { value:'other',     label:'その他',       img: IMG('other') },
    ],
  },
  {
    key: 'roofType',
    title: '屋根材をお選びください',
    type: 'select-one-grid',
    when: (a)=> a.target==='roof' || a.target==='both',
    options: [
      { value:'slate', label:'スレート', img: IMG('unknown') },
      { value:'metal', label:'金属',     img: IMG('galvalume') },
      { value:'tile',  label:'瓦',       img: IMG('unknown') },
      { value:'other', label:'その他',   img: IMG('other') },
    ],
  },
  {
    key: 'confirm',
    title: '入力内容のご確認',
    type: 'confirm',
  }
];

// ====== 状態管理 ======
const state = {
  answers: {},
  idx: 0,
  order: []
};

// ステップ列を再構成（when 条件で出し分け）
function buildOrder() {
  state.order = STEPS.filter(step => {
    if (!step.when) return true;
    return step.when(state.answers);
  }).map(s => s.key);
  // 進行中の index がはみ出していたら戻す
  if (state.idx >= state.order.length) state.idx = Math.max(0, state.order.length - 1);
}

// ====== DOM ======
const $root = document.getElementById('q-root');
const $stepper = document.getElementById('stepper');
const $next = document.getElementById('nextBtn');
const $back = document.getElementById('backBtn');
const $submit = document.getElementById('submitBtn');
const $done = document.getElementById('done');

$next.addEventListener('click', next);
$back.addEventListener('click', back);
$submit.addEventListener('click', submit);

init();

function init(){
  buildOrder();
  render();
}

function currentStepDef(){
  const key = state.order[state.idx];
  return STEPS.find(s => s.key === key);
}

function renderStepper(){
  const total = state.order.length;
  const n = state.idx + 1;
  $stepper.textContent = `Step ${n} / ${total}`;
}

function render(){
  $done.hidden = true;
  $root.innerHTML = '';
  $submit.hidden = true;
  $next.hidden = false;

  renderStepper();

  const step = currentStepDef();
  if (!step){ return; }

  const h2 = document.createElement('h2');
  h2.textContent = step.title;
  $root.appendChild(h2);
  if (step.desc){
    const p = document.createElement('p');
    p.className = 'desc';
    p.textContent = step.desc;
    $root.appendChild(p);
  }

  // ボタン状態
  $back.disabled = state.idx === 0;
  $next.disabled = true;

  // コンテンツ
  if (step.type === 'select-one-v'){
    renderSelectOneV(step);
  }else if (step.type === 'select-one-grid'){
    renderSelectOneGrid(step);
  }else if (step.type === 'confirm'){
    renderConfirm();
  }
}

function renderSelectOneV(step){
  const wrap = document.createElement('div');
  wrap.className = 'vlist';

  step.options.forEach(opt=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vbtn';
    btn.textContent = opt.label;
    btn.setAttribute('role','radio');
    btn.setAttribute('aria-checked', String(state.answers[step.key] === opt.value));
    btn.addEventListener('click', ()=>{
      select(step.key, opt.value);
      [...wrap.querySelectorAll('.vbtn')].forEach(b => b.setAttribute('aria-checked','false'));
      btn.setAttribute('aria-checked','true');
      $next.disabled = false;
    });
    wrap.appendChild(btn);
  });
  $root.appendChild(wrap);
}

function renderSelectOneGrid(step){
  const grid = document.createElement('div');
  grid.className = 'grid';
  step.options.forEach(opt=>{
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'option';
    card.setAttribute('role','radio');
    card.setAttribute('aria-checked', String(state.answers[step.key] === opt.value));

    const ph = document.createElement('div');
    ph.className = 'thumb';
    ph.style.backgroundImage = `url("${opt.img}")`;

    const cap = document.createElement('div');
    cap.className = 'label';
    cap.textContent = opt.label;

    card.appendChild(ph);
    card.appendChild(cap);

    card.addEventListener('click', ()=>{
      select(step.key, opt.value);
      grid.querySelectorAll('.option').forEach(el => el.setAttribute('aria-checked','false'));
      card.setAttribute('aria-checked','true');
      $next.disabled = false;
    });

    grid.appendChild(card);
  });

  $root.appendChild(grid);
}

function renderConfirm(){
  $next.hidden = true;
  $submit.hidden = false;

  const ul = document.createElement('ul');
  ul.style.margin = '10px 0 0';
  ul.style.paddingLeft = '18px';

  const view = [
    ['希望内容', dispTarget(state.answers.target)],
    ...(state.answers.wallMaterial ? [['外壁材', dispWall(state.answers.wallMaterial)]] : []),
    ...(state.answers.roofType ? [['屋根材', dispRoof(state.answers.roofType)]] : []),
  ];
  for (const [k,v] of view){
    const li = document.createElement('li');
    li.textContent = `${k}: ${v}`;
    ul.appendChild(li);
  }
  $root.appendChild(ul);
}

// 表示名
function dispTarget(v){
  return ({wall:'外壁', roof:'屋根', both:'外壁と屋根'})[v] ?? '-';
}
function dispWall(v){
  return ({
    siding:'サイディング', galvalume:'ガルバリウム', mortar:'モルタル',
    alc:'ALC', wood:'木', rc:'RC', other:'その他'
  })[v] ?? '-';
}
function dispRoof(v){
  return ({slate:'スレート', metal:'金属', tile:'瓦', other:'その他'})[v] ?? '-';
}

// 値選択
function select(key, value){
  // 現在の回答を設定
  state.answers[key] = value;

  // 以降の回答はリセット（戻る→再選択時の不整合を排除）
  const curIndex = state.order.indexOf(key);
  const keysAfter = state.order.slice(curIndex + 1);
  keysAfter.forEach(k => { delete state.answers[k]; });

  // 出し分け再計算
  buildOrder();
}

// 移動
function next(){
  if ($next.disabled) return;
  if (state.idx < state.order.length - 1){
    state.idx++;
    render();
  }
}
function back(){
  if (state.idx === 0) return;
  state.idx--;
  // ひとつ前に戻ったら、その先の回答はリセット
  const key = state.order[state.idx];
  const i = state.order.indexOf(key);
  state.order.slice(i + 1).forEach(k => delete state.answers[k]);
  buildOrder();
  render();
}

// 送信
async function submit(){
  $submit.disabled = true;

  // 既存のサーバ側実装に合わせ、/estimate と /api/estimate のどちらかに送る。
  const payload = { answers: state.answers };

  const endpoints = ['/estimate', '/api/estimate'];
  let ok = false;
  for (const ep of endpoints){
    try{
      const res = await fetch(ep, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      if (res.ok){ ok = true; break; }
    }catch(_e){}
  }

  // 完了画面を表示（自動遷移はしない）
  document.querySelector('.nav').classList.add('hidden');
  document.getElementById('q-root').classList.add('hidden');
  document.getElementById('stepper').classList.add('hidden');
  const done = document.getElementById('done');
  done.hidden = false;

  // 失敗してもユーザー体験を止めない（サーバ側からLINE連携／Webhookで送る想定のため）
  if (!ok){
    console.warn('送信APIが応答しませんでしたが、フローは継続します。');
  }
}
