// public/app.js  — フロント側アンケート一式（自動レンダリング）

(() => {
  // ---------- ユーティリティ ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };
  const yen = n => new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(n);

  // ---------- アンケート定義 ----------
  const MATERIALS = [
    { label: 'サイディング', img: '/img/material/siding.png' },
    { label: 'モルタル',     img: '/img/material/mortar.png' },
    { label: 'ALC',         img: '/img/material/alc.png' },
    { label: 'ガルバリウム', img: '/img/material/galvalume.png' },
    { label: '木',           img: '/img/material/wood.png' },
    { label: 'RC',           img: '/img/material/rc.png' },
    { label: 'その他',       img: '/img/material/other.png' },
    { label: 'わからない',   img: '/img/material/unknown.png' },
  ];

  const STEPS = [
    {
      id: 'scope',
      title: 'お見積もり希望の内容は何ですか？',
      type: 'choice',
      options: ['外壁', '屋根', '外壁と屋根'],
    },
    {
      id: 'age',
      title: '築年数をお選びください',
      type: 'choice',
      options: ['1〜5年', '6〜10年', '11〜15年', '16〜20年', '21〜25年', '26〜30年', '31年以上'],
    },
    {
      id: 'floors',
      title: '何階建てですか？',
      type: 'choice',
      options: ['1階建て', '2階建て', '3階建て以上'],
    },
    {
      id: 'material',
      title: '外壁材を以下からお選びください',
      type: 'imageChoice',
      options: MATERIALS,
    },
    {
      id: 'confirm',
      title: '以下の内容でお間違いないですか？',
      type: 'confirm',
    },
  ];

  // ---------- 状態 ----------
  const state = {
    stepIndex: 0,
    answers: {
      scope: null,
      age: null,
      floors: null,
      material: null,
    },
    result: null, // { amount, addFriendUrl, talkUrl, pendingId }
  };

  // ---------- ルート生成 ----------
  function ensureRoot() {
    let root = $('#app') || $('#root') || $('#survey-root');
    if (!root) {
      root = el('div', { id: 'app' });
      document.body.appendChild(root);
    }
    root.classList.add('lp-root');
    injectStyles();
    return root;
  }

  // 画面共通ヘッダ
  const Header = () =>
    el('div', { class: 'lp-header' }, [
      el('h1', { class: 'lp-h1' }, '外壁塗装の概算見積'),
      el('p', { class: 'lp-lead' }, '数ステップの回答で概算見積を算出。LINEで結果をお届けします。'),
    ]);

  function Progress() {
    const total = STEPS.length;
    const current = Math.min(state.stepIndex + 1, total);
    return el('div', { class: 'lp-progress' }, [
      el('div', { class: 'lp-progress-bar' }, [
        el('div', {
          class: 'lp-progress-fill',
          style: { width: `${(current / total) * 100}%` },
        }),
      ]),
      el('div', { class: 'lp-progress-text' }, `Step ${current} / ${total}`),
    ]);
  }

  // ---------- ステップ描画 ----------
  function renderStep(root) {
    root.innerHTML = '';
    root.appendChild(Header());
    root.appendChild(Progress());

    const step = STEPS[state.stepIndex];
    const card = el('div', { class: 'lp-card' });

    card.appendChild(el('h2', { class: 'lp-q' }, step.title));

    if (step.type === 'choice') {
      card.appendChild(renderChoice(step.id, step.options));
    }

    if (step.type === 'imageChoice') {
      card.appendChild(renderImageChoice(step.id, step.options));
    }

    if (step.type === 'confirm') {
      card.appendChild(renderConfirm());
    }

    // 戻る/次へ
    const nav = el('div', { class: 'lp-nav' });
    if (state.stepIndex > 0) {
      nav.appendChild(
        el('button', { class: 'lp-btn ghost', onclick: () => goto(state.stepIndex - 1) }, '戻る')
      );
    }
    if (step.type !== 'confirm') {
      nav.appendChild(
        el(
          'button',
          {
            class: 'lp-btn',
            onclick: () => goto(state.stepIndex + 1),
            disabled: !isStepAnswered(step.id),
          },
          '次へ'
        )
      );
    }
    card.appendChild(nav);

    root.appendChild(card);
  }

  function isStepAnswered(stepId) {
    if (stepId === 'confirm') return true;
    return !!state.answers[stepId];
  }

  function goto(nextIndex) {
    // 未回答の場合は進めない
    const cur = STEPS[state.stepIndex];
    if (cur && cur.id !== 'confirm' && !isStepAnswered(cur.id)) return;

    state.stepIndex = Math.max(0, Math.min(nextIndex, STEPS.length - 1));
    renderStep(ensureRoot());
  }

  // --- チョイス（テキストボタン） ---
  function renderChoice(stepId, options) {
    const wrap = el('div', { class: 'lp-grid three' });
    options.forEach(opt => {
      const active = state.answers[stepId] === opt;
      const btn = el(
        'button',
        {
          class: `lp-choice ${active ? 'active' : ''}`,
          onclick: () => {
            state.answers[stepId] = opt;
            renderStep(ensureRoot());
          },
        },
        opt
      );
      wrap.appendChild(btn);
    });
    return wrap;
  }

  // --- 画像チョイス（画像が無ければテキストに自動フォールバック） ---
  function renderImageChoice(stepId, options) {
    const wrap = el('div', { class: 'lp-grid four' });
    options.forEach(({ label, img }) => {
      const active = state.answers[stepId] === label;

      const btn = el(
        'button',
        {
          class: `lp-card-choice ${active ? 'active' : ''}`,
          onclick: () => {
            state.answers[stepId] = label;
            renderStep(ensureRoot());
          },
        },
        [
          el('div', { class: 'lp-card-thumb' }, [
            el('img', {
              src: img,
              alt: label,
              onerror: e => {
                // 画像が無い場合はテキストのみ表示
                e.target.replaceWith(el('div', { class: 'lp-thumb-fallback' }, label));
              },
            }),
          ]),
          el('div', { class: 'lp-card-label' }, label),
        ]
      );

      wrap.appendChild(btn);
    });
    return wrap;
  }

  // --- 確認画面 ---
  function renderConfirm() {
    const block = el('div', { class: 'lp-confirm' }, [
      el('ul', { class: 'lp-summary' }, [
        li('見積もり希望内容', state.answers.scope),
        li('築年数', state.answers.age),
        li('階数', state.answers.floors),
        li('外壁材', state.answers.material),
      ]),
    ]);

    const actions = el('div', { class: 'lp-actions' }, [
      el(
        'button',
        {
          class: 'lp-btn danger',
          onclick: () => {
            // リセットして最初から
            state.answers = { scope: null, age: null, floors: null, material: null };
            state.stepIndex = 0;
            renderStep(ensureRoot());
          },
        },
        'いいえ（最初からやり直す）'
      ),
      el(
        'button',
        {
          class: 'lp-btn',
          onclick: onSubmitAnswers,
        },
        'はい（送信する）'
      ),
    ]);

    block.appendChild(actions);
    return block;

    function li(label, value) {
      return el('li', {}, [el('span', { class: 'lp-summary-key' }, `■${label}`), '　', value]);
    }
  }

  // --- 送信（概算取得 & リンク受け取り） ---
  async function onSubmitAnswers() {
    try {
      const res = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.answers),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.ok) throw new Error('API error');

      state.result = data; // { amount, addFriendUrl, talkUrl, pendingId }

      // 完了画面へ
      renderResult();
    } catch (e) {
      console.error(e);
      alert('送信に失敗しました。時間をおいて再度お試しください。');
    }
  }

  // --- 完了画面（自動遷移なし） ---
  function renderResult() {
    const root = ensureRoot();
    root.innerHTML = '';
    root.appendChild(Header());

    const { amount, addFriendUrl, talkUrl } = state.result || {};

    const card = el('div', { class: 'lp-card center' }, [
      el('h2', { class: 'lp-q' }, '送信が完了しました'),
      el('p', { class: 'lp-msg' }, 'LINEのトークに概算のお見積もりをお送りします。'),
      el('div', { class: 'lp-quote' }, [
        el('span', { class: 'lp-quote-label' }, '概算見積額'),
        el('div', { class: 'lp-quote-value' }, amount != null ? yen(amount) : '-'),
      ]),
      el('div', { class: 'lp-result-actions' }, [
        el('a', { class: 'lp-btn wide', href: addFriendUrl, target: '_blank', rel: 'noopener' }, '友だち追加'),
        el('a', { class: 'lp-btn outline wide', href: talkUrl, target: '_blank', rel: 'noopener' }, 'LINEを開く'),
      ]),
      el('p', { class: 'lp-help' }, '※ 自動では開きません。上のボタンからLINEを起動してください。'),
    ]);

    root.appendChild(card);
  }

  // ---------- スタイル（最低限） ----------
  function injectStyles() {
    if ($('#lp-style')) return;
    const css = `
.lp-root { max-width: 760px; margin: 24px auto 64px; padding: 0 16px; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic UI","Meiryo",sans-serif; color:#111; }
.lp-header { margin-bottom: 8px; }
.lp-h1 { font-size: 22px; margin: 0 0 4px; }
.lp-lead { color:#666; margin:0 0 16px; }
.lp-progress { margin: 8px 0 16px; }
.lp-progress-bar { background:#eee; height:8px; border-radius:8px; overflow:hidden; }
.lp-progress-fill { background:#10b981; height:100%; width:0%; transition:width .25s; }
.lp-progress-text { font-size:12px; color:#666; margin-top:6px; }
.lp-card { background:#fff; border:1px solid #eee; border-radius:14px; padding:18px; box-shadow:0 2px 8px rgba(0,0,0,.04); }
.lp-card.center { text-align:center; }
.lp-q { font-size:18px; margin: 0 0 12px; }
.lp-grid { display:grid; gap:10px; }
.lp-grid.three { grid-template-columns: repeat(3, minmax(0,1fr)); }
.lp-grid.four  { grid-template-columns: repeat(4, minmax(0,1fr)); }
@media (max-width:640px) {
  .lp-grid.three { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .lp-grid.four  { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
.lp-choice { border:1px solid #ddd; background:#fff; padding:12px 8px; border-radius:10px; font-size:15px; }
.lp-choice.active, .lp-card-choice.active { outline: 2px solid #10b981; border-color:#10b981; }
.lp-card-choice { border:1px solid #ddd; background:#fff; border-radius:12px; text-align:center; padding:8px; }
.lp-card-thumb { height:84px; display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:8px; background:#fafafa; }
.lp-card-thumb img { max-width:100%; max-height:100%; object-fit:contain; }
.lp-thumb-fallback { font-size:14px; color:#444; }
.lp-card-label { margin-top:6px; font-size:14px; }
.lp-nav { display:flex; gap:8px; justify-content:flex-end; margin-top:14px; }
.lp-btn { appearance:none; border:none; background:#10b981; color:#fff; padding:10px 14px; border-radius:10px; font-size:14px; cursor:pointer; }
.lp-btn:disabled { opacity:.5; cursor:not-allowed; }
.lp-btn.ghost { background:#f5f5f5; color:#111; border:1px solid #e5e5e5; }
.lp-btn.outline { background:#fff; color:#10b981; border:1px solid #10b981; }
.lp-btn.wide { display:block; width:100%; text-align:center; }
.lp-btn.danger { background:#ef4444; }
.lp-confirm { margin-top:8px; }
.lp-summary { list-style:none; padding:0; margin:0 0 14px; }
.lp-summary li { margin:4px 0; }
.lp-summary-key { color:#666; }
.lp-msg { color:#444; margin:0 0 8px; }
.lp-quote { display:flex; align-items:flex-end; gap:12px; justify-content:center; margin:10px 0 16px; }
.lp-quote-label { color:#666; }
.lp-quote-value { font-weight:700; font-size:28px; }
.lp-result-actions { display:grid; gap:10px; grid-template-columns:1fr 1fr; margin: 8px 0 4px; }
.lp-help { color:#666; font-size:12px; margin-top:6px; }
    `.trim();
    document.head.appendChild(el('style', { id: 'lp-style' }, css));
  }

  // ---------- 起動 ----------
  document.addEventListener('DOMContentLoaded', () => {
    renderStep(ensureRoot());
  });
})();
