// public/app.js
const IMG = (name) => `/img/${name}.png`;

// 設問
const STEPS = [
  {
    key: 'desiredWork',
    title: 'お見積もり希望の内容は？',
    type: 'select-one-v',
    options: [
      { value: '外壁塗装',       label: '外壁塗装' },
      { value: '屋根工事',       label: '屋根工事' },
      { value: '外壁塗装と屋根工事', label: '外壁塗装と屋根工事' },
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

// ステート
const state = {
  idx: 0,
  order: STEPS.map(s => s.key),
  answers: {}
};

// DOM
const $stepper = document.getElementById('stepper');
const $qRoot   = document.getElementById('q-root');
const $done    = document.getElementById('done');
const $next    = document.getElementById('nextBtn');
const $back    = document.getElementById('backBtn');
const $navBar  = document.getElementById('nav-bar');

$next.addEventListener('click', onNext);
$back.addEventListener('click', (e) => {
  e.preventDefault();
  onBack();
});

init();

// 初期化
function init(){ render(); }
function curDef(){ return STEPS.find(s => s.key === state.order[state.idx]); }

function render(){
  const def = curDef();
  if (!def) return;

  // ステッパー
  $stepper.innerHTML = `ステップ ${state.idx + 1} / ${state.order.length}`;

  // 確認画面
  if (def.type === 'confirm') {
    renderConfirm(def);
    return;
  }

  // 通常の質問
  let html = `<h2>${def.title}</h2>`;
  if (def.desc) html += `<p class="note">${def.desc}</p>`;

  if (def.type === 'select-one-v') {
    html += '<div class="btn-group-v">';
    def.options.forEach(opt => {
      const sel = (state.answers[def.key] === opt.value) ? ' selected' : '';
      html += `<button type="button" class="btn-choice${sel}" data-key="${def.key}" data-value="${opt.value}">${opt.label}</button>`;
    });
    html += '</div>';
  } else if (def.type === 'select-one-grid') {
    html += '<div class="grid-choice">';
    def.options.forEach(opt => {
      const sel = (state.answers[def.key] === opt.value) ? ' selected' : '';
      html += `
        <button type="button" class="grid-item${sel}" data-key="${def.key}" data-value="${opt.value}">
          <img src="${opt.img}" alt="${opt.label}" loading="lazy"/>
          <span>${opt.label}</span>
        </button>`;
    });
    html += '</div>';
  }

  $qRoot.innerHTML = html;
  $qRoot.hidden = false;
  $done.hidden = true;
  $navBar.style.display = 'flex';

  // 選択肢クリック
  $qRoot.querySelectorAll('[data-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.key;
      const v = btn.dataset.value;
      state.answers[k] = v;
      render();
    });
  });

  // 次へボタンの状態
  $next.disabled = !state.answers[def.key];
  $next.textContent = '次へ';
  $next.removeAttribute('data-action');

  // 戻るボタンの表示
  $back.style.display = (state.idx === 0) ? 'none' : 'inline-block';
}

function renderConfirm(def){
  let html = `<h2>${def.title}</h2>`;
  html += '<div class="summary">';
  
  state.order.slice(0, -1).forEach(key => {
    const step = STEPS.find(s => s.key === key);
    if (step && state.answers[key]) {
      html += `<div><strong>${step.title}</strong><br>${state.answers[key]}</div>`;
    }
  });
  
  html += '</div>';
  html += '<p class="note">上記の内容で概算見積もりを依頼します。よろしいですか？</p>';

  $qRoot.innerHTML = html;
  $qRoot.hidden = false;
  $done.hidden = true;
  $navBar.style.display = 'flex';

  // 次へボタンを「この内容で概算見積もりを依頼」に変更
  $next.disabled = false;
  $next.textContent = 'この内容で概算見積もりを依頼';
  $next.setAttribute('data-action', 'confirm-yes');

  // 戻るボタンを表示
  $back.style.display = 'inline-block';
}

function onNext(){
  if ($next.disabled) return;
  
  // 最終確認画面で「この内容で概算見積もりを依頼」ボタンが押された場合
  if ($next.hasAttribute('data-action') && $next.getAttribute('data-action') === 'confirm-yes') {
    handleConfirmYes();
    return;
  }
  
  if (state.idx < state.order.length - 1){
    state.idx++; render();
  }
}

function onBack(){
  if (state.idx === 0) return;
  state.idx--;
  const key = state.order[state.idx];
  const i = state.order.indexOf(key);
  state.order.slice(i + 1).forEach(k => delete state.answers[k]);
  render();
}

// ローディング画面を表示
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

// ローディング画面を非表示
function hideLoading() {
  const overlay = document.querySelector('.loading-overlay');
  if (overlay) overlay.remove();
}

// 確認「はい」：送信処理
async function handleConfirmYes(){
  try {
    // ボタンを無効化
    $next.disabled = true;
    $back.style.display = 'none';
    
    // ローディング画面を表示
    showLoading();

    const payload = { ...state.answers };

    // /estimate に送信
    const res = await fetch('/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    
    // ローディング画面を非表示
    hideLoading();

    if (data && data.error) {
      alert('送信に失敗しました。再度お試しください。');
      $next.disabled = false;
      $back.style.display = 'inline-block';
      return;
    }

    // 完了画面を表示（LINE友達登録への誘導）
    showDone();

  } catch (err) {
    hideLoading();
    console.error('送信エラー:', err);
    alert('送信に失敗しました。通信状態をご確認ください。');
    $next.disabled = false;
    $back.style.display = 'inline-block';
  }
}

function showDone() {
  $qRoot.hidden = true;
  $navBar.style.display = 'none';
  $stepper.innerHTML = '';
  $done.hidden = false;
}

