/* =========================
 * app.js (full replacement)
 * ========================= */

const PLACEHOLDER_IMG = 'https://tcd-theme.com/wp-content/uploads/2025/06/placehold-jp.jpg';

const QUESTIONS = [
  {
    id: 'q1_floors',
    title: '建物の階数は？',
    description: '工事対象建物の階数を選択してください',
    options: ['1階建て', '2階建て', '3階建て', '4階建て以上'],
    hasImage: false
  },
  {
    id: 'q2_rooms',
    title: '間取りは？',
    description: '建物の間取りを選択してください',
    options: ['1K・1DK', '1LDK・2K・2DK', '2LDK・3K・3DK', '3LDK・4K・4DK', '4LDK以上'],
    hasImage: false
  },
  {
    id: 'q3_age',
    title: '築年数は？',
    description: '建物の築年数を選択してください',
    options: ['5年未満', '5-10年', '11-15年', '16-20年', '21年以上'],
    hasImage: false
  },
  {
    id: 'q4_work_type',
    title: '希望する工事内容は？',
    description: '実施したい工事内容を選択してください',
    // 画像付きボタン（プレースホルダー）
    options: [
      { value: '外壁塗装のみ', label: '外壁塗装のみ', description: '', image: PLACEHOLDER_IMG },
      { value: '屋根塗装のみ', label: '屋根塗装のみ', description: '', image: PLACEHOLDER_IMG },
      { value: '外壁・屋根塗装', label: '外壁・屋根塗装', description: '', image: PLACEHOLDER_IMG },
      { value: '外壁・屋根・付帯部塗装', label: '外壁・屋根・付帯部塗装', description: '', image: PLACEHOLDER_IMG }
    ],
    hasImage: true
  },
  // q5, q6 は削除（外壁・屋根の面積）
  {
    id: 'q7_wall_material',
    title: '外壁の種類は？',
    description: '現在の外壁材を選択してください',
    // 画像は一旦プレースホルダーに統一
    options: [
      { value: 'モルタル', label: 'モルタル', description: 'セメントと砂を混ぜた塗り壁', image: PLACEHOLDER_IMG },
      { value: 'サイディング', label: 'サイディング', description: 'パネル状の外壁材', image: PLACEHOLDER_IMG },
      { value: 'タイル', label: 'タイル', description: '焼き物の外壁材', image: PLACEHOLDER_IMG },
      { value: 'ALC', label: 'ALC', description: '軽量気泡コンクリート', image: PLACEHOLDER_IMG }
    ],
    hasImage: true,
    condition: (answers) =>
      ['外壁塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(answers.q4_work_type)
  },
  {
    id: 'q8_roof_material',
    title: '屋根の種類は？',
    description: '現在の屋根材を選択してください',
    // 画像は一旦プレースホルダーに統一
    options: [
      { value: '瓦', label: '瓦', description: '粘土を焼いた伝統的な屋根材', image: PLACEHOLDER_IMG },
      { value: 'スレート', label: 'スレート', description: 'セメント系の薄い板状屋根材', image: PLACEHOLDER_IMG },
      { value: 'ガルバリウム', label: 'ガルバリウム', description: '金属系の軽量屋根材', image: PLACEHOLDER_IMG },
      { value: 'トタン', label: 'トタン', description: '亜鉛メッキ鋼板の屋根材', image: PLACEHOLDER_IMG }
    ],
    hasImage: true,
    condition: (answers) =>
      ['屋根塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(answers.q4_work_type)
  },
  // q9, q10 は削除（外壁/屋根の状態）
  {
    id: 'q11_paint_grade',
    title: '塗料のグレードは？',
    description: '希望する塗料のグレードを選択してください',
    // 画像付きボタン（プレースホルダー）
    options: [
      { value: 'スタンダード', label: 'スタンダード', description: 'アクリル・ウレタン系（耐用年数5-8年）', image: PLACEHOLDER_IMG },
      { value: 'ハイグレード', label: 'ハイグレード', description: 'シリコン系（耐用年数10-12年）', image: PLACEHOLDER_IMG },
      { value: 'プレミアム', label: 'プレミアム', description: 'フッ素・無機系（耐用年数15-20年）', image: PLACEHOLDER_IMG }
    ],
    hasImage: true
  },
  {
    id: 'q12_urgency',
    title: '工事希望時期は？',
    description: '工事を希望する時期を選択してください',
    options: ['1ヶ月以内', '2-3ヶ月以内', '半年以内', '1年以内', '未定'],
    hasImage: false
  }
];

// 質問フロー管理クラス
class QuestionFlow {
  constructor() {
    this.questions = QUESTIONS;
    this.answers = {};
    this.currentQuestionIndex = 0;
  }

  // 条件に基づいて表示すべき質問を取得
  getVisibleQuestions() {
    return this.questions.filter((q) => {
      if (!q.condition) return true;
      return q.condition(this.answers);
    });
  }

  // 現在の質問を取得
  getCurrentQuestion() {
    const visibleQuestions = this.getVisibleQuestions();
    return visibleQuestions[this.currentQuestionIndex] || null;
  }

  // 回答を設定
  setAnswer(questionId, answer) {
    this.answers[questionId] = answer;
    console.log('[DEBUG] 回答設定:', questionId, '=', answer);
  }

  // 次の質問へ
  nextQuestion() {
    const visibleQuestions = this.getVisibleQuestions();
    if (this.currentQuestionIndex < visibleQuestions.length - 1) {
      this.currentQuestionIndex++;
      return this.getCurrentQuestion();
    }
    return null;
  }

  // 前の質問へ
  previousQuestion() {
    if (this.currentQuestionIndex > 0) {
      this.currentQuestionIndex--;
      return this.getCurrentQuestion();
    }
    return null;
  }

  // 質問完了チェック
  isComplete() {
    const visibleQuestions = this.getVisibleQuestions();
    return this.currentQuestionIndex >= visibleQuestions.length - 1;
  }

  // 概算見積り計算（面積/状態なし版）
  calculateEstimate() {
    const a = this.answers;
    let total = 0;
    const breakdown = {};

    // ベース（平均的な規模を前提）
    // 外壁・屋根のベース価格を用意し、材質・階数・間取り・築年数・塗料で補正
    const BASE_WALL = 600000; // 外壁ベース
    const BASE_ROOF = 300000; // 屋根ベース

    const wallMaterialMul = {
      'モルタル': 1.0,
      'サイディング': 1.1,
      'タイル': 1.3,
      'ALC': 1.2
    };

    const roofMaterialMul = {
      '瓦': 1.2,
      'スレート': 1.0,
      'ガルバリウム': 1.1,
      'トタン': 0.9
    };

    const floorsMul = {
      '1階建て': 1.0,
      '2階建て': 1.15,
      '3階建て': 1.30,
      '4階建て以上': 1.45
    };

    const roomsMul = {
      '1K・1DK': 1.0,
      '1LDK・2K・2DK': 1.2,
      '2LDK・3K・3DK': 1.4,
      '3LDK・4K・4DK': 1.6,
      '4LDK以上': 1.8
    };

    const ageMul = {
      '5年未満': 1.0,
      '5-10年': 1.1,
      '11-15年': 1.2,
      '16-20年': 1.3,
      '21年以上': 1.4
    };

    const paintMul = {
      'スタンダード': 1.0,
      'ハイグレード': 1.3,
      'プレミアム': 1.6
    };

    // 外壁
    if (['外壁塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(a.q4_work_type)) {
      let wall = BASE_WALL;
      wall *= wallMaterialMul[a.q7_wall_material] || 1.0;
      breakdown.wall = Math.round(wall);
      total += breakdown.wall;
    }

    // 屋根
    if (['屋根塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(a.q4_work_type)) {
      let roof = BASE_ROOF;
      roof *= roofMaterialMul[a.q8_roof_material] || 1.0;
      breakdown.roof = Math.round(roof);
      total += breakdown.roof;
    }

    // 付帯部
    if (a.q4_work_type === '外壁・屋根・付帯部塗装') {
      breakdown.additional = 150000;
      total += breakdown.additional;
    }

    // 塗料グレード
    total *= paintMul[a.q11_paint_grade] || 1.0;

    // 階数・間取り・築年数
    total *= floorsMul[a.q1_floors] || 1.0;
    total *= roomsMul[a.q2_rooms] || 1.0;
    total *= ageMul[a.q3_age] || 1.0;

    return { total: Math.round(total), breakdown };
  }

  // 回答サマリー生成（削除した項目は表示しない）
  generateSummary() {
    const a = this.answers;
    const s = [];

    if (a.q1_floors) s.push(`階数: ${a.q1_floors}`);
    if (a.q2_rooms) s.push(`間取り: ${a.q2_rooms}`);
    if (a.q3_age) s.push(`築年数: ${a.q3_age}`);
    if (a.q4_work_type) s.push(`工事内容: ${a.q4_work_type}`);

    if (a.q7_wall_material) s.push(`外壁材: ${a.q7_wall_material}`);
    if (a.q8_roof_material) s.push(`屋根材: ${a.q8_roof_material}`);

    if (a.q11_paint_grade) s.push(`塗料グレード: ${a.q11_paint_grade}`);
    if (a.q12_urgency) s.push(`希望時期: ${a.q12_urgency}`);

    return s;
  }
}

// LIFF見積りフォームアプリケーション
class LIFFEstimateApp {
  constructor() {
    this.liffId = window.ENV?.LIFF_ID || '2007914959-XP5Rpoay';
    this.questionFlow = null;
    this.currentStep = 1; // 1: 質問, 2: 見積り, 3: 情報入力, 4: 写真
    this.customerData = {};
    this.uploadedPhotos = [];

    this.init();
  }

  async init() {
    try {
      console.log('[DEBUG] アプリ初期化開始');
      this.showLoading();

      this.questionFlow = new QuestionFlow();

      await this.initLIFF();
      this.initUI();

      this.showStep(1);
      console.log('[DEBUG] アプリ初期化完了');
    } catch (error) {
      console.error('[ERROR] 初期化エラー:', error);
      this.showError('アプリの初期化に失敗しました: ' + error.message);
    }
  }

  async initLIFF() {
    if (!this.liffId || this.liffId === 'dummy_liff_id') {
      console.log('[DEBUG] ローカルテストモード：LIFF初期化をスキップ');
      return;
    }
    if (!window.liff) throw new Error('LIFF SDKが読み込まれていません');

    console.log('[DEBUG] LIFF初期化開始');
    const initPromise = liff.init({ liffId: this.liffId });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('LIFF初期化がタイムアウトしました')), 10000);
    });
    await Promise.race([initPromise, timeoutPromise]);

    if (!liff.isLoggedIn()) {
      console.log('[DEBUG] ログインが必要です');
      liff.login();
      return;
    }
    console.log('[DEBUG] ログイン済み');
  }

  initUI() {
    this.setupEventListeners();
    this.updateProgress();
  }

  setupEventListeners() {
    // 郵便番号自動入力
    const zipcodeInput = document.getElementById('zipcode');
    if (zipcodeInput) {
      zipcodeInput.addEventListener('input', (e) => this.handlePostalCodeInput(e.target.value));
    }

    // 写真アップロード
    const photoInput = document.getElementById('photo-input');
    const albumInput = document.getElementById('album-input');
    const dropZone = document.getElementById('drop-zone');
    const cameraBtn = document.querySelector('.camera-btn');
    const albumBtn = document.querySelectorAll('.camera-btn')[1];

    if (photoInput && dropZone) {
      if (cameraBtn) {
        cameraBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          photoInput.click();
        });
      }
      if (albumBtn) {
        albumBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          albumInput.click();
        });
      }

      photoInput.addEventListener('change', (e) => this.handlePhotoSelect(e));
      albumInput.addEventListener('change', (e) => this.handlePhotoSelect(e));

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        this.handlePhotoSelect({ target: { files: e.dataTransfer.files } });
      });
      dropZone.addEventListener('click', () => albumInput.click());
    }
  }

  showLoading() {
    const el = document.getElementById('loading');
    if (el) el.style.display = 'block';
    this.hideAllSteps();
  }
  hideLoading() {
    const el = document.getElementById('loading');
    if (el) el.style.display = 'none';
  }

  showError(message) {
    this.hideLoading();
    this.hideAllSteps();
    const m = document.getElementById('error-message');
    const e = document.getElementById('error');
    if (m) m.textContent = message;
    if (e) e.style.display = 'block';
  }

  hideAllSteps() {
    ['step1', 'step2', 'step3', 'step4', 'complete'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  showStep(n) {
    this.hideLoading();
    this.hideAllSteps();
    this.currentStep = n;

    switch (n) {
      case 1:
        this.showQuestionStep();
        break;
      case 2:
        this.showEstimateStep();
        break;
      case 3:
        this.showCustomerInfoStep();
        break;
      case 4:
        this.showPhotoUploadStep();
        break;
      case 5:
        this.showCompleteStep();
        break;
    }

    this.updateProgress();
  }

  showQuestionStep() {
    const step = document.getElementById('step1');
    if (!step) return;
    step.style.display = 'block';

    const q = this.questionFlow.getCurrentQuestion();
    if (!q) {
      this.showStep(2);
      return;
    }
    this.renderQuestion(q);
  }

  renderQuestion(question) {
    const t = document.getElementById('question-title');
    const d = document.getElementById('question-description');
    if (t) t.textContent = question.title;
    if (d) d.textContent = question.description || '以下からお選びください';

    this.renderOptions(question);
    this.updateNavigationButtons();
  }

  renderOptions(question) {
    const wrap = document.getElementById('question-options');
    if (!wrap) return;

    wrap.innerHTML = '';

    // 1〜4階建ては“詰める”
    if (question.id === 'q1_floors') {
      wrap.style.gap = '8px';
    } else {
      wrap.style.gap = ''; // 既定に戻す（CSSに従う）
    }

    const useImage =
      question.hasImage ||
      ['q4_work_type', 'q7_wall_material', 'q8_roof_material', 'q11_paint_grade'].includes(question.id);

    // 正規化（文字列→オブジェクト + 画像付与）
    const options = (question.options || []).map((o) => {
      if (typeof o === 'string') {
        return useImage
          ? { value: o, label: o, description: '', image: PLACEHOLDER_IMG }
          : { value: o, label: o, description: '' };
      }
      // すでにオブジェクトのときは画像をプレースホルダーに“上書き”
      return useImage ? { ...o, image: PLACEHOLDER_IMG } : { ...o };
    });

    options.forEach((opt, idx) => {
      const id = `option_${idx}`;
      const item = document.createElement('div');
      item.className = 'question-option';

      const input = document.createElement('input');
      input.type = 'radio';
      input.id = id;
      input.name = 'question_option';
      input.value = opt.value;

      const label = document.createElement('label');
      label.className = 'option-label';
      label.setAttribute('for', id);

      // 1〜4階建てのときはラベルのパディングも詰める
      if (question.id === 'q1_floors') {
        label.style.padding = '12px';
      }

      if (useImage) {
        label.classList.add('image-option');
        label.innerHTML = `
          <div class="option-image">
            <img src="${opt.image}" alt="${opt.label}" onerror="this.style.display='none'">
          </div>
          <div class="option-content">
            <div class="option-title">${opt.label}</div>
            ${opt.description ? `<div class="option-description">${opt.description}</div>` : ''}
          </div>
        `;
      } else {
        label.innerHTML = `
          <div class="option-title">${opt.label}</div>
          ${opt.description ? `<div class="option-description">${opt.description}</div>` : ''}
        `;
      }

      item.appendChild(input);
      item.appendChild(label);
      wrap.appendChild(item);

      input.addEventListener('change', () => {
        this.questionFlow.setAnswer(question.id, opt.value);
        this.updateNavigationButtons();
      });
    });
  }

  updateNavigationButtons() {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');

    if (prevBtn) prevBtn.style.display = this.questionFlow.currentQuestionIndex > 0 ? 'block' : 'none';

    if (nextBtn) {
      const current = this.questionFlow.getCurrentQuestion();
      const answered = current && this.questionFlow.answers[current.id];
      nextBtn.disabled = !answered;
      nextBtn.textContent = this.questionFlow.isComplete() ? '見積り結果へ' : '次へ';
    }
  }

  nextQuestion() {
    const current = this.questionFlow.getCurrentQuestion();
    if (!current || !this.questionFlow.answers[current.id]) return;

    if (this.questionFlow.isComplete()) {
      this.showStep(2);
    } else {
      this.questionFlow.nextQuestion();
      this.renderQuestion(this.questionFlow.getCurrentQuestion());
    }
  }

  previousQuestion() {
    this.questionFlow.previousQuestion();
    this.renderQuestion(this.questionFlow.getCurrentQuestion());
  }

  showEstimateStep() {
    const step = document.getElementById('step2');
    if (step) step.style.display = 'block';

    const estimate = this.questionFlow.calculateEstimate();

    const priceEl = document.getElementById('estimate-price');
    if (priceEl) priceEl.textContent = `¥${estimate.total.toLocaleString()}`;

    const details = document.getElementById('estimate-details');
    if (details) {
      let html = '<div class="estimate-breakdown">';
      if (estimate.breakdown.wall) {
        html += `<div class="breakdown-item"><span>外壁塗装</span><span>¥${estimate.breakdown.wall.toLocaleString()}</span></div>`;
      }
      if (estimate.breakdown.roof) {
        html += `<div class="breakdown-item"><span>屋根塗装</span><span>¥${estimate.breakdown.roof.toLocaleString()}</span></div>`;
      }
      if (estimate.breakdown.additional) {
        html += `<div class="breakdown-item"><span>付帯部塗装</span><span>¥${estimate.breakdown.additional.toLocaleString()}</span></div>`;
      }
      html += `<div class="breakdown-item total"><span>合計</span><span>¥${estimate.total.toLocaleString()}</span></div>`;
      html += '</div>';
      html += '<div class="estimate-note">※上記は概算金額です。正確な見積りには現地調査が必要です。</div>';
      details.innerHTML = html;
    }
  }

  showCustomerInfoStep() {
    const step = document.getElementById('step3');
    if (step) step.style.display = 'block';

    Object.keys(this.customerData).forEach((k) => {
      const input = document.getElementById(k);
      if (input) input.value = this.customerData[k];
    });
  }

  showPhotoUploadStep() {
    const step = document.getElementById('step4');
    if (step) step.style.display = 'block';
    this.renderPhotoPreview();
  }

  showCompleteStep() {
    const step = document.getElementById('complete');
    if (step) step.style.display = 'block';
  }

  async handlePostalCodeInput(postalCode) {
    if (postalCode.length === 7 && /^\d{7}$/.test(postalCode)) {
      try {
        const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${postalCode}`);
        const data = await response.json();
        if (data.status === 200 && data.results && data.results.length > 0) {
          const r = data.results[0];
          const address = r.address1 + r.address2 + r.address3;
          const addressInput = document.getElementById('address1');
          if (addressInput) {
            addressInput.value = address;
            this.customerData.address1 = address;
          }
        }
      } catch (e) {
        console.error('[ERROR] 郵便番号API エラー:', e);
      }
    }
  }

  async autoFillAddress() {
    const zipcode = document.getElementById('zipcode').value;
    if (zipcode.length !== 7) return;
    try {
      const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zipcode}`);
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        const r = data.results[0];
        const address = `${r.address1}${r.address2}${r.address3}`;
        const a1 = document.getElementById('address1');
        if (a1) {
          a1.value = address;
          this.customerData.address1 = address;
        }
      }
    } catch (e) {
      console.error('住所自動入力エラー:', e);
    }
  }

  handlePhotoSelect(event) {
    const files = Array.from(event.target.files);
    const photoTypeSelect = document.getElementById('photo-type');
    const selectedType = photoTypeSelect ? photoTypeSelect.value : '';

    if (!selectedType) {
      alert('写真の種類を選択してください。');
      return;
    }

    files.forEach((file) => {
      if (file.size > 15 * 1024 * 1024) {
        alert(`${file.name} のファイルサイズが大きすぎます（15MB以下にしてください）`);
        return;
      }
      if (!file.type.startsWith('image/')) {
        alert(`${file.name} は画像ファイルではありません`);
        return;
      }
      if (this.uploadedPhotos.length >= 10) {
        alert('写真は最大10枚までアップロードできます');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        this.uploadedPhotos.push({
          name: file.name,
          size: file.size,
          type: file.type,
          photoType: selectedType,
          data: e.target.result
        });
        this.renderPhotoPreview();
        this.updateSubmitButton();
      };
      reader.readAsDataURL(file);
    });

    if (photoTypeSelect) photoTypeSelect.value = '';
  }

  renderPhotoPreview() {
    const preview = document.getElementById('photo-preview');
    if (!preview) return;
    preview.innerHTML = '';

    const labels = {
      facade: '外観正面',
      side: '外観側面',
      back: '外観背面',
      roof: '屋根全体',
      wall_detail: '外壁詳細',
      damage: '損傷箇所',
      floor_plan: '平面図',
      elevation: '立面図',
      other: 'その他'
    };

    this.uploadedPhotos.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'photo-item';
      el.innerHTML = `
        <img src="${p.data}" alt="${p.name}">
        <div class="photo-info">
          <div class="photo-type">${labels[p.photoType] || p.photoType}</div>
          <div class="photo-name">${p.name}</div>
          <div class="photo-size">${(p.size / 1024 / 1024).toFixed(1)}MB</div>
        </div>
        <button class="remove-photo" onclick="window.app.removePhoto(${i})">×</button>
      `;
      preview.appendChild(el);
    });
  }

  removePhoto(index) {
    this.uploadedPhotos.splice(index, 1);
    this.renderPhotoPreview();
    this.updateSubmitButton();
  }

  updateSubmitButton() {
    const btn = document.getElementById('submit-btn');
    if (!btn) return;
    const hasPhotos = this.uploadedPhotos.length > 0;
    if (hasPhotos) {
      btn.disabled = false;
      btn.classList.remove('disabled');
      btn.textContent = 'この内容で送信する';
    } else {
      btn.disabled = true;
      btn.classList.add('disabled');
      btn.textContent = '写真をアップロードしてください';
    }
  }

  async submitForm() {
    try {
      ['name', 'phone', 'zipcode', 'address1', 'address2'].forEach((id) => {
        const input = document.getElementById(id);
        if (input) this.customerData[id] = input.value;
      });

      const required = ['name', 'phone', 'zipcode', 'address1'];
      const missing = required.filter((k) => !this.customerData[k]);
      if (missing.length) {
        alert('必須項目が入力されていません: ' + missing.join(', '));
        return;
      }

      let lineUserId = 'local_test_user';
      if (window.liff && liff.isLoggedIn()) {
        try {
          const profile = await liff.getProfile();
          lineUserId = profile.userId;
        } catch (e) {
          console.warn('LINEプロフィール取得エラー:', e);
        }
      }

      const formData = new FormData();
      formData.append('userId', lineUserId);
      formData.append('name', this.customerData.name);
      formData.append('phone', this.customerData.phone);
      formData.append('zipcode', this.customerData.zipcode);
      formData.append('address1', this.customerData.address1);
      formData.append('address2', this.customerData.address2 || '');

      formData.append('answers', JSON.stringify(this.questionFlow.answers));
      formData.append('estimate', JSON.stringify(this.questionFlow.calculateEstimate()));

      this.uploadedPhotos.forEach((p) => {
        const byteCharacters = atob(p.data.split(',')[1]);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
        const blob = new Blob([new Uint8Array(byteNumbers)], { type: p.type });
        formData.append('photos', blob, p.name);
      });

      const resp = await fetch('/api/submit', { method: 'POST', body: formData });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`送信エラー: ${resp.status} - ${text}`);
      }

      await resp.json();
      this.showStep(5);
    } catch (e) {
      console.error('[ERROR] 送信エラー:', e);
      this.showError('送信に失敗しました: ' + e.message);
    }
  }

  updateProgress() {
    const fill = document.getElementById('progress-fill');
    const current = document.getElementById('current-step');
    if (fill && current) {
      const progress = (this.currentStep / 4) * 100; // 4ステップ構成（質問→見積→情報→写真）
      fill.style.width = `${progress}%`;
      current.textContent = this.currentStep;
    }
  }
}

// グローバル関数（HTMLから呼び出し用）
function nextQuestion() {
  if (window.app) window.app.nextQuestion();
}
function previousQuestion() {
  if (window.app) window.app.previousQuestion();
}
function showStep(stepNumber) {
  if (window.app) window.app.showStep(stepNumber);
}
function submitForm() {
  if (window.app) window.app.submitForm();
}

// アプリ初期化
document.addEventListener('DOMContentLoaded', () => {
  console.log('[DEBUG] DOM読み込み完了、アプリ初期化開始');
  window.app = new LIFFEstimateApp();
});
