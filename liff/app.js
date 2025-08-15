// LIFF ステップ形式アプリケーション（デバッグ強化版）
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
            console.log('[DEBUG] LIFF初期化開始');
            
            // 環境変数チェック
            if (!window.ENV || !window.ENV.LIFF_ID) {
                throw new Error('LIFF_IDが設定されていません');
            }
            
            console.log('[DEBUG] LIFF_ID:', window.ENV.LIFF_ID);
            
            // LIFF初期化
            await liff.init({ liffId: window.ENV.LIFF_ID });
            console.log('[DEBUG] LIFF初期化完了');
            
            if (!liff.isLoggedIn()) {
                console.log('[DEBUG] ログインが必要です');
                liff.login();
                return;
            }

            // ユーザー情報取得
            this.userProfile = await liff.getProfile();
            this.userId = this.userProfile.userId;
            console.log('[DEBUG] ユーザー情報取得完了:', this.userId);

            // セッションデータ取得
            await this.loadSessionData();
            
            // UI初期化
            this.initializeUI();
            
        } catch (error) {
            console.error('[ERROR] LIFF初期化エラー:', error);
            this.showError(`アプリケーションの初期化に失敗しました: ${error.message}`);
        }
    }

    async loadSessionData() {
        try {
            console.log('[DEBUG] セッションデータ取得開始:', this.userId);
            
            const response = await fetch(`/api/user/${this.userId}`);
            console.log('[DEBUG] API応答ステータス:', response.status);
            
            if (response.ok) {
                this.sessionData = await response.json();
                console.log('[DEBUG] セッションデータ取得成功:', this.sessionData);
            } else {
                const errorText = await response.text();
                console.log('[DEBUG] API応答エラー:', errorText);
                throw new Error(`セッションデータが見つかりません (${response.status})`);
            }
        } catch (error) {
            console.error('[ERROR] セッションデータ取得エラー:', error);
            this.showError('見積りデータが見つかりません。先にLINEで見積りを完了してください。');
        }
    }

    initializeUI() {
        console.log('[DEBUG] UI初期化開始');
        
        // ローディング非表示
        document.getElementById('loading').style.display = 'none';
        
        // ステップ1表示
        this.showStep(1);
        
        // 概算見積り表示
        this.displayEstimate();
        
        // フォームイベント設定
        this.setupFormEvents();
        
        // 郵便番号自動入力設定
        this.setupZipcodeInput();
        
        console.log('[DEBUG] UI初期化完了');
    }

    displayEstimate() {
        if (!this.sessionData) {
            console.log('[WARN] セッションデータがありません');
            return;
        }

        // 価格表示
        const priceElement = document.getElementById('estimated-price');
        if (priceElement) {
            priceElement.textContent = `¥${this.sessionData.estimatedPrice.toLocaleString()}`;
        }

        // 回答サマリー表示
        const summaryElement = document.getElementById('answers-summary');
        if (summaryElement) {
            summaryElement.textContent = this.sessionData.summary;
        }
        
        console.log('[DEBUG] 概算見積り表示完了');
    }

    setupFormEvents() {
        console.log('[DEBUG] フォームイベント設定開始');
        
        // ステップ1フォーム
        const step1Form = document.getElementById('step1-form');
        if (step1Form) {
            step1Form.addEventListener('submit', (e) => {
                e.preventDefault();
                if (this.validateStep1()) {
                    this.saveStep1Data();
                    this.goToStep(2);
                }
            });
        }

        // ステップ2フォーム
        const step2Form = document.getElementById('step2-form');
        if (step2Form) {
            step2Form.addEventListener('submit', (e) => {
                e.preventDefault();
                if (this.validateStep2()) {
                    this.saveStep2Data();
                    this.goToStep(3);
                }
            });
        }

        // ステップ3フォーム
        const step3Form = document.getElementById('step3-form');
        if (step3Form) {
            step3Form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.goToStep(4);
            });
        }

        // ファイル選択イベント
        const fileInputs = document.querySelectorAll('input[type="file"]');
        fileInputs.forEach(input => {
            input.addEventListener('change', (e) => this.handleFileSelect(e));
        });

        // 最終送信ボタン
        const submitBtn = document.getElementById('submit-btn');
        if (submitBtn) {
            submitBtn.addEventListener('click', () => {
                this.handleSubmit();
            });
        }
        
        console.log('[DEBUG] フォームイベント設定完了');
    }

    setupZipcodeInput() {
        const zipcodeInput = document.getElementById('zipcode');
        const address1Input = document.getElementById('address1');

        if (!zipcodeInput || !address1Input) {
            console.log('[WARN] 郵便番号入力要素が見つかりません');
            return;
        }

        zipcodeInput.addEventListener('blur', async () => {
            const zipcode = zipcodeInput.value.replace(/[^0-9]/g, '');
            if (zipcode.length === 7) {
                try {
                    console.log('[DEBUG] 住所検索開始:', zipcode);
                    // 郵便番号APIを使用
                    const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zipcode}`);
                    const data = await response.json();
                    
                    if (data.results && data.results.length > 0) {
                        const result = data.results[0];
                        address1Input.value = `${result.address1}${result.address2}${result.address3}`;
                        console.log('[DEBUG] 住所検索成功:', address1Input.value);
                    }
                } catch (error) {
                    console.error('[ERROR] 住所取得エラー:', error);
                }
            }
        });
    }

    showStep(stepNumber) {
        console.log('[DEBUG] ステップ表示:', stepNumber);
        
        // 全ステップを非表示
        for (let i = 1; i <= 4; i++) {
            const stepElement = document.getElementById(`step${i}`);
            const indicatorElement = document.getElementById(`step-indicator-${i}`);
            
            if (stepElement) stepElement.style.display = 'none';
            if (indicatorElement) {
                indicatorElement.classList.remove('active', 'completed');
            }
        }

        // 現在のステップを表示
        const currentStepElement = document.getElementById(`step${stepNumber}`);
        const currentIndicatorElement = document.getElementById(`step-indicator-${stepNumber}`);
        
        if (currentStepElement) currentStepElement.style.display = 'block';
        if (currentIndicatorElement) currentIndicatorElement.classList.add('active');

        // 完了したステップをマーク
        for (let i = 1; i < stepNumber; i++) {
            const indicatorElement = document.getElementById(`step-indicator-${i}`);
            if (indicatorElement) indicatorElement.classList.add('completed');
        }

        this.currentStep = stepNumber;

        // ステップ4の場合は最終確認を更新
        if (stepNumber === 4) {
            this.updateFinalSummary();
        }
    }

    goToStep(stepNumber) {
        this.showStep(stepNumber);
    }

    validateStep1() {
        const name = document.getElementById('name')?.value.trim() || '';
        const phone = document.getElementById('phone')?.value.trim() || '';

        // エラー表示をクリア
        this.clearErrors();

        let isValid = true;

        if (!name) {
            this.showFieldError(document.getElementById('name'), 'お名前は必須項目です');
            isValid = false;
        }

        if (!phone) {
            this.showFieldError(document.getElementById('phone'), '電話番号は必須項目です');
            isValid = false;
        } else {
            const phoneValue = phone.replace(/[^0-9]/g, '');
            if (phoneValue.length < 10 || phoneValue.length > 11) {
                this.showFieldError(document.getElementById('phone'), '正しい電話番号を入力してください');
                isValid = false;
            }
        }

        return isValid;
    }

    validateStep2() {
        const zipcode = document.getElementById('zipcode')?.value.trim() || '';
        const address1 = document.getElementById('address1')?.value.trim() || '';

        // エラー表示をクリア
        this.clearErrors();

        let isValid = true;

        if (!zipcode) {
            this.showFieldError(document.getElementById('zipcode'), '郵便番号は必須項目です');
            isValid = false;
        } else {
            const zipcodeValue = zipcode.replace(/[^0-9]/g, '');
            if (zipcodeValue.length !== 7) {
                this.showFieldError(document.getElementById('zipcode'), '正しい郵便番号を入力してください（7桁）');
                isValid = false;
            }
        }

        if (!address1) {
            this.showFieldError(document.getElementById('address1'), 'ご住所は必須項目です');
            isValid = false;
        }

        return isValid;
    }

    saveStep1Data() {
        this.formData.name = document.getElementById('name')?.value.trim() || '';
        this.formData.phone = document.getElementById('phone')?.value.trim() || '';
        console.log('[DEBUG] ステップ1データ保存:', this.formData);
    }

    saveStep2Data() {
        this.formData.zipcode = document.getElementById('zipcode')?.value.trim() || '';
        this.formData.address1 = document.getElementById('address1')?.value.trim() || '';
        this.formData.address2 = document.getElementById('address2')?.value.trim() || '';
        console.log('[DEBUG] ステップ2データ保存:', this.formData);
    }

    handleFileSelect(event) {
        const input = event.target;
        const previewId = input.id + '-preview';
        const previewContainer = document.getElementById(previewId);
        
        if (!previewContainer) return;

        // 既存のプレビューをクリア
        previewContainer.innerHTML = '';
        
        // 選択されたファイルを保存
        const files = Array.from(input.files);
        this.selectedFiles.set(input.id, files);

        console.log(`[DEBUG] ファイル選択: ${input.id}, ${files.length}ファイル`);

        // プレビュー表示
        files.forEach((file, index) => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const previewItem = document.createElement('div');
                    previewItem.className = 'preview-item';
                    previewItem.innerHTML = `
                        <img src="${e.target.result}" alt="プレビュー">
                        <button type="button" class="preview-remove" onclick="app.removeFile('${input.id}', ${index})">×</button>
                    `;
                    previewContainer.appendChild(previewItem);
                };
                reader.readAsDataURL(file);
            }
        });
    }

    removeFile(inputId, index) {
        const files = this.selectedFiles.get(inputId) || [];
        files.splice(index, 1);
        this.selectedFiles.set(inputId, files);

        // input要素も更新
        const input = document.getElementById(inputId);
        if (input) {
            const dt = new DataTransfer();
            files.forEach(file => dt.items.add(file));
            input.files = dt.files;

            // プレビュー再表示
            this.handleFileSelect({ target: input });
        }
    }

    updateFinalSummary() {
        let summary = '【お客様情報】\n';
        summary += `お名前: ${this.formData.name}\n`;
        summary += `電話番号: ${this.formData.phone}\n`;
        summary += `郵便番号: ${this.formData.zipcode}\n`;
        summary += `住所: ${this.formData.address1} ${this.formData.address2}\n\n`;
        
        summary += '【質問回答】\n';
        summary += this.sessionData?.summary || '';
        summary += '\n\n';
        
        summary += '【概算見積り】\n';
        summary += `¥${this.sessionData?.estimatedPrice?.toLocaleString() || '0'}\n\n`;
        
        // アップロードファイル数
        let totalFiles = 0;
        this.selectedFiles.forEach(files => totalFiles += files.length);
        summary += `【添付写真・図面】\n`;
        summary += `合計 ${totalFiles} ファイル`;

        const finalSummaryElement = document.getElementById('final-summary');
        if (finalSummaryElement) {
            finalSummaryElement.textContent = summary;
        }
    }

    async handleSubmit() {
        const submitBtn = document.getElementById('submit-btn');
        if (!submitBtn) return;
        
        submitBtn.disabled = true;
        submitBtn.textContent = '送信中...';

        try {
            console.log('[DEBUG] 送信開始');
            
            const formData = new FormData();
            
            // ユーザーID追加
            formData.append('userId', this.userId);
            
            // フォームデータ追加
            formData.append('name', this.formData.name);
            formData.append('phone', this.formData.phone);
            formData.append('zipcode', this.formData.zipcode);
            formData.append('address1', this.formData.address1);
            formData.append('address2', this.formData.address2);

            // ファイル追加
            let totalFiles = 0;
            this.selectedFiles.forEach((files, inputId) => {
                files.forEach(file => {
                    formData.append('photos', file);
                    totalFiles++;
                });
            });
            
            console.log(`[DEBUG] 送信データ: ファイル${totalFiles}個`);

            // 送信
            const response = await fetch('/api/submit', {
                method: 'POST',
                body: formData
            });

            console.log('[DEBUG] 送信応答ステータス:', response.status);

            if (response.ok) {
                const result = await response.json();
                console.log('[DEBUG] 送信成功:', result);
                this.showSuccess();
            } else {
                const error = await response.json();
                throw new Error(error.error || '送信に失敗しました');
            }

        } catch (error) {
            console.error('[ERROR] 送信エラー:', error);
            alert('送信に失敗しました。もう一度お試しください。');
            submitBtn.disabled = false;
            submitBtn.textContent = '見積もりを依頼';
        }
    }

    showSuccess() {
        console.log('[DEBUG] 成功画面表示');
        
        // 全ステップを非表示
        for (let i = 1; i <= 4; i++) {
            const stepElement = document.getElementById(`step${i}`);
            if (stepElement) stepElement.style.display = 'none';
        }
        
        const successElement = document.getElementById('success');
        if (successElement) successElement.style.display = 'block';
        
        // 3秒後にLIFFを閉じる
        setTimeout(() => {
            if (liff.isInClient()) {
                liff.closeWindow();
            }
        }, 3000);
    }

    showError(message) {
        console.log('[DEBUG] エラー画面表示:', message);
        
        document.getElementById('loading').style.display = 'none';
        
        const errorMessageElement = document.getElementById('error-message');
        const errorElement = document.getElementById('error');
        
        if (errorMessageElement) errorMessageElement.textContent = message;
        if (errorElement) errorElement.style.display = 'block';
    }

    clearErrors() {
        document.querySelectorAll('.error-message').forEach(el => el.remove());
        document.querySelectorAll('input.error').forEach(el => el.classList.remove('error'));
    }

    showFieldError(input, message) {
        if (!input) return;
        
        input.classList.add('error');
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        input.parentNode.appendChild(errorDiv);
    }
}

// グローバル関数
function goToStep(stepNumber) {
    if (window.app) {
        window.app.goToStep(stepNumber);
    }
}

// アプリケーション初期化
let app;
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOM読み込み完了');
    app = new LiffStepApp();
    window.app = app; // グローバルアクセス用
});

