// 最小のアンケートロジック（他ファイルは変更しません）
const $app = document.getElementById('app');

// ここは必要に応じて差し替え可能：画像格納先（/public 下に img が無くてもOK。失敗時は画像を非表示）
const IMAGE_BASE = '/img'; // 例) /img/siding.jpg など。無ければ画像は自動で非表示になります。

// 既定の友だち追加URL（サーバから friendUrl/redirectUrl が返らない時のフォールバック）
const DEFAULT_FRIEND_URL = 'https://lin.ee/XxmuVXt';

// 外壁材ごとの画像パス（手元に画像が無い場合は読み込み失敗→自動で非表示）
const MATERIAL_IMAGES = {
  'サイディング':  `${IMAGE_BASE}/siding.jpg`,
  'モルタル':      `${IMAGE_BASE}/mortar.jpg`,
  'ALC':          `${IMAGE_BASE}/alc.jpg`,
  'ガルバリウム':  `${IMAGE_BASE}/galva.jpg`,
  '木':            `${IMAGE_BASE}/wood.jpg`,
  'RC':           `${IMAGE_BASE}/rc.jpg`,
  'その他':        `${IMAGE_BASE}/other.jpg`,
  'わからない':    `${IMAGE_BASE}/unknown.jpg`,
};

const state = {
  step: 0,
  answers: {
    kind: null,
    age: null,
    floors: null,
    material: null,
  },
};

// 質問定義（既存の流れは維持）
const QUESTIONS = [
  {
    key: 'kind',
    title: 'お見積もり希望の内容は何ですか？',
    type: 'list',
    options: [
      { value: '外壁', label: '外壁' },
      { value: '屋根', label: '屋根' },
      { value: '外壁と屋根', label: '外壁と屋根' },
    ],
    vertical: true,
  },
  {
    key: 'age',
    title: '築年数をお選びください',
    type: 'list',
    options: ['1〜5年','6〜10年','11〜15年','16〜20年','21〜25年','26〜30年','31年以上']
      .map(v => ({ value: v, label: v })),
  },
  {
    key: 'floors',
    title: '何階建てですか？',
    type: 'list',
    options: [
      { value: '1階建て', label: '1階建て' },
      { value: '2階建て', label: '2階建て' },
      { value: '3階建て以上', label: '3階建て以上' },
    ],
  },
  {
    key: 'material',
    title: '外壁材を以下からお選びください',
    type: 'cards',
    options: [
      { value: 'サイディング', title: 'サイディング', sub: '板状外装材' },
      { value: 'モルタル',     title: 'モルタル',     sub: '塗り壁' },
      { value: 'ALC',         title: 'ALC',         sub: '軽量気泡コンクリート' },
      { value: 'ガルバリウム', title: 'ガルバリウム', sub: '金属外装' },
      { value: '木',           title: '木',           sub: '木質系' },
      { value: 'RC',          title: 'RC',          sub: '鉄筋コンクリート' },
      { value: 'その他',       title: 'その他',       sub: '該当なし' },
      { value: 'わからない',   title: 'わからない',   sub: '不明' },
    ],
  },
  {
    key: 'confirm',
    title: '入力内容のご確認',
    type: 'confirm',
  },
];

// 画像の安全読み込み（失敗したら非表示）
function safeImg(src) {
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.onerror = () => { img.style.display = 'none'; };
  return img;
}

// 指定ステップ以降の回答をリセット（←「戻る」で直前の選択をクリアしてほしい要件）
function clearAnswersFrom(stepIndexInclusive) {
  const keys = QUESTIONS.slice(stepIndexInclusive).map(q => q.key);
  keys.forEach(k => {
    if (k in state.answers) state.answers[k] = null;
  });
}

