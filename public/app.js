// public/app.js
(() => {
  // 友だち追加URL（index.html などで window.LINE_ADD_FRIEND_URL を上書き可能）
  const LINE_ADD_FRIEND_URL =
    window.LINE_ADD_FRIEND_URL || 'https://line.me/R/ti/p/@YOUR_BOT_ID'; // ←@ を含める

  // マウント先（#step があれば優先、なければ #app）
  const root =
    document.getElementById('step') ||
    document.getElementById('app') ||
    document.body;

  // ステップデータ
  const state = {
    desire: null,
    age: null,
    floors: null,
    material: null,
    leadId: null,
  };

  const QUESTIONS = [
    {
      key: 'desire',
      title: 'お見積もり希望の内容は何ですか？',
      options: ['外壁', '屋根', '外壁と屋根'],
    },
    {
      key: 'age',
      title: '築年数をお選びください',
      options: ['1〜5年', '6〜10年', '11〜15年', '16〜20年', '21〜25年', '26〜30年', '31年以上'],
    },
    {
      key: 'floors',
      title: '何階建てですか？',
      options: ['1階建て', '2階建て', '3階建て以上'],
    },
    {
      key: 'material',
      title: '外壁材を以下からお選びください',
      options: ['サイディング', 'モルタル', 'ALC', 'ガルバリウム', '木', 'RC', 'その他', 'わからない'],
      // 画像付きUIにしたい場合はここに imageMap を追加する
    },
  ];

  let stepIndex = 0;

  // 共通レンダラ
  function render(html) {
    root.innerHTML = `
      <div class="container">
        <div class="card">
          ${html}
        </div>
      </div>
    `;
    // スクロール先頭へ
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ボタン群
  function buttons(items) {
    return `
      <div class="btns">
        ${items
          .map(
            (it) =>
              `<button class="btn" data-val="${escapeAttr(it)}">${escapeHtml(it)}</button>`
          )
          .join('')}
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }

  // ステップ描画
  function renderStep() {
    if (stepIndex < QUESTIONS.length) {
      const q = QUESTIONS[stepIndex];
      render(`
        <h1>外壁塗装見積もり</h1>
        <p class="q">${escapeHtml(q.title)}</p>
        ${buttons(q.options)}
      `);
      bindOptionClick(q.key);
      return;
    }
    renderConfirm();
  }

  function bindOptionClick(key) {
    root.querySelectorAll('button.btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state[key] = btn.dataset.val;
        stepIndex += 1;
        renderStep();
      });
    });
  }

  // 確認画面
  function renderConfirm() {
    render(`
      <h1>入力内容のご確認</h1>
      <div class="summary">
        <p>■見積もり希望内容：${escapeHtml(state.desire)}</p>
        <p>■築年数：${escapeHtml(state.age)}</p>
        <p>■階数：${escap
