// ==== ローカル画像のみを参照（直リンク禁止） ====
const IMG = (name) => `/img/${name}.png`; // 画像は /img/*.png に統一

// ==== アンケート定義 ====
const STEPS = [
  {
    key: 'desiredWork',
    title: 'お見積もり希望の内容は？',
    type: 'select-one-v',
    options: [
      { value: '外壁',       label: '外壁' },
      { value: '屋根',       label: '屋根' },
      { value: '外壁と屋根', label: '外壁と屋根' },
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
      { value: '1階建て',   label: '1階建て' },
      { value: '2階建て',   label: '2階建て' },
      { value: '3階建て以上', label: '3階建て以上' },
    ],
  },
  {
    key: 'wallMaterial',
    title: '外壁材をお選びください',
    desc: '見た目が近いものを選んでください（画像はサンプルです）',
    type: 'select-one-grid',
    options: [
      { value:'サイディング',  label:'サイディング',  img: IMG('siding') },
      { value:'ガルバリウム',  label:'ガルバリウム',  img: IMG('galvalume') },
      { value:'モルタル',      label:'モルタル',      img: IMG('mortar') },
      { value:'ALC',          label:'ALC',            img: IMG('alc') },
      { value:'木',            label:'木',            img: IMG('wood') },
      { value:'RC',           label:'RC',             img: IMG('rc') },
      { value:'その他',        label:'その他',         img: IMG('other') },
      { value:'わからない',    label:'わからない',     img: IMG('unknown') },
    ],
  },
  { key: 'confirm', title: '入力内容のご確認', type: 'confirm' },
];

// ==== 状態管理 ====
const state = { answers: {}, idx: 0, order: STEPS.map(s => s.key) };

// ==== 要素参照 ====
const $root    = document.getElementById('q-root');
const $stepper = document.getElementById('stepper');
const $next    = document.getElementById('nextBtn');
const $back    = document.getElementById('backBtn');
const $done    = document.getElementById('done');
const $navBar  = document.getElementById('nav-bar');

$next.addEventListener('click', onNext);
$back.addEventListener('click', onBack);

init();

// ==== 初期化 ====
function init() {
  render();
}

// ==== 現在ステップ定義 ====
function curDef() { return STEPS.find(s => s.key === state.order[state.idx]); }

// ==== 共通描画 ====
function render() {
  $done.hidden = true;
  $root.innerHTML = '';
  $navBar.classList.remove('hidden');

  const step = curDef();
  renderStepper();

  const h2 = document.createElement('h2');
  h2.textContent = step.title;
  $root.appendChild(h2);
  if (step.desc) {
    const p = document.createElement('p'); p.className = 'desc'; p.textContent = step.desc;
    $root.appendChild(p);
  }

  $back.disabled = state.idx === 0;
  $next.disabled = true;

  if (step.type === 'select-one-v') {
    renderSelectOneV(step);
  } else if (step.type === 'select-one-grid') {
    renderSelectOneGrid(step);
  } else if (step.type === 'confirm') {
    renderConfirm(); // ← ここで「はい / いいえ」を描画
  }
}

function renderStepper() {
  $stepper.textContent = `Step ${state.idx + 1} / ${state.order.length}`;
}

function renderSelectOneV(step) {
  const wrap = document.createElement('div');
  wrap.className = 'vlist';

  step.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vbtn';
    btn.textContent = opt.label;
    btn.setAttribute('role', 'radio');
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
    card.type = 'button';
    card.className = 'option';
    card.setAttribute('role', 'radio');
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
  // 確認ステップでは共通ナビ（次へ/戻る）は表示しない
  $navBar.classList.add('hidden');

  // サマリー
  const list = [
    ['■見積もり希望内容', state.answers.desiredWork ?? '-'],
    ['■築年数',           state.answers.ageRange ?? '-'],
    ['■階数',             state.answers.floors ?? '-'],
    ['■外壁材',           state.answers.wallMaterial ?? '-'],
  ];
  const div = document.createElement('div');
  div.style.marginTop = '8px';
  div.innerHTML = list.map(([k,v]) => `${k}　${v}`).join('<br/>');
  $root.appendChild(div);

  // 「はい / いいえ」ボタン
  const actions = document.createElement('div');
  actions.className = 'nav';
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'btn';
  yes.textContent = 'はい';
  yes.addEventListener('click', onConfirmYes);

  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'btn btn-ghost';
  no.textContent = 'いいえ（最初からやり直す）';
  no.addEventListener('click', onConfirmNo);

  actions.appendChild(no);
  actions.appendChild(document.createElement('div')).className = 'spacer';
  actions.appendChild(yes);
  $root.appendChild(actions);
}

// ==== 値選択・移動 ====
function select(key, value) {
  state.answers[key] = value;
  // 以降の回答はクリア（戻る→再選択の不整合を回避）
  const i = state.order.indexOf(key);
  state.order.slice(i + 1).forEach(k => delete state.answers[k]);
}

function onNext() {
  if ($next.disabled) return;
  if (state.idx < state.order.length - 1) {
    state.idx++;
    render();
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

// ==== 確認：はい / いいえ ====
async function onConfirmYes() {
  try {
    // /estimate へ JSON 送信（サーバは redirectUrl を返す仕様）
    const payload = { ...state.answers };
    const res = await fetch('/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // レスポンスチェック
    const json = await res.json().catch(() => ({}));

    // 1) 正常：redirectUrl で LINE ログイン/友だち追加へ
    if (res.ok && json && json.redirectUrl) {
      window.location.href = json.redirectUrl;
      return;
    }

    // 2) フェイルセーフ：友だちURLに誘導（環境変数未設定などでもUXを止めない）
    window.location.href = 'https://lin.ee/XxmuVXt';
  } catch (e) {
    console.error('submit failed', e);
    // 3) ネットワーク例外時もフェイルセーフ
    window.location.href = 'https://lin.ee/XxmuVXt';
  }
}

function onConfirmNo() {
  // 全リセットして最初へ
  state.answers = {};
  state.idx = 0;
  render();
}

// 初期描画
render();