function render() {
  if (!$app) return;
  $app.innerHTML = '';

  const step = state.step;
  const q = QUESTIONS[step];

  const card = document.createElement('div');
  card.className = 'card';

  const h2 = document.createElement('h2');
  h2.className = 'qtitle';
  h2.textContent = q.title;
  card.appendChild(h2);

  if (q.type === 'list') {
    const wrap = document.createElement('div');
    wrap.className = 'choices';
    wrap.style.gridTemplateColumns = q.vertical ? '1fr' : '1fr 1fr';

    q.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn';
      btn.textContent = opt.label;
      if (state.answers[q.key] === opt.value) btn.classList.add('selected');
      btn.addEventListener('click', () => {
        state.answers[q.key] = opt.value;
        render();
      });
      wrap.appendChild(btn);
    });

    card.appendChild(wrap);
  }

  if (q.type === 'cards') {
    const wrap = document.createElement('div');
    wrap.className = 'choices';
    wrap.style.gridTemplateColumns = '1fr'; // スマホ縦並び

    q.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn';
      if (state.answers.material === opt.value) btn.classList.add('selected');

      const row = document.createElement('div');
      row.className = 'choice-card';

      // 画像（存在しない/読み込み失敗でもテキストは必ず見える）
      const imgSrc = MATERIAL_IMAGES[opt.value];
      if (imgSrc) row.appendChild(safeImg(imgSrc));

      const text = document.createElement('div');
      const t = document.createElement('div');
      t.className = 'choice-title';
      t.textContent = opt.title;
      const s = document.createElement('div');
      s.className = 'choice-sub';
      s.textContent = opt.sub || '';
      text.appendChild(t);
      text.appendChild(s);

      row.appendChild(text);
      btn.appendChild(row);

      btn.addEventListener('click', () => {
        state.answers.material = opt.value;
        render();
      });

      wrap.appendChild(btn);
    });

    card.appendChild(wrap);
  }

  if (q.type === 'confirm') {
    const pre = document.createElement('div');
    pre.className = 'helper';
    pre.innerHTML = [
      `■見積もり希望内容　${state.answers.kind || '-'}`,
      `■築年数　　　　　${state.answers.age || '-'}`,
      `■階数　　　　　　${state.answers.floors || '-'}`,
      `■外壁材　　　　　${state.answers.material || '-'}`,
    ].join('<br/>');
    card.appendChild(pre);
  }

  // ナビ
  const nav = document.createElement('div');
  nav.className = 'nav-row';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn-outline';
  back.textContent = '戻る';
  back.disabled = step === 0;
  back.addEventListener('click', () => {
    // 一つ戻り、そのステップ以降の回答をクリア
    const to = Math.max(0, state.step - 1);
    clearAnswersFrom(to);     // ← ここが「戻るでアクティブが残る」対策
    state.step = to;
    render();
  });

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn btn-primary';
  next.textContent = (q.key === 'confirm') ? 'この内容で送信' : '次へ';

  // 次へ活性
  next.disabled = (() => {
    if (q.key === 'confirm') return false;
    const v = state.answers[q.key];
    return !v;
  })();

  next.addEventListener('click', async () => {
    if (q.key === 'confirm') {
      // サーバに送信 → 返却に redirectUrl / friendUrl があれば優先遷移、
      // 無ければ DEFAULT_FRIEND_URL へ（友だち追加 or 既に追加済みならトークを開く）
      try {
        const res = await fetch('/api/estimate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.answers),
        });
        const json = await res.json().catch(() => ({}));

        const jump =
          json?.redirectUrl ||
          json?.friendUrl ||
          DEFAULT_FRIEND_URL;

        // 自動で LINE 側へ遷移（「送信しました…」の中間画面は出しません）
        window.location.href = jump;
      } catch (e) {
        alert('送信に失敗しました。通信状況をご確認の上、時間を置いて再度お試しください。');
      }
      return;
    }

    state.step = Math.min(QUESTIONS.length - 1, step + 1);
    render();
  });

  nav.appendChild(back);
  nav.appendChild(next);

  const helper = document.createElement('div');
  helper.className = 'helper';
  helper.textContent = (q.key !== 'confirm')
    ? '選択すると「次へ」ボタンが有効になります。'
    : '内容に誤りがある場合は「戻る」で修正してください。';

  card.appendChild(nav);
  card.appendChild(helper);

  $app.appendChild(card);
}

// 初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', render);
} else {
  render();
}
