class LiffStepApp {
    constructor() {
        this.userId = null;
        this.userProfile = null;
        this.sessionData = null;
        this.selectedFiles = new Map(); // ファイル管理用
        this.currentStep = 1;
        this.formData = {
            name: '',
            phone: '',
            zipcode: '',
            address1: '',
            address2: ''
        };
        this.init();
    }

    async init() {
        try {
            console.log('[DEBUG] アプリ初期化開始');
            
            // 5秒後にタイムアウト処理
            const timeoutId = setTimeout(() => {
                console.error('[ERROR] 初期化タイムアウト');
                this.hideLoading();
                this.showError('アプリケーションの読み込みがタイムアウトしました。ページを再読み込みしてください。');
            }, 5000);
            
            await this.initializeLiff();
            clearTimeout(timeoutId);
            
        } catch (error) {
            console.error('[ERROR] アプリ初期化エラー:', error);
            this.hideLoading();
            this.showError('アプリケーションの初期化に失敗しました: ' + error.message);
        }
    }

    async initializeLiff() {
        console.log('[DEBUG] LIFF初期化開始');
        
        try {
            // LIFF SDKの存在確認
            if (typeof liff === 'undefined') {
                throw new Error('LIFF SDKが読み込まれていません');
            }
            
            console.log('[DEBUG] LIFF SDK確認完了');
            
            // LIFF初期化 - 環境変数から取得するように修正
            const liffId = window.LIFF_ID || '2007914959-XP5Rpoay';
            console.log('[DEBUG] LIFF ID:', liffId);
            
            await liff.init({ liffId: liffId });
            console.log('[DEBUG] LIFF初期化成功');
            
            // ログイン状態確認
            if (!liff.isLoggedIn()) {
                console.log('[DEBUG] 未ログイン - ログイン画面へ');
                liff.login();
                return;
            }
            
            console.log('[DEBUG] ログイン済み');
            
            // ユーザー情報取得
            try {
                const profile = await liff.getProfile();
                this.userId = profile.userId;
                this.userProfile = profile;
                console.log('[DEBUG] ユーザーID取得:', this.userId);
                console.log('[DEBUG] ユーザープロフィール:', profile);
            } catch (profileError) {
                console.error('[ERROR] プロフィール取得エラー:', profileError);
                throw new Error('ユーザー情報の取得に失敗しました');
            }
            
            // セッションデータ取得
            await this.loadSessionData();
            
            // DOM要素の存在確認
            this.checkDOMElements();
            
            // フォーム初期化
            this.setupFormEvents();
            
            // 初期ステップ表示
            this.goToStep(1);
            
            // ローディング非表示
            this.hideLoading();
            
            console.log('[DEBUG] LIFF初期化完了');
            
        } catch (error) {
            console.error('[ERROR] LIFF初期化エラー:', error);
            this.hideLoading();
            this.showError('アプリケーションの初期化に失敗しました: ' + error.message);
        }
    }

    checkDOMElements() {
        console.log('[DEBUG] DOM要素確認開始');
        
        const requiredElements = [
            'step1', 'step2', 'step3', 'step4',
            'name', 'phone', 'zipcode', 'address1',
            'submit-btn'
        ];
        
        const missingElements = [];
        
        for (const elementId of requiredElements) {
            const element = document.getElementById(elementId);
            if (!element) {
                missingElements.push(elementId);
            }
        }
        
        if (missingElements.length > 0) {
            console.error('[ERROR] 必要なDOM要素が見つかりません:', missingElements);
            throw new Error(`必要な要素が見つかりません: ${missingElements.join(', ')}`);
        }
        
        console.log('[DEBUG] DOM要素確認完了');
    }

    hideLoading() {
        console.log('[DEBUG] ローディング非表示');
        const loadingElement = document.getElementById('loading');
        if (loadingElement) {
            loadingElement.style.display = 'none';
        } else {
            console.warn('[WARN] ローディング要素が見つかりません');
        }
    }

