class LiffApp {
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
            console.log('[DEBUG] DOM読み込み完了');
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
            
            // LIFF初期化 - 環境変数から取得
            const liffId = window.ENV?.LIFF_ID;
            if (!liffId) {
                throw new Error('LIFF IDが設定されていません');
            }
            
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
            this.userProfile = await liff.getProfile();
            this.userId = this.userProfile.userId;
            console.log('[DEBUG] ユーザーID取得:', this.userId);
            
            // DOM要素確認
            await this.checkDOMElements();
            
            // セッションデータ取得
            await this.loadSessionData();
            
            // フォームイベント設定
            this.setupFormEvents();
            
            // 初期バリデーション
            this.validateStep1();
            
            // ローディング終了
            this.hideLoading();
            console.log('[DEBUG] 初期化完了');
            
        } catch (error) {
            console.error('[ERROR] LIFF初期化エラー:', error);
            this.hideLoading();
            this.showError('LIFF初期化に失敗しました: ' + error.message);
        }
    }
    
    async checkDOMElements() {
        console.log('[DEBUG] DOM要素確認開始');
        
        const requiredElements = [
            'estimate-amount',
            'estimate-summary', 
            'name',
            'phone',
            'zipcode',
            'address1',
            'address2',
            'submit-btn'
        ];
        
        const missingElements = [];
        
        for (const elementId of requiredElements) {
            const element = document.getElementById(elementId);
            if (!element) {
                missingElements.push(elementId);
                console.warn(`[WARN] DOM要素が見つかりません: ${elementId}`);
            } else {
                console.log(`[DEBUG] DOM要素確認OK: ${elementId}`);
            }
        }
        
        if (missingElements.length > 0) {
            throw new Error(`必要なDOM要素が見つかりません: ${missingElements.join(', ')}`);
        }
        
        console.log('[DEBUG] DOM要素確認完了');
    }

    async loadSessionData() {
        console.log('[DEBUG] セッションデータ取得開始');
        
        try {
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
                this.displayEstimate();
                
                // 条件サマリー表示
                this.displaySummary();
                
            } else {
                const errorText = await response.text();
                console.warn('[WARN] セッションデータ取得失敗:', response.status, errorText);
                this.sessionData = null;
                
                // セッションがない場合のデフォルト表示
                this.displayDefaultEstimate();
            }
        } catch (error) {
            console.error('[ERROR] セッションデータ取得エラー:', error);
            this.sessionData = null;
            this.displayDefaultEstimate();
        }
    }
    
    displayEstimate() {
        console.log('[DEBUG] 概算見積り表示開始');
        
        try {
            const estimateElement = document.getElementById('estimate-amount');
            if (!estimateElement) {
                console.error('[ERROR] estimate-amount要素が見つかりません');
                return;
            }
            
            if (this.sessionData && this.sessionData.estimate && this.sessionData.estimate > 0) {
                estimateElement.textContent = `¥${this.sessionData.estimate.toLocaleString()}`;
                console.log('[DEBUG] 概算見積り表示完了:', this.sessionData.estimate);
            } else {
                estimateElement.textContent = '¥0';
                console.log('[DEBUG] セッションデータなし - デフォルト表示');
            }
        } catch (error) {
            console.error('[ERROR] 概算見積り表示エラー:', error);
        }
    }
    
    displaySummary() {
        console.log('[DEBUG] 条件サマリー表示開始');
        
        try {
            const summaryElement = document.getElementById('estimate-summary');
            if (!summaryElement) {
                console.error('[ERROR] estimate-summary要素が見つかりません');
                return;
            }
            
            if (this.sessionData && this.sessionData.summary) {
                summaryElement.textContent = this.sessionData.summary;
                console.log('[DEBUG] 条件サマリー表示完了:', this.sessionData.summary);
            } else {
                summaryElement.textContent = '条件情報なし';
                console.log('[DEBUG] サマリーデータなし - デフォルト表示');
            }
        } catch (error) {
            console.error('[ERROR] 条件サマリー表示エラー:', error);
        }
    }
    
    displayDefaultEstimate() {
        console.log('[DEBUG] デフォルト見積り表示');
        
        const estimateElement = document.getElementById('estimate-amount');
        const summaryElement = document.getElementById('estimate-summary');
        
        if (estimateElement) {
            estimateElement.textContent = '¥0';
        }
        if (summaryElement) {
            summaryElement.textContent = 'LINEで見積りを完了してください';
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
                console.log('[DEBUG] 住所1入力変更');
                this.validateStep2();
            });
        }
        
        console.log('[DEBUG] バリデーション設定完了');
    }

    setupFileInputs() {
        console.log('[DEBUG] ファイル入力設定開始');
        
        // 各ファイル入力の設定
        const fileInputs = [
            'photo-front', 'photo-back', 'photo-left', 'photo-right',
            'photo-roof', 'photo-damage', 'photo-interior', 'photo-other', 'photo-blueprint'
        ];
        
        fileInputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                input.addEventListener('change', (e) => {
                    console.log(`[DEBUG] ファイル選択: ${inputId}`);
                    this.handleFileSelect(e, inputId);
                });
                console.log(`[DEBUG] ファイル入力設定完了: ${inputId}`);
            } else {
                console.warn(`[WARN] ファイル入力が見つかりません: ${inputId}`);
            }
        });
        
        console.log('[DEBUG] ファイル入力設定完了');
    }

    validateStep1() {
        console.log('[DEBUG] ステップ1バリデーション開始');
        
        const nameInput = document.getElementById('name');
        const phoneInput = document.getElementById('phone');
        const nextBtn = document.querySelector('[data-step="2"]');
        
        if (!nameInput || !phoneInput || !nextBtn) {
            console.warn('[WARN] バリデーション要素が見つかりません');
            return false;
        }
        
        const name = nameInput.value.trim();
        const phone = phoneInput.value.trim();
        
        console.log('[DEBUG] 入力値確認:', { name: name ? '入力済み' : '未入力', phone: phone ? '入力済み' : '未入力' });
        
        const isValid = name.length > 0 && phone.length > 0;
        
        nextBtn.disabled = !isValid;
        nextBtn.style.opacity = isValid ? '1' : '0.5';
        
        console.log('[DEBUG] ステップ1バリデーション結果:', isValid);
        return isValid;
    }

    validateStep2() {
        console.log('[DEBUG] ステップ2バリデーション開始');
        
        const zipcodeInput = document.getElementById('zipcode');
        const address1Input = document.getElementById('address1');
        const nextBtn = document.querySelector('[data-step="3"]');
        
        if (!zipcodeInput || !address1Input || !nextBtn) {
            console.warn('[WARN] バリデーション要素が見つかりません');
            return false;
        }
        
        const zipcode = zipcodeInput.value.trim();
        const address1 = address1Input.value.trim();
        
        console.log('[DEBUG] 入力値確認:', { zipcode: zipcode ? '入力済み' : '未入力', address1: address1 ? '入力済み' : '未入力' });
        
        const isValid = zipcode.length > 0 && address1.length > 0;
        
        nextBtn.disabled = !isValid;
        nextBtn.style.opacity = isValid ? '1' : '0.5';
        
        console.log('[DEBUG] ステップ2バリデーション結果:', isValid);
        return isValid;
    }

    nextStep(targetStep) {
        console.log('[DEBUG] 次のステップへ:', targetStep);
        
        // 現在のステップのバリデーション
        if (this.currentStep === 1 && !this.validateStep1()) {
            console.warn('[WARN] ステップ1バリデーション失敗');
            this.showError('お名前と電話番号を入力してください');
            return;
        }
        
        if (this.currentStep === 2 && !this.validateStep2()) {
            console.warn('[WARN] ステップ2バリデーション失敗');
            this.showError('郵便番号と住所を入力してください');
            return;
        }
        
        // フォームデータ保存
        this.saveFormData();
        
        // ステップ表示切り替え
        this.showStep(targetStep);
        this.currentStep = targetStep;
        
        console.log('[DEBUG] ステップ移動完了:', targetStep);
    }

    prevStep(targetStep) {
        console.log('[DEBUG] 前のステップへ:', targetStep);
        
        // フォームデータ保存
        this.saveFormData();
        
        // ステップ表示切り替え
        this.showStep(targetStep);
        this.currentStep = targetStep;
        
        console.log('[DEBUG] ステップ移動完了:', targetStep);
    }

    showStep(step) {
        console.log('[DEBUG] ステップ表示:', step);
        
        // 全ステップを非表示
        for (let i = 1; i <= 4; i++) {
            const stepElement = document.getElementById(`step-${i}`);
            if (stepElement) {
                stepElement.style.display = 'none';
            }
        }
        
        // 指定ステップを表示
        const targetStep = document.getElementById(`step-${step}`);
        if (targetStep) {
            targetStep.style.display = 'block';
        }
        
        // プログレスバー更新
        this.updateProgress(step);
    }

    updateProgress(step) {
        console.log('[DEBUG] プログレス更新:', step);
        
        for (let i = 1; i <= 4; i++) {
            const circle = document.querySelector(`.progress-circle:nth-child(${i})`);
            if (circle) {
                if (i <= step) {
                    circle.classList.add('active');
                } else {
                    circle.classList.remove('active');
                }
            }
        }
    }

    saveFormData() {
        console.log('[DEBUG] フォームデータ保存');
        
        const inputs = ['name', 'phone', 'zipcode', 'address1', 'address2'];
        
        inputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                this.formData[inputId] = input.value.trim();
                console.log(`[DEBUG] 保存: ${inputId} = ${this.formData[inputId]}`);
            }
        });
    }

    handleFileSelect(event, inputId) {
        console.log('[DEBUG] ファイル選択処理:', inputId);
        
        const file = event.target.files[0];
        if (!file) {
            console.log('[DEBUG] ファイル選択キャンセル');
            this.selectedFiles.delete(inputId);
            return;
        }
        
        console.log('[DEBUG] 選択ファイル:', file.name, file.size, file.type);
        
        // ファイルサイズチェック（15MB）
        if (file.size > 15 * 1024 * 1024) {
            this.showError('ファイルサイズが大きすぎます。15MB以下のファイルを選択してください。');
            event.target.value = '';
            return;
        }
        
        // ファイルタイプチェック
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
        if (!allowedTypes.includes(file.type)) {
            this.showError('対応していないファイル形式です。JPEG、PNG、HEIC等の画像ファイルを選択してください。');
            event.target.value = '';
            return;
        }
        
        this.selectedFiles.set(inputId, file);
        console.log('[DEBUG] ファイル登録完了:', inputId, file.name);
        
        // プレビュー表示
        this.showFilePreview(inputId, file);
    }

    showFilePreview(inputId, file) {
        console.log('[DEBUG] ファイルプレビュー表示:', inputId);
        
        const previewId = inputId + '-preview';
        let preview = document.getElementById(previewId);
        
        if (!preview) {
            // プレビュー要素作成
            preview = document.createElement('div');
            preview.id = previewId;
            preview.className = 'file-preview';
            
            const input = document.getElementById(inputId);
            if (input && input.parentNode) {
                input.parentNode.appendChild(preview);
            }
        }
        
        preview.innerHTML = `
            <div class="preview-item">
                <span class="file-name">${file.name}</span>
                <span class="file-size">(${(file.size / 1024 / 1024).toFixed(2)}MB)</span>
            </div>
        `;
        
        console.log('[DEBUG] プレビュー表示完了:', inputId);
    }

    async submitForm() {
        console.log('[DEBUG] フォーム送信開始');
        
        try {
            // 最新のフォームデータ保存
            this.saveFormData();
            
            // バリデーション
            if (!this.validateSubmission()) {
                return;
            }
            
            // 送信ボタン無効化
            const submitBtn = document.getElementById('submit-btn');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = '送信中...';
            }
            
            // FormData作成
            const formData = new FormData();
            formData.append('userId', this.userId);
            formData.append('name', this.formData.name);
            formData.append('phone', this.formData.phone);
            formData.append('zipcode', this.formData.zipcode);
            formData.append('address1', this.formData.address1);
            formData.append('address2', this.formData.address2);
            
            // ファイル追加
            let fileCount = 0;
            this.selectedFiles.forEach((file, inputId) => {
                formData.append('photos', file);
                fileCount++;
                console.log('[DEBUG] ファイル追加:', inputId, file.name);
            });
            
            console.log('[DEBUG] 送信データ準備完了 - ファイル数:', fileCount);
            
            // 送信
            const response = await fetch('/api/submit', {
                method: 'POST',
                body: formData
            });
            
            console.log('[DEBUG] 送信応答:', response.status, response.statusText);
            
            const result = await response.json();
            
            if (response.ok) {
                console.log('[DEBUG] 送信成功:', result);
                this.showSuccess('送信が完了しました。1〜3営業日程度でLINEにお送りいたします。');
                
                // 成功後の処理
                setTimeout(() => {
                    if (liff) {
                        liff.closeWindow();
                    }
                }, 3000);
                
            } else {
                console.error('[ERROR] 送信失敗:', result);
                this.showError(result.error || '送信に失敗しました');
                
                // 送信ボタン復活
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '送信する';
                }
            }
            
        } catch (error) {
            console.error('[ERROR] フォーム送信エラー:', error);
            this.showError('送信処理中にエラーが発生しました: ' + error.message);
            
            // 送信ボタン復活
            const submitBtn = document.getElementById('submit-btn');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = '送信する';
            }
        }
    }

    validateSubmission() {
        console.log('[DEBUG] 送信バリデーション開始');
        
        // 必須項目チェック
        if (!this.formData.name || !this.formData.phone || !this.formData.zipcode || !this.formData.address1) {
            this.showError('必須項目が入力されていません');
            return false;
        }
        
        // セッションデータチェック
        if (!this.sessionData || !this.sessionData.answers) {
            this.showError('見積りデータが見つかりません。先にLINEで見積りを完了してください。');
            return false;
        }
        
        console.log('[DEBUG] 送信バリデーション成功');
        return true;
    }

    showError(message) {
        console.error('[ERROR] エラー表示:', message);
        alert('エラー: ' + message);
    }

    showSuccess(message) {
        console.log('[SUCCESS] 成功表示:', message);
        alert('成功: ' + message);
    }

    hideLoading() {
        console.log('[DEBUG] ローディング非表示');
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = 'none';
        }
        
        const content = document.getElementById('content');
        if (content) {
            content.style.display = 'block';
        }
    }
}

// DOM読み込み完了後にアプリ開始
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOM読み込み完了 - アプリ開始');
    new LiffApp();
});

