// 画像はローカルのみ（/img/*.png を固定で参照）
const IMG = (name) => `/img/${name}.png`;

// 設問（計算ロジックに合わせてキー名を統一）
const STEPS = [
  {
    key: 'desiredWork',
    title: 'お見積もり希望の内容は？',
    type: 'select-one-v',
    options: [
      { value:'外壁',       label:'外壁' },
      { value:'屋根',       label:'屋根' },
      { value:'外壁と屋根', label:'外壁と屋根' },
    ],
  },
  {
    key: 'ageRange',
    title: '築年数をお選びください',
    type: 'select-one-v',
    options: ['1〜5年','6〜10年','11〜15年','16〜20年','21〜25年','26〜30年','31年以上']
      .map(v => ({ value: v, label: v })),
  },
  {
    key: 'floors',
    title: '何階建てですか？',
    type: 'select-one-v',
    options: [
      { value:'1階建て',   label:'1階建て' },
      { value:'2階建て',   label:'2階建て' },
      { value:'3階建て以上', label:'3階建て以上' },
    ],
  },
  {
    key: 'wallMaterial',
    title: '外壁材をお選びください',
    desc: '見た目が近いものを選んでください',
    type: 'select-one-grid',
    options: [
      { value:'サイディング',  label:'サイディング',  img: IMG('siding') },
      { value:'ガルバリウム',  label:'ガルバリウム',  img: IMG('galvalume') },
      { value:'モルタル',      label:'モルタル',      img: IMG('mortar') },
      { value:'ALC',          label:'ALC',          img: IMG('alc') },
      { value:'木',            label:'木',            img: IMG('wood') },
      { value:'RC',           label:'RC',           img: IMG('rc') },
      { value:'その他',        label:'その他',        img: IMG('other') },
      { value:'わからない',    label:'わからない',    img: IMG('unknown') },
    ],
  },
  { key: 'confirm', title: '入力内容のご確認', type: 'confirm' },
];

// 状態
const state = { answers: {}, idx: 0, order: [] };

const $root    = document.getElementById('q-root');
const $stepper = document.getElementById('stepper');
const $next    = document.getElementById('nextBtn');
const $back    = document.getElementById('backBtn');
const $submit  = document.getElementById('submitBtn');
const $done    = document.getElementById('done');

$next.addEventListener('click', onNext);
$back.addEventListener('click', onBack);
$submit.addEventListener('click', onSubmit);

init();

function init() { rebuildOrder(); render(); }
function curDef() { return STEPS.find(s => s.key === state.order[state.idx]); }

function rebuildOrder() {
  state.order = STEPS.map(s => s.key);
  if (state.idx >= state.order.length) state.idx = state.order.length - 1;
}

function render() {
  $done.hidden = true;
  $root.innerHTML = '';
  $submit.hidden = true;
  $next.hidden = false;

  const step = curDef();
  renderStepper();

  const h2 = document.createElement('h2');
  h2.textContent = step.title;
  $root.appendChild(h2);
  if (step.desc) {
    const p = document.createElement('p');
    p.className = 'desc'; p.textContent = step.desc;
    $root.appendChild(p);
  }

  $back.disabled = state.idx === 0;
  $next.disabled = true;

  if (step.type === 'select-one-v') renderSelectOneV(step);
  else if (step.type === 'select-one-grid') renderSelectOneGrid(step);
  else if (step.type === 'confirm') renderConfirm();
}

function renderStepper() {
  $stepper.textContent = `Step ${state.idx + 1} / ${state.order.length}`;
}

function renderSelectOneV(step) {
  const wrap = document.createElement('div'); wrap.className = 'vlist';
  step.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'vbtn'; btn.textContent = opt.label;
    btn.setAttribute('role','radio');
    btn.setAttribute('aria-checked', String(state.answers[step.key] === opt.value));
    btn.addEventListener('click', () => {
      select(step.key, opt.value);
      wrap.querySelectorAll('.vbtn').forEach(b => b.setAttribute('aria-checked','false'));
      btn.setAttribute('aria-checked','true');
      $next.disabled = false;
    });
    wrap.appendChild(btn);
  });
  $root.appendChild(wrap);
}

function renderSelectOneGrid(step) {
  const grid = document.createElement('div'); grid.className = 'grid';
  step.options.forEach(opt => {
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'option';
    card.setAttribute('role','radio');
    card.setAttribute('aria-checked', String(state.answers[step.key] === opt.value));

    const ph = document.createElement('div'); ph.className = 'thumb';
    ph.style.backgroundImage = `url("${opt.img}")`;

    const cap = document.createElement('div'); cap.className = 'label';
    cap.textContent = opt.label;

    card.appendChild(ph); card.appendChild(cap);
    card.addEventListener('click', () => {
      select(step.key, opt.value);
      grid.querySelectorAll('.option').forEach(el => el.setAttribute('aria-checked','false'));
      card.setAttribute('aria-checked','true');
      $next.disabled = false;
    });
    grid.appendChild(card);
  });
  $root.appendChild(grid);
}

function renderConfirm() {
  $next.hidden = true; $submit.hidden = false;

  const ul = document.createElement('ul');
  ul.style.margin = '10px 0 0'; ul.style.paddingLeft = '18px';

  const view = [
    ['希望内容', state.answers.desiredWork ?? '-'],
    ['築年数', state.answers.ageRange ?? '-'],
    ['階数', state.answers.floors ?? '-'],
    ['外壁材', state.answers.wallMaterial ?? '-'],
  ];

  for (const [k,v] of view) {
    const li = document.createElement('li'); li.textContent = `${k}: ${v}`;
    ul.appendChild(li);
  }
  $root.appendChild(ul);
}

function select(key, value) {
  state.answers[key] = value;
  // 以降の回答をクリア（戻る→再選択の不整合回避）
  const i = state.order.indexOf(key);
  state.order.slice(i + 1).forEach(k => delete state.answers[k]);
}

function onNext() {
  if ($next.disabled) return;
  if (state.idx < state.order.length - 1) {
    state.idx++; render();
  }
}

function onBack() {
  if (state.idx === 0) return;
  state.idx--;
  const key = state.order[state.idx];
  const i = state.order.indexOf(key);
  state.order.slice(i + 1).forEach(k => delete state.answers[k]);
  render();
}

async function onSubmit() {
  $submit.disabled = true;

  // /estimate に answers をそのままPOST（サーバは redirectUrl を返す）
  try {
    const res = await fetch('/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.answers),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.redirectUrl) {
      // 自動で LINE ログインへ（友だち追加→ユーザーID確定→プッシュ送信）
      window.location.href = json.redirectUrl;
      return;
    }
  } catch (e) {
    console.warn('estimate post error', e);
  }

  // フォールバック（万一 redirectUrl が無い場合）
  document.querySelector('.nav').classList.add('hidden');
  document.getElementById('q-root').classList.add('hidden');
  document.getElementById('stepper').classList.add('hidden');
  $done.hidden = false;
}
