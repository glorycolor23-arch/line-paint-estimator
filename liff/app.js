class LIFFApp {
  constructor() {
    this.liffId = null;
    this.userId = null;
    this.sessionData = null;
    this.currentStep = 1;
    this.totalSteps = 4;
    this.photos = {};
    this.initTimeout = null;
    
    console.log('[DEBUG] LIFFApp初期化開始');
    this.init();
  }

  async init() {
    try {
      console.log('[DEBUG] DOM読み込み完了');
      
      // 初期化タイムアウト設定（10秒）
      this.initTimeout = setTimeout(() => {
        console.error('[ERROR] 初期化タイムアウト（10秒）');
        this.showError('アプリケーションの読み込みがタイムアウトしました。ページを再読み込みしてください。');
      }, 10000);
      
      // LIFF SDK存在確認
      if (typeof liff === 'undefined') {
        throw new Error('LIFF SDKが読み込まれていません');
      }
      console.log('[DEBUG] LIFF SDK確認完了');
      
      // 環境変数確認
      if (!window.ENV || !window.ENV.LIFF_ID) {
        throw new Error('LIFF_IDが設定されていません');
      }
      
      this.liffId = window.ENV.LIFF_ID;
      console.log('[DEBUG] LIFF ID:', this.liffId);
      
      // アプリ初期化
      console.log('[DEBUG] アプリ初期化開始');
      await this.initializeApp();
      
      // タイムアウトクリア
      if (this.initTimeout) {
        clearTimeout(this.initTimeout);
        this.initTimeout = null;
      }
      
      console.log('[DEBUG] 初期化完了');
      
    } catch (error) {
      console.error('[ERROR] 初期化エラー:', error);
      
      // タイムアウトクリア
      if (this.initTimeout) {
        clearTimeout(this.initTimeout);
        this.initTimeout = null;
      }
      
      this.showError(`エラー: ${error.message}`);
    }
  }

  async initializeApp() {
    try {
      console.log('[DEBUG] LIFF初期化開始');
      
      // LIFF初期化（タイムアウト付き）
      const initPromise = liff.init({ liffId: this.liffId });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('LIFF初期化がタイムアウトしました')), 8000);
      });
      
      await Promise.race([initPromise, timeoutPromise]);
      console.log('[DEBUG] LIFF初期化成功');

      // ログイン状態確認
      if (!liff.isLoggedIn()) {
        console.log('[DEBUG] 未ログイン - ログインページにリダイレクト');
        liff.login();
        return;
      }
      console.log('[DEBUG] ログイン済み');

      // ユーザー情報取得
      try {
        const profile = await liff.getProfile();
        this.userId = profile.userId;
        console.log('[DEBUG] ユーザーID取得:', this.userId);
      } catch (error) {
        console.error('[ERROR] ユーザー情報取得エラー:', error);
        throw new Error('ユーザー情報の取得に失敗しました');
      }

      // DOM要素確認
      console.log('[DEBUG] DOM要素確認開始');
      const requiredElements = [
        'loading',
        'content',
        'estimate-amount',
        'estimate-summary',
        'name',
        'phone'
      ];
      
      const missingElements = [];
      for (const elementId of requiredElements) {
        const element = document.getElementById(elementId);
        if (!element) {
          missingElements.push(elementId);
        }
      }
      
      if (missingElements.length > 0) {
        throw new Error(`必要なDOM要素が見つかりません: ${missingElements.join(', ')}`);
      }
      console.log('[DEBUG] DOM要素確認完了');

      // セッションデータ取得
      await this.loadSessionData();
      
      // フォームイベント設定
      console.log('[DEBUG] フォームイベント設定開始');
      this.setupFormEvents();
      console.log('[DEBUG] フォームイベント設定完了');
      
      // 写真アップロード設定
      this.setupPhotoUpload();
      
      // UI表示
      this.showContent();
      
    } catch (error) {
      console.error('[ERROR] アプリ初期化エラー:', error);
      throw error;
    }
  }

  async loadSessionData() {
    try {
      console.log('[DEBUG] セッションデータ取得開始');
      
      const response = await fetch(`/api/session/${this.userId}`);
      console.log('[DEBUG] API応答ステータス:', response.status);
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('LINEで見積りを完了してからアクセスしてください。');
        }
        throw new Error(`セッションデータの取得に失敗しました (${response.status})`);
      }

      this.sessionData = await response.json();
      console.log('[DEBUG] セッションデータ取得成功:', this.sessionData);
      
      // 概算見積り表示
      this.displayEstimate();
      
    } catch (error) {
      console.error('[ERROR] セッションデータ取得エラー:', error);
      throw error;
    }
  }

  displayEstimate() {
    try {
      console.log('[DEBUG] 概算見積り表示開始');
      
      if (!this.sessionData) {
        console.warn('[WARN] セッションデータがありません');
        return;
      }

      // 概算金額表示
      const estimateElement = document.getElementById('estimate-amount');
      if (estimateElement && this.sessionData.estimate) {
        estimateElement.textContent = `¥${this.sessionData.estimate.toLocaleString()}`;
        console.log('[DEBUG] 概算金額表示:', this.sessionData.estimate);
      } else {
        console.warn('[WARN] 概算金額要素または金額データがありません');
      }

      // 条件サマリー表示
      const summaryElement = document.getElementById('estimate-summary');
      if (summaryElement && this.sessionData.summary) {
        summaryElement.textContent = this.sessionData.summary;
        console.log('[DEBUG] 条件サマリー表示:', this.sessionData.summary);
      } else {
        console.warn('[WARN] サマリー要素またはサマリーデータがありません');
      }
      
      console.log('[DEBUG] 概算見積り表示完了');
      
    } catch (error) {
      console.error('[ERROR] 概算見積り表示エラー:', error);
    }
  }

  setupFormEvents() {
    // ステップ間の移動
    document.querySelectorAll('.next-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetStep = parseInt(btn.dataset.step);
        if (this.validateCurrentStep()) {
          this.goToStep(targetStep);
        }
      });
    });

    document.querySelectorAll('.prev-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetStep = parseInt(btn.dataset.step);
        this.goToStep(targetStep);
      });
    });

    // 入力フィールドのバリデーション
    const nameInput = document.getElementById('name');
    const phoneInput = document.getElementById('phone');
    
    if (nameInput) {
      nameInput.addEventListener('input', () => this.validateStep1());
    }
    
    if (phoneInput) {
      phoneInput.addEventListener('input', () => this.validateStep1());
    }

    // 郵便番号自動住所入力
    const zipcodeInput = document.getElementById('zipcode');
    if (zipcodeInput) {
      zipcodeInput.addEventListener('input', () => {
        this.validateStep2();
        if (zipcodeInput.value.length === 7) {
          this.fetchAddress(zipcodeInput.value);
        }
      });
    }

    const address1Input = document.getElementById('address1');
    if (address1Input) {
      address1Input.addEventListener('input', () => this.validateStep2());
    }

    // 送信ボタン
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
      submitBtn.addEventListener('click', () => this.submitForm());
    }
  }

  setupPhotoUpload() {
    const photoInputs = document.querySelectorAll('input[type="file"]');
    photoInputs.forEach(input => {
      input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          this.photos[input.id] = file;
          console.log(`[DEBUG] 写真選択: ${input.id} - ${file.name}`);
          
          // プレビュー表示（オプション）
          const label = input.parentElement;
          if (label) {
            label.style.backgroundColor = '#e8f5e8';
            const icon = label.querySelector('.photo-icon');
            if (icon) {
              icon.textContent = '✓';
            }
          }
        }
      });
    });
  }

  validateStep1() {
    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();
    
    const isValid = name.length > 0 && phone.length >= 10;
    
    const nextBtn = document.querySelector('[data-step="2"]');
    if (nextBtn) {
      nextBtn.disabled = !isValid;
    }
    
    console.log('[DEBUG] ステップ1バリデーション:', { name: name.length > 0, phone: phone.length >= 10, isValid });
    return isValid;
  }

  validateStep2() {
    const zipcode = document.getElementById('zipcode').value.trim();
    const address1 = document.getElementById('address1').value.trim();
    
    const isValid = zipcode.length === 7 && address1.length > 0;
    
    const nextBtn = document.querySelector('[data-step="3"]');
    if (nextBtn) {
      nextBtn.disabled = !isValid;
    }
    
    console.log('[DEBUG] ステップ2バリデーション:', { zipcode: zipcode.length === 7, address1: address1.length > 0, isValid });
    return isValid;
  }

  validateCurrentStep() {
    switch (this.currentStep) {
      case 1:
        return this.validateStep1();
      case 2:
        return this.validateStep2();
      case 3:
        return true; // 写真は任意
      case 4:
        return true; // 確認画面
      default:
        return false;
    }
  }

  async fetchAddress(zipcode) {
    try {
      console.log('[DEBUG] 住所取得開始:', zipcode);
      
      const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zipcode}`);
      const data = await response.json();
      
      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        const address = `${result.address1}${result.address2}${result.address3}`;
        
        const address1Input = document.getElementById('address1');
        if (address1Input) {
          address1Input.value = address;
          this.validateStep2();
        }
        
        console.log('[DEBUG] 住所取得成功:', address);
      } else {
        console.log('[DEBUG] 住所が見つかりませんでした');
      }
    } catch (error) {
      console.error('[ERROR] 住所取得エラー:', error);
    }
  }

  goToStep(step) {
    console.log('[DEBUG] ステップ移動:', this.currentStep, '->', step);
    
    // 現在のステップを非表示
    const currentStepElement = document.getElementById(`step-${this.currentStep}`);
    if (currentStepElement) {
      currentStepElement.style.display = 'none';
    }
    
    // 新しいステップを表示
    const newStepElement = document.getElementById(`step-${step}`);
    if (newStepElement) {
      newStepElement.style.display = 'block';
    }
    
    // プログレスバー更新
    this.updateProgressBar(step);
    
    // 確認画面の場合、データを表示
    if (step === 4) {
      this.updateConfirmation();
    }
    
    this.currentStep = step;
  }

  updateProgressBar(step) {
    document.querySelectorAll('.progress-circle').forEach((circle, index) => {
      if (index + 1 <= step) {
        circle.classList.add('active');
      } else {
        circle.classList.remove('active');
      }
    });
  }

  updateConfirmation() {
    // お客様情報の確認表示
    const name = document.getElementById('name').value;
    const phone = document.getElementById('phone').value;
    const zipcode = document.getElementById('zipcode').value;
    const address1 = document.getElementById('address1').value;
    const address2 = document.getElementById('address2').value;
    
    document.getElementById('confirm-name').textContent = name;
    document.getElementById('confirm-phone').textContent = phone;
    document.getElementById('confirm-zipcode').textContent = zipcode;
    document.getElementById('confirm-address').textContent = `${address1} ${address2}`.trim();
    
    // 写真確認
    const photoCount = Object.keys(this.photos).length;
    const confirmPhotos = document.getElementById('confirm-photos');
    if (confirmPhotos) {
      if (photoCount > 0) {
        confirmPhotos.textContent = `${photoCount}枚の写真が選択されています`;
      } else {
        confirmPhotos.textContent = '写真は選択されていません';
      }
    }
  }

  async submitForm() {
    try {
      console.log('[DEBUG] フォーム送信開始');
      
      const submitBtn = document.getElementById('submit-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '送信中...';
      }

      // フォームデータ作成
      const formData = new FormData();
      formData.append('userId', this.userId);
      formData.append('name', document.getElementById('name').value);
      formData.append('phone', document.getElementById('phone').value);
      formData.append('zipcode', document.getElementById('zipcode').value);
      formData.append('address1', document.getElementById('address1').value);
      formData.append('address2', document.getElementById('address2').value || '');

      // 写真を追加
      Object.values(this.photos).forEach(photo => {
        formData.append('photos', photo);
      });

      console.log('[DEBUG] 送信データ準備完了');

      // 送信
      const response = await fetch('/api/submit', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (response.ok) {
        console.log('[DEBUG] 送信成功:', result);
        this.showSuccess('送信が完了しました。1〜3営業日程度でLINEにお送りいたします。');
        
        // LIFFウィンドウを閉じる
        setTimeout(() => {
          if (liff.isInClient()) {
            liff.closeWindow();
          }
        }, 3000);
      } else {
        throw new Error(result.error || '送信に失敗しました');
      }

    } catch (error) {
      console.error('[ERROR] フォーム送信エラー:', error);
      this.showError(`送信エラー: ${error.message}`);
      
      const submitBtn = document.getElementById('submit-btn');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '送信する';
      }
    }
  }

  showContent() {
    console.log('[DEBUG] コンテンツ表示');
    
    const loading = document.getElementById('loading');
    const content = document.getElementById('content');
    
    if (loading) {
      loading.style.display = 'none';
    }
    
    if (content) {
      content.style.display = 'block';
    }
    
    // 初期バリデーション
    this.validateStep1();
  }

  showError(message) {
    console.error('[ERROR] エラー表示:', message);
    
    const loading = document.getElementById('loading');
    const content = document.getElementById('content');
    
    if (loading) {
      loading.style.display = 'none';
    }
    
    if (content) {
      content.style.display = 'none';
    }
    
    // エラーダイアログ表示
    alert(message);
  }

  showSuccess(message) {
    console.log('[SUCCESS] 成功表示:', message);
    alert(message);
  }
}

// DOM読み込み完了後に初期化
document.addEventListener('DOMContentLoaded', () => {
  console.log('[DEBUG] DOM読み込み完了 - LIFFApp開始');
  new LIFFApp();
});

