/* global liff, window, document, fetch */
(() => {
  const state = {
    userId: null,
    name: '',
    phone: '',
    postal: '',
    address1: '',
    address2: '',
    lat: '',
    lng: '',
    images: [],         // {label, name, mime, dataBase64}
    roughEstimate: '',  // チャットでの概算金額（任意）
    selectedSummary: '' // チャット回答のまとめ（任意）
  };

  // 進捗
  const steps = Array.from(document.querySelectorAll('.step'));
  let cur = 0;
  const bar = document.getElementById('bar');

  function show(i) {
    cur = i;
    steps.forEach((s, idx) => s.classList.toggle('active', idx === i));
    bar.style.width = ( (i+1) / steps.length * 100 ) + '%';
  }

  // 初期化（LIFF）
  async function init() {
    const LIFF_ID = window.__LIFF_ID__;
    if (!LIFF_ID) {
      alert('LIFF_IDが未設定です。');
      return;
    }
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) liff.login();
    const prof = await liff.getProfile();
    state.userId = prof.userId;
    show(0);
  }

  // 郵便番号→住所自動
  async function fillAddress() {
    const z = document.getElementById('postal').value.replace(/[^0-9]/g,'');
    if (z.length < 7) { alert('7桁の郵便番号を入力してください'); return; }
    try {
      const r = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${z}`);
      const j = await r.json();
      if (j && j.results && j.results[0]) {
        const x = j.results[0];
        document.getElementById('address1').value = `${x.address1}${x.address2}${x.address3}`;
      } else {
        alert('住所が見つかりませんでした');
      }
    } catch {
      alert('住所検索に失敗しました');
    }
  }

  // 画像→base64
  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result.split(',')[1]); // data:*/*;base64,xxxx → 後半のみ
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  function bindUploaders() {
    document.querySelectorAll('.uploader input[type=file]').forEach(input => {
      input.addEventListener('change', async () => {
        const preview = input.parentElement.querySelector('.preview');
        preview.innerHTML = '';
        const label = input.dataset.label || 'photo';
        const files = Array.from(input.files || []);
        for (const f of files) {
          const b64 = await readAsBase64(f);
          state.images.push({ label, name: f.name, mime: f.type, dataBase64: b64 });
          const img = document.createElement('img');
          img.src = URL.createObjectURL(f);
          preview.appendChild(img);
        }
      });
    });
  }

  function gather(i) {
    if (i===0) state.name = document.getElementById('name').value.trim();
    if (i===1) state.phone = document.getElementById('phone').value.trim();
    if (i===2) state.postal = document.getElementById('postal').value.trim();
    if (i===3) {
      state.address1 = document.getElementById('address1').value.trim();
      state.address2 = document.getElementById('address2').value.trim();
    }
  }

  function renderConfirm() {
    const el = document.getElementById('confirm');
    el.innerHTML = `
      <p><strong>お名前：</strong>${state.name}</p>
      <p><strong>電話：</strong>${state.phone}</p>
      <p><strong>郵便番号：</strong>${state.postal}</p>
      <p><strong>住所：</strong>${state.address1} ${state.address2}</p>
      <p><strong>写真：</strong>${state.images.length}枚</p>
    `;
  }

  async function submit() {
    try {
      const resp = await fetch('/api/detail-estimate', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(state)
      });
      const j = await resp.json();
      if (j && j.ok) {
        document.getElementById('result').textContent = '送信しました。1〜3営業日以内にお見積書をLINEで返信いたします。';
        try {
          await liff.sendMessages([{ type:'text', text:'詳細見積もりの送信が完了しました。' }]);
        } catch {}
        setTimeout(() => { if (liff.isInClient()) liff.closeWindow(); }, 1500);
      } else {
        alert('送信に失敗しました。時間をおいて再度お試しください。');
      }
    } catch (e) {
      alert('送信に失敗しました。通信環境をご確認ください。');
    }
  }

  // ====== イベント ======
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.classList.contains('next')) {
      gather(cur);
      if (cur===2 && t.id==='btn-zip') {
        fillAddress();
      } else {
        show(Math.min(cur+1, steps.length-1));
        if (cur===4) renderConfirm();
      }
    }
    if (t.classList.contains('back')) {
      show(Math.max(cur-1, 0));
    }
    if (t.id==='btn-submit') submit();
  });

  document.addEventListener('DOMContentLoaded', () => {
    bindUploaders();
    init();
  });
})();
