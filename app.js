const el = (sel) => document.querySelector(sel);
const stepEl = el('#step');

let state = {
  desiredWork: null,
  ageRange: null,
  floors: null,
  wallMaterial: null,
  leadId: null,
  amount: null,
  addFriendUrl: null,
  liffDeepLink: null
};

// 画像付き候補（ダミー画像URLは適宜差し替え）
const WALLS = [
  { key: "サイディング", img: "https://picsum.photos/seed/sai/200/200" },
  { key: "モルタル", img: "https://picsum.photos/seed/mor/200/200" },
  { key: "ALC", img: "https://picsum.photos/seed/alc/200/200" },
  { key: "ガルバリウム", img: "https://picsum.photos/seed/gal/200/200" },
  { key: "木", img: "https://picsum.photos/seed/wood/200/200" },
  { key: "RC", img: "https://picsum.photos/seed/rc/200/200" },
  { key: "その他", img: "https://picsum.photos/seed/other/200/200" },
  { key: "わからない", img: "https://picsum.photos/seed/unk/200/200" }
];

function render() {
  if (!state.desiredWork) return renderDesired();
  if (!state.ageRange) return renderAge();
  if (!state.floors) return renderFloors();
  if (!state.wallMaterial) return renderWalls();
  if (!state.leadId) return renderConfirm();
  return renderAfterEstimate();
}

function renderDesired() {
  stepEl.innerHTML = `
    <div class="badge">質問 1/4</div>
    <h3>お見積もり希望の内容は何ですか？</h3>
    <div class="grid">
      ${["外壁","屋根","外壁と屋根"].map(k => `
        <button class="btn" data-k="${k}">${k}</button>
      `).join('')}
    </div>
  `;
  stepEl.querySelectorAll('.btn').forEach(b => b.onclick = () => { state.desiredWork = b.dataset.k; render(); });
}

function renderAge() {
  const ages = ["1〜5年","6〜10年","11〜15年","16〜20年","21〜25年","26〜30年","31年以上"];
  stepEl.innerHTML = `
    <div class="badge">質問 2/4</div>
    <h3>築年数をお選びください</h3>
    <div class="grid">${ages.map(k => `<button class="btn" data-k="${k}">${k}</button>`).join('')}</div>
    <button class="btn outline" id="back">戻る</button>
  `;
  stepEl.querySelectorAll('.btn[data-k]').forEach(b => b.onclick = () => { state.ageRange = b.dataset.k; render(); });
  el('#back').onclick = () => { state.desiredWork = null; render(); };
}

function renderFloors() {
  const floors = ["1階建て","2階建て","3階建て以上"];
  stepEl.innerHTML = `
    <div class="badge">質問 3/4</div>
    <h3>何階建てですか？</h3>
    <div class="grid">${floors.map(k => `<button class="btn" data-k="${k}">${k}</button>`).join('')}</div>
    <button class="btn outline" id="back">戻る</button>
  `;
  stepEl.querySelectorAll('.btn[data-k]').forEach(b => b.onclick = () => { state.floors = b.dataset.k; render(); });
  el('#back').onclick = () => { state.ageRange = null; render(); };
}

function renderWalls() {
  stepEl.innerHTML = `
    <div class="badge">質問 4/4</div>
    <h3>外壁材を以下からお選びください</h3>
    <div class="grid">
      ${WALLS.map(w => `
        <div class="choice" data-k="${w.key}">
          <img src="${w.img}" alt="${w.key}" />
          <span>${w.key}</span>
        </div>
      `).join('')}
    </div>
    <button class="btn outline" id="back">戻る</button>
  `;
  stepEl.querySelectorAll('.choice').forEach(c => c.onclick = () => { state.wallMaterial = c.dataset.k; render(); });
  el('#back').onclick = () => { state.floors = null; render(); };
}

function renderConfirm() {
  stepEl.innerHTML = `
    <h3>入力内容のご確認</h3>
    <div class="summary">
      <div>■見積もり希望内容：<b>${state.desiredWork}</b></div>
      <div>■築年数：<b>${state.ageRange}</b></div>
      <div>■階数：<b>${state.floors}</b></div>
      <div>■外壁材：<b>${state.wallMaterial}</b></div>
    </div>
    <div class="grid">
      <button class="btn" id="yes">はい</button>
      <button class="btn outline" id="no">いいえ（最初からやり直す）</button>
    </div>
  `;
  el('#no').onclick = () => { state = { desiredWork: null, ageRange: null, floors: null, wallMaterial: null, leadId: null }; render(); };
  el('#yes').onclick = async () => {
    const res = await fetch('/api/estimate', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        desiredWork: state.desiredWork,
        ageRange: state.ageRange,
        floors: state.floors,
        wallMaterial: state.wallMaterial
      })
    });
    const data = await res.json();
    if (data.error) return alert('送信に失敗しました。');
    state.leadId = data.leadId;
    state.amount = data.amount;
    state.addFriendUrl = data.addFriendUrl;
    state.liffDeepLink = data.liffDeepLink;
    render();
  };
}

function renderAfterEstimate() {
  stepEl.innerHTML = `
    <div class="center">
      <h3>LINEで見積額をご案内</h3>
      <p>「お見積もり額は、こちらのLINEからご確認ください。」</p>
      <a class="btn primary" href="${state.addFriendUrl}" target="_blank" rel="noopener">LINEの友だち登録</a>
      <p class="note">友だち登録のあと、下のボタンをタップしてください。</p>
      <a class="btn" href="${state.liffDeepLink}">LINEで見積額を受け取る</a>
      <div class="summary">
        <div class="note">※ 概算金額は回答内容（希望内容／築年数／階数／外壁材）から自動計算します。</div>
      </div>
    </div>
  `;
}

render();