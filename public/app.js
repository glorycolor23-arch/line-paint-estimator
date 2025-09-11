/* 汎用アンケート進行スクリプト（name に依存しない） */

(() => {
  const steps = Array.from(document.querySelectorAll(".step"));
  const progressBar = document.getElementById("progressBar");

  // 収集データ（ラジオは name をキーに自動保存）
  const answers = {};

  let current = 0;

  // -------------------------------
  // 表示・UI更新
  // -------------------------------
  function showStep(index) {
    current = Math.max(0, Math.min(index, steps.length - 1));
    steps.forEach((s, i) => {
      s.hidden = i !== current;
    });
    updateProgress();
    updateNextButtonState();
    if (steps[current].dataset.step === "5") {
      renderSummary();
    }
  }

  function updateProgress() {
    if (!progressBar) return;
    const ratio = ((current + 1) / steps.length) * 100;
    progressBar.style.width = `${ratio}%`;
  }

  function updateNextButtonState() {
    const stepEl = steps[current];
    const nextBtn = stepEl.querySelector("[data-next]");
    if (!nextBtn) return;

    nextBtn.disabled = !isStepValid(stepEl);
  }

  function isStepValid(stepEl) {
    // 1) ラジオがある場合は 1 つ以上 checked でOK
    const radios = stepEl.querySelectorAll('input[type="radio"]');
    if (radios.length > 0) {
      return !!stepEl.querySelector('input[type="radio"]:checked');
    }

    // 2) 必須入力がある場合は全て埋まっているか
    const requiredInputs = stepEl.querySelectorAll("[required]");
    for (const el of requiredInputs) {
      if (!String(el.value || "").trim()) return false;
    }

    // 3) 何もなければ通す
    return true;
  }

  // -------------------------------
  // 回答収集（次へを押したタイミング）
  // -------------------------------
  function collectAnswersFrom(stepEl) {
    // ラジオ：checked のものを name をキーに保存
    const radios = stepEl.querySelectorAll('input[type="radio"]');
    if (radios.length > 0) {
      const checked = stepEl.querySelector('input[type="radio"]:checked');
      if (checked) {
        const { name, value } = checked;
        if (name) answers[name] = value;
      }
    }
    // 必須テキストなどがあれば保存（name があるもののみ）
    const namedInputs = stepEl.querySelectorAll("input[name], textarea[name], select[name]");
    for (const el of namedInputs) {
      if (el.type === "radio") continue; // ラジオは上で処理済み
      if (el.required && !String(el.value || "").trim()) continue;
      if (el.name) answers[el.name] = el.value;
    }
  }

  function renderSummary() {
    const box = document.getElementById("summary");
    if (!box) return;
    const rows = Object.entries(answers).map(
      ([k, v]) =>
        `<div class="summary__row"><div class="summary__key">${escapeHtml(
          k
        )}</div><div class="summary__val">${escapeHtml(v)}</div></div>`
    );
    box.innerHTML = rows.join("") || `<p>選択内容がありません。</p>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  // -------------------------------
  // イベント
  // -------------------------------
  // ステップ内の選択が変わったら「次へ」活性化を再評価
  document.addEventListener("change", (e) => {
    const stepEl = e.target.closest(".step");
    if (!stepEl) return;
    // ラベルクリック → ラジオ change は発火するためこのままでOK
    if (stepEl === steps[current]) {
      updateNextButtonState();
    }
  });

  // 次へ
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-next]");
    if (!btn) return;

    const stepEl = steps[current];
    if (!isStepValid(stepEl)) return;

    collectAnswersFrom(stepEl);
    showStep(current + 1);
  });

  // 戻る
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-prev]");
    if (!btn) return;
    showStep(current - 1);
  });

  // 送信（あなたの既存のサーバAPIに合わせて必要に応じて変更）
  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      submitBtn.disabled = true;

      try {
        // ここはあなたの既存APIに合わせてください
        // 例: /estimate へ POST（body: answers）
        const res = await fetch("/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(answers),
        });

        const data = await res.json().catch(() => ({}));

        // 完了画面へ
        const resultText = document.getElementById("resultText");
        const resultActions = document.getElementById("resultActions");

        if (res.ok) {
          resultText.textContent =
            data.message ||
            "送信が完了しました。LINEのトークに結果を送信しました。アプリをご確認ください。";
          // 必要があれば LINE 起動ボタンなどを追加
          resultActions.innerHTML =
            `<a class="btn btn-line" href="https://lin.ee/XxmuVXt" target="_blank" rel="noopener">LINEを開く</a>`;
        } else {
          resultText.textContent =
            data.error || "送信に失敗しました。時間をおいて再度お試しください。";
          resultActions.innerHTML = "";
        }

        showStep(current + 1); // 完了セクションへ
      } catch (err) {
        const resultText = document.getElementById("resultText");
        if (resultText) {
          resultText.textContent = "ネットワークエラーが発生しました。再度お試しください。";
        }
        showStep(current + 1);
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // やり直し
  const restartBtn = document.getElementById("restartBtn");
  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      // 初期化
      for (const s of steps) {
        const inputs = s.querySelectorAll("input, textarea, select");
        for (const el of inputs) {
          if (el.type === "radio" || el.type === "checkbox") el.checked = false;
          else el.value = "";
        }
      }
      Object.keys(answers).forEach((k) => delete answers[k]);
      showStep(0);
    });
  }

  // 初期表示
  showStep(0);
})();