    async loadSessionData() {
        try {
            console.log('[DEBUG] セッションデータ取得開始:', this.userId);
            
            if (!this.userId) {
                console.warn('[WARN] ユーザーIDが設定されていません');
                return;
            }
            
            const response = await fetch(`/api/session/${this.userId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('[DEBUG] セッションAPI応答:', response.status, response.statusText);
            
            if (response.ok) {
                this.sessionData = await response.json();
                console.log('[DEBUG] セッションデータ取得成功:', this.sessionData);
                
                // 概算見積り表示
                if (this.sessionData && this.sessionData.estimate) {
                    const estimateElement = document.getElementById('estimate-amount');
                    if (estimateElement) {
                        estimateElement.textContent = `¥${this.sessionData.estimate.toLocaleString()}`;
                        console.log('[DEBUG] 概算見積り表示:', this.sessionData.estimate);
                    }
                }
            } else {
                const errorText = await response.text();
                console.warn('[WARN] セッションデータ取得失敗:', response.status, errorText);
                this.sessionData = null;
            }
        } catch (error) {
            console.error('[ERROR] セッションデータ取得エラー:', error);
            this.sessionData = null;
        }
    }

    setupFormEvents() {
        console.log('[DEBUG] フォームイベント設定開始');
        
        try {
            // 次へボタン
            const nextButtons = document.querySelectorAll('.next-btn');
            console.log('[DEBUG] 次へボタン数:', nextButtons.length);
            nextButtons.forEach((btn, index) => {
                btn.addEventListener('click', (e) => {
                    const step = parseInt(e.target.dataset.step);
                    console.log('[DEBUG] 次へボタンクリック:', step);
                    this.nextStep(step);
                });
            });
            
            // 戻るボタン
            const prevButtons = document.querySelectorAll('.prev-btn');
            console.log('[DEBUG] 戻るボタン数:', prevButtons.length);
            prevButtons.forEach((btn, index) => {
                btn.addEventListener('click', (e) => {
                    const step = parseInt(e.target.dataset.step);
                    console.log('[DEBUG] 戻るボタンクリック:', step);
                    this.prevStep(step);
                });
            });
            
            // 送信ボタン
            const submitBtn = document.getElementById('submit-btn');
            if (submitBtn) {
                submitBtn.addEventListener('click', () => {
                    console.log('[DEBUG] 送信ボタンクリック');
                    this.submitForm();
                });
                console.log('[DEBUG] 送信ボタンイベント設定完了');
            } else {
                console.warn('[WARN] 送信ボタンが見つかりません');
            }
            
            // 入力フィールドのバリデーション
            this.setupValidation();
            
            // ファイル選択
            this.setupFileInputs();
            
            console.log('[DEBUG] フォームイベント設定完了');
            
        } catch (error) {
            console.error('[ERROR] フォームイベント設定エラー:', error);
            throw error;
        }
    }

    setupValidation() {
        console.log('[DEBUG] バリデーション設定開始');
        
        // ステップ1のバリデーション
        const nameInput = document.getElementById('name');
        const phoneInput = document.getElementById('phone');
        
        if (nameInput) {
            nameInput.addEventListener('input', () => {
                console.log('[DEBUG] 名前入力変更');
                this.validateStep1();
            });
        }
        if (phoneInput) {
            phoneInput.addEventListener('input', () => {
                console.log('[DEBUG] 電話番号入力変更');
                this.validateStep1();
            });
        }
        
        // ステップ2のバリデーション
        const zipcodeInput = document.getElementById('zipcode');
        const address1Input = document.getElementById('address1');
        
        if (zipcodeInput) {
            zipcodeInput.addEventListener('input', () => {
                console.log('[DEBUG] 郵便番号入力変更');
                this.validateStep2();
            });
        }
        if (address1Input) {
            address1Input.addEventListener('input', () => {
                console.log('[DEBUG] 住所入力変更');
                this.validateStep2();
            });
        }
        
        console.log('[DEBUG] バリデーション設定完了');
    }

    validateStep1() {
        const name = document.getElementById('name')?.value.trim() || '';
        const phone = document.getElementById('phone')?.value.trim() || '';
        
        const isValid = name.length > 0 && phone.length > 0;
        console.log('[DEBUG] ステップ1バリデーション:', { name: name.length, phone: phone.length, isValid });
        
        const nextBtn = document.querySelector('[data-step="1"].next-btn');
        if (nextBtn) {
            nextBtn.disabled = !isValid;
            nextBtn.classList.toggle('disabled', !isValid);
        }
        
        return isValid;
    }

    validateStep2() {
        const zipcode = document.getElementById('zipcode')?.value.trim() || '';
        const address1 = document.getElementById('address1')?.value.trim() || '';
        
        const isValid = zipcode.length >= 7 && address1.length > 0;
        console.log('[DEBUG] ステップ2バリデーション:', { zipcode: zipcode.length, address1: address1.length, isValid });
        
        const nextBtn = document.querySelector('[data-step="2"].next-btn');
        if (nextBtn) {
            nextBtn.disabled = !isValid;
            nextBtn.classList.toggle('disabled', !isValid);
        }
        
        return isValid;
    }

    validateStep3() {
        // 立面図と平面図が必須
        const requiredFiles = ['elevation', 'floor_plan'];
        let hasRequired = true;
        
        for (const fileType of requiredFiles) {
            if (!this.selectedFiles.has(fileType)) {
                hasRequired = false;
                break;
            }
        }
        
        console.log('[DEBUG] ステップ3バリデーション:', { 
            selectedFiles: Array.from(this.selectedFiles.keys()), 
            hasRequired 
        });
        
        const nextBtn = document.querySelector('[data-step="3"].next-btn');
        if (nextBtn) {
            nextBtn.disabled = !hasRequired;
            nextBtn.classList.toggle('disabled', !hasRequired);
        }
        
        return hasRequired;
    }

    setupFileInputs() {
        console.log('[DEBUG] ファイル入力設定開始');
        
        const fileInputs = document.querySelectorAll('input[type="file"]');
        console.log('[DEBUG] ファイル入力数:', fileInputs.length);
        
        fileInputs.forEach((input, index) => {
            input.addEventListener('change', (e) => {
                console.log('[DEBUG] ファイル選択変更:', index);
                this.handleFileSelect(e);
            });
        });
        
        console.log('[DEBUG] ファイル入力設定完了');
    }

    handleFileSelect(event) {
        const input = event.target;
        const file = input.files[0];
        const fileType = input.dataset.type;
        
        console.log('[DEBUG] ファイル選択:', fileType, file?.name, file?.size);
        
        if (file) {
            // ファイルサイズチェック (15MB)
            if (file.size > 15 * 1024 * 1024) {
                alert('ファイルサイズが大きすぎます。15MB以下のファイルを選択してください。');
                input.value = '';
                return;
            }
            
            // ファイル形式チェック
            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
            if (!allowedTypes.includes(file.type) && !file.name.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|heic|heif)$/)) {
                alert('対応していないファイル形式です。JPEG、PNG、GIF、WebP、HEIC形式のファイルを選択してください。');
                input.value = '';
                return;
            }
            
            this.selectedFiles.set(fileType, file);
            this.showFilePreview(fileType, file);
        } else {
            this.selectedFiles.delete(fileType);
            this.hideFilePreview(fileType);
        }
        
        // ステップ3のバリデーション更新
        if (this.currentStep === 3) {
            this.validateStep3();
        }
    }

    showFilePreview(fileType, file) {
        const previewElement = document.getElementById(`preview-${fileType}`);
        if (!previewElement) {
            console.warn('[WARN] プレビュー要素が見つかりません:', fileType);
            return;
        }
        
        if (file.type.startsWith('image/') && !file.type.includes('heic') && !file.type.includes('heif')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                previewElement.innerHTML = `
                    <img src="${e.target.result}" alt="プレビュー" style="max-width: 100px; max-height: 100px; object-fit: cover;">
                    <p>${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)</p>
                `;
            };
            reader.readAsDataURL(file);
        } else {
            // HEIC/HEIFまたはプレビューできない場合
            previewElement.innerHTML = `
                <div class="file-icon">📷</div>
                <p>${file.name}</p>
                <p>${(file.size / 1024 / 1024).toFixed(2)}MB</p>
            `;
        }
        
        previewElement.style.display = 'block';
    }

    hideFilePreview(fileType) {
        const previewElement = document.getElementById(`preview-${fileType}`);
        if (previewElement) {
            previewElement.style.display = 'none';
            previewElement.innerHTML = '';
        }
    }

    goToStep(step) {
        console.log('[DEBUG] ステップ移動:', this.currentStep, '->', step);
        
        try {
            // 全ステップを非表示
            for (let i = 1; i <= 4; i++) {
                const stepElement = document.getElementById(`step${i}`);
                if (stepElement) {
                    stepElement.style.display = 'none';
                } else {
                    console.warn(`[WARN] ステップ${i}要素が見つかりません`);
                }
            }
            
            // 指定ステップを表示
            const targetStep = document.getElementById(`step${step}`);
            if (targetStep) {
                targetStep.style.display = 'block';
                console.log('[DEBUG] ステップ表示:', step);
            } else {
                console.error(`[ERROR] ステップ${step}要素が見つかりません`);
                throw new Error(`ステップ${step}が見つかりません`);
            }
            
            // ステップインジケーター更新
            this.updateStepIndicator(step);
            
            this.currentStep = step;
            
            // 各ステップのバリデーション実行
            if (step === 1) this.validateStep1();
            if (step === 2) this.validateStep2();
            if (step === 3) this.validateStep3();
            
            console.log('[DEBUG] ステップ移動完了:', step);
            
        } catch (error) {
            console.error('[ERROR] ステップ移動エラー:', error);
            this.showError('ページの表示に失敗しました: ' + error.message);
        }
    }

    updateStepIndicator(activeStep) {
        for (let i = 1; i <= 4; i++) {
            const indicator = document.querySelector(`.step-indicator .step:nth-child(${i})`);
            if (indicator) {
                indicator.classList.toggle('active', i === activeStep);
                indicator.classList.toggle('completed', i < activeStep);
            }
        }
    }

    nextStep(currentStep) {
        console.log('[DEBUG] 次のステップへ:', currentStep);
        
        // バリデーション
        let isValid = true;
        if (currentStep === 1) isValid = this.validateStep1();
        if (currentStep === 2) isValid = this.validateStep2();
        if (currentStep === 3) isValid = this.validateStep3();
        
        if (!isValid) {
            console.warn('[WARN] バリデーションエラー');
            return;
        }
        
        // フォームデータ保存
        this.saveFormData();
        
        // 次のステップへ
        this.goToStep(currentStep + 1);
    }

    prevStep(currentStep) {
        console.log('[DEBUG] 前のステップへ:', currentStep);
        this.goToStep(currentStep - 1);
    }

    saveFormData() {
        const nameInput = document.getElementById('name');
        const phoneInput = document.getElementById('phone');
        const zipcodeInput = document.getElementById('zipcode');
        const address1Input = document.getElementById('address1');
        const address2Input = document.getElementById('address2');
        
        if (nameInput) this.formData.name = nameInput.value.trim();
        if (phoneInput) this.formData.phone = phoneInput.value.trim();
        if (zipcodeInput) this.formData.zipcode = zipcodeInput.value.trim();
        if (address1Input) this.formData.address1 = address1Input.value.trim();
        if (address2Input) this.formData.address2 = address2Input.value.trim();
        
        console.log('[DEBUG] フォームデータ保存:', this.formData);
    }

    async submitForm() {
        console.log('[DEBUG] フォーム送信開始');
        
        const submitBtn = document.getElementById('submit-btn');
        if (!submitBtn) {
            console.error('[ERROR] 送信ボタンが見つかりません');
            return;
        }
        
        // ローディング表示
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'flex';
        }
        
        submitBtn.disabled = true;
        submitBtn.textContent = '送信中...';
        
        try {
            // 最終バリデーション
            if (!this.userId) {
                throw new Error('ユーザーIDが設定されていません');
            }
            
            if (!this.formData.name || !this.formData.phone) {
                throw new Error('必須項目が入力されていません');
            }
            
            // フォームデータ準備
            const formData = new FormData();
            formData.append('userId', this.userId);
            formData.append('name', this.formData.name);
            formData.append('phone', this.formData.phone);
            formData.append('zipcode', this.formData.zipcode);
            formData.append('address1', this.formData.address1);
            formData.append('address2', this.formData.address2);
            
            // ファイル追加
            for (const [fileType, file] of this.selectedFiles) {
                formData.append(fileType, file);
                console.log('[DEBUG] ファイル追加:', fileType, file.name);
            }
            
            console.log('[DEBUG] 送信データ準備完了');
            console.log('[DEBUG] 送信ファイル数:', this.selectedFiles.size);
            
            // 送信
            const response = await fetch('/api/submit', {
                method: 'POST',
                body: formData
            });
            
            console.log('[DEBUG] 送信応答:', response.status, response.statusText);
            
            if (response.ok) {
                const result = await response.json();
                console.log('[DEBUG] 送信成功:', result);
                this.showSuccess();
            } else {
                const errorData = await response.json().catch(() => ({ error: '不明なエラー' }));
                throw new Error(errorData.error || `送信に失敗しました (${response.status})`);
            }

        } catch (error) {
            console.error('[ERROR] 送信エラー:', error);
            
            // ローディング非表示
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }
            
            alert('送信に失敗しました。もう一度お試しください。\n\nエラー: ' + error.message);
            submitBtn.disabled = false;
            submitBtn.textContent = '見積もりを依頼';
        }
    }

    showSuccess() {
        console.log('[DEBUG] 成功画面表示');
        
        // ローディング非表示
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
        
        // 全ステップを非表示
        for (let i = 1; i <= 4; i++) {
            const stepElement = document.getElementById(`step${i}`);
            if (stepElement) stepElement.style.display = 'none';
        }
        
        const successElement = document.getElementById('success');
        if (successElement) {
            successElement.style.display = 'block';
        } else {
            alert('見積もり依頼を送信しました。ありがとうございます。');
        }
        
        // 3秒後にLIFFを閉じる
        setTimeout(() => {
            if (liff.isInClient()) {
                liff.closeWindow();
            }
        }, 3000);
    }

    showError(message) {
        console.log('[DEBUG] エラー画面表示:', message);
        
        // ローディング非表示
        this.hideLoading();
        
        // エラーメッセージ表示
        const errorElement = document.getElementById('error-message');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        } else {
            alert('エラー: ' + message);
        }
    }
}

// アプリ初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOM読み込み完了');
    
    // LIFF SDKの読み込み確認
    if (typeof liff === 'undefined') {
        console.error('[ERROR] LIFF SDKが読み込まれていません');
        alert('LIFF SDKが読み込まれていません。ページを再読み込みしてください。');
        return;
    }
    
    console.log('[DEBUG] LIFF SDK確認完了');
    
    try {
        new LiffStepApp();
    } catch (error) {
        console.error('[ERROR] アプリ初期化失敗:', error);
        alert('アプリケーションの初期化に失敗しました: ' + error.message);
    }
});

