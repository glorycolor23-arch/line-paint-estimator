// アンケートの最小ロジック。DOM 初期化失敗を避け、確実に描画する。
const $app = document.getElementById('app');

const state = {
  step: 0,
  answers: {
    kind: null,        // 外壁 / 屋根 / 外壁と屋根
    age: null,         // 築年数
    floors: null,      // 階数
    material: null     // 外壁材
  }
};

// 質問定義
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
    vertical: true  // 縦並び
  },
  {
    key: 'age',
    title: '築年数をお選びください',
    type: 'list',
    options: [
      '1〜5年','6〜10年','11〜15年','16〜20年','21〜25年','26〜30年','31年以上'
    ].map(v => ({ value: v, label: v }))
  },
  {
    key: 'floors',
    title: '何階建てですか？',
    type: 'list',
    options: [
      { value: '1階建て', label: '1階建て' },
      { value: '2階建て', label: '2階建て' },
      { value: '3階建て以上', label: '3階建て以上' }
    ]
  },
  {
    key: 'material',
    title: '外壁材を以下からお選びください',
    type: 'cards',
    options: [
      { value: 'サイディング',  title: 'サイディング',  sub: '板状外装材', img: '/public/img/siding.jpg' },
      { value: 'モルタル',      title: 'モルタル',      sub: '塗り壁',     img: '/public/img/mortar.jpg' },
      { value: 'ALC',          title: 'ALC',          sub: '軽量気泡コンクリート', img: '/public/img/alc.jpg' },
      { value: 'ガルバリウム',  title: 'ガルバリウム',  sub: '金属外装',   img: '/public/img/galva.jpg' },
      { value: '木',            title: '木',            sub: '木質系',     img: '/public/img/wood.jpg' },
      { value: 'RC',           title: 'RC',           sub: '鉄筋コンクリート', img: '/public/img/rc.jpg' },
      { value: 'その他',        title: 'その他',        sub: '該当なし',   img: '/public/img/other.jpg' },
      { value: 'わからない',    title: 'わからない',    sub: '不明',       img: '/public/img/unknown.jpg' }
    ]
  },
  {
    key: 'confirm',
    title: '入力内容のご確認',
    type: 'confirm'
  }
];

// 画像が無い場合でも必ず表示されるようにエラーハンドリング
function safeImg(src) {
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.onerror = () => { img.style.display = 'none'; };
  return img;
}

function render() {
  if (!$app) return;
  $app.innerHTML = ''; // クリア

  const step = state.step;
  const q = QUESTIONS[step];

  const card = document.createElement('div');
  card.className = 'card';

  const h2 = document.createElement('h2');
  h2.className = 'qtitle';
  h2.textContent = q.title;
  card.appendChild(h2);

  // 選択肢描画
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
        render(); // 再描画で選択状態に
      });
      wrap.appendChild(btn);
    });

    card.appendChild(wrap);
  }

  if (q.type === 'cards') {
    const wrap = document.createElement('div');
    wrap.className = 'choices';
    wrap.style.gridTemplateColumns = '1fr'; // スマホは縦並び

    q.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn';
      if (state.answers.material === opt.value) btn.classList.add('selected');

      const row = document.createElement('div');
      row.className = 'choice-card';

      // 画像（失敗時は非表示）
      row.appendChild(safeImg(opt.img));

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

  // ナビゲーション
  const nav = document.createElement('div');
  nav.className = 'nav-row';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn-outline';
  back.textContent = '戻る';
  back.disabled = step === 0;
  back.addEventListener('click', () => {
    state.step = Math.max(0, state.step - 1);
    render();
  });

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn btn-primary';
  next.textContent = (q.key === 'confirm') ? 'この内容で送信' : '次へ';

  // 「次へ」の活性制御
  next.disabled = (() => {
    if (q.key === 'confirm') return false;
    const v = state.answers[q.key];
    return !v; // 未選択なら無効
  })();

  next.addEventListener('click', async () => {
    if (q.key === 'confirm') {
      // 送信 → サーバ（/api/estimate）にPOST
      try {
        const res = await fetch('/api/estimate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.answers)
        });
        const json = await res.json().catch(() => ({}));
        // 送信完了メッセージ
        alert(json?.message || '送信しました。LINEをご確認ください。');
        // 完了後は最初に戻す
        state.step = 0;
        state.answers = { kind: null, age: null, floors: null, material: null };
        render();
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
  if (q.key !== 'confirm') {
    helper.textContent = '選択すると「次へ」ボタンが有効になります。';
  } else {
    helper.textContent = '内容に誤りがある場合は「戻る」で修正してください。';
  }

  card.appendChild(nav);
  card.appendChild(helper);

  $app.appendChild(card);
}

// 初期化（JSが確実に走るよう DOMContentLoaded を使う）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', render);
} else {
  render();
}
