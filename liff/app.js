/* global liff, window, document, fetch */

const env = window.__LIFF_ENV__ || {};
const LIFF_ID = env.LIFF_ID || "";
const FRIEND_ADD_URL = env.FRIEND_ADD_URL || "";

// ----- 進捗制御 -----
const steps = Array.from(document.querySelectorAll(".step"));
const bar = document.getElementById("bar");
let current = 0;

function showStep(idx) {
  steps.forEach((el, i) => el.hidden = i !== idx);
  current = idx;
  const percent = Math.max(10, Math.round(((idx + 1) / steps.length) * 100));
  bar.style.width = `${percent}%`;
}

function next() { if (current < steps.length - 1) showStep(current + 1); }
function prev() { if (current > 0) showStep(current - 1); }

// ----- 入力要素 -----
const $ = (q) => document.querySelector(q);
const nameEl = $("#name");
const zipEl = $("#zip");
const addr1El = $("#addr1");
const addr2El = $("#addr2");
const previewEl = $("#preview");
const thanksEl = $("#thanks");
const backToChat = $("#backToChat");

// 郵便番号 → 住所自動補完
async function autoFillAddress() {
  const raw = (zipEl.value || "").replace(/[^\d]/g, "");
  if (raw.length !== 7) return;
  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${raw}`);
    const json = await res.json();
    if (json?.results?.length) {
      const r = json.results[0];
      addr1El.value = `${r.address1}${r.address2}${r.address3}`;
    }
  } catch (e) {
    // noop
  }
}

zipEl.addEventListener("change", autoFillAddress);
zipEl.addEventListener("blur", autoFillAddress);

// 前後ボタン
document.querySelectorAll(".next").forEach((b) => b.addEventListener("click", next));
document.querySelectorAll(".prev").forEach((b) => b.addEventListener("click", prev));

// プレビュー
function updatePreview() {
  const rows = [
    ["お名前", nameEl.value || ""],
    ["郵便番号", zipEl.value || ""],
    ["住所", addr1El.value || ""],
    ["建物名・部屋番号など", addr2El.value || "なし"]
  ];
  previewEl.innerHTML = rows.map(([k, v]) =>
    `<div class="row"><div class="label">${k}</div><div>${(v || "").replace(/\n/g,"<br>")}</div></div>`
  ).join("");
}
steps.forEach((s) => {
  s.addEventListener("click", (ev) => {
    if (ev.target.classList.contains("next")) updatePreview();
  });
});

// 送信
$("#submit").addEventListener("click", async () => {
  try {
    // LIFF 初期化済みでユーザーIDを取得
    const context = liff.getContext();
    const profile = await liff.getProfile().catch(() => null);

    const payload = {
      lineUserId: context?.userId || "",
      displayName: profile?.displayName || "",
      name: nameEl.value?.trim() || "",
      zip: zipEl.value?.trim() || "",
      address1: addr1El.value?.trim() || "",
      address2: addr2El.value?.trim() || ""
    };

    // サーバへ（メール送信・スプレッドシート登録はサーバ側で完了時のみ）
    const resp = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await resp.json();
    if (!json?.ok) throw new Error("submit failed");

    // ユーザーのトークに要約を送る（QA中は通知を増やさないよう簡潔な1通）
    await liff.sendMessages([
      {
        type: "text",
        text:
          "見積り依頼を受け付けました。\n" +
          `お名前：${payload.name}\n` +
          `郵便番号：${payload.zip}\n` +
          `住所：${payload.address1} ${payload.address2 || ""}\n` +
          "1〜2営業日程度で詳細なお見積りをお送りします。"
      }
    ]);

    $("#form").hidden = true;
    thanksEl.hidden = false;
    updatePreview();
  } catch (e) {
    alert("送信に失敗しました。時間をおいてお試しください。");
  }
});

// 戻るリンク
backToChat.addEventListener("click", (e) => {
  e.preventDefault();
  if (FRIEND_ADD_URL) location.href = FRIEND_ADD_URL;
  else liff.closeWindow();
});

// ----- LIFF 初期化 -----
async function main() {
  if (!LIFF_ID) {
    alert("LIFF_ID が設定されていません。");
    return;
  }
  await liff.init({ liffId: LIFF_ID });
  showStep(0);
}
main();
