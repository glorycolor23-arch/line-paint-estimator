// LIFF ステップ形式アプリケーション
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
            // LIFF初期化
            await liff.init({ liffId: window.ENV.LIFF_ID });
            
            if (!liff.isLoggedIn()) {
                liff.login();
                return;
            }

            // ユーザー情報取得
            this.userProfile = await liff.getProfile();
            this.userId = this.userProfile.userId;

            // セッションデータ取得
            await this.loadSessionData();
            
            // UI初期化
            this.initializeUI();
            
        } catch (error) {
            console.error('LIFF初期化エラー:', error);
            this.showError('アプリケーションの初期化に失敗しました。');
        }
    }

    async loadSessionData() {
        try {
            const response = await fetch(`/api/user/${this.userId}`);
            if (response.ok) {
                this.sessionData = await response.json();
            } else {
                throw new Error('セッションデータが見つかりません');
            }
        } catch (error) {
            console.error('セッションデータ取得エラー:', error);
            this.showError('見積りデータが見つかりません。先にLINEで見積りを完了してください。');
        }
    }

    initializeUI() {
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
    }

    displayEstimate() {
        if (!this.sessionData) return;

        // 価格表示
        const priceElement = document.getElementById('estimated-price');
        priceElement.textContent = `¥${this.sessionData.estimatedPrice.toLocaleString()}`;

        // 回答サマリー表示
        const summaryElement = document.getElementById('answers-summary');
        summaryElement.textContent = this.sessionData.summary;
    }

    setupFormEvents() {
        // ステップ1フォーム
        document.getElementById('step1-form').addEventListener('submit', (e) => {
            e.preventDefault();
            if (this.validateStep1()) {
                this.saveStep1Data();
                this.goToStep(2);
            }
        });

        // ステップ2フォーム
        document.getElementById('step2-form').addEventListener('submit', (e) => {
            e.preventDefault();
            if (this.validateStep2()) {
                this.saveStep2Data();
                this.goToStep(3);
            }
        });

        // ステップ3フォーム
        document.getElementById('step3-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.goToStep(4);
        });

        // ファイル選択イベント
        const fileInputs = document.querySelectorAll('input[type="file"]');
        fileInputs.forEach(input => {
            input.addEventListener('change', (e) => this.handleFileSelect(e));
        });

        // 最終送信ボタン
        document.getElementById('submit-btn').addEventListener('click', () => {
            this.handleSubmit();
        });
    }

    setupZipcodeInput() {
        const zipcodeInput = document.getElementById('zipcode');
        const address1Input = document.getElementById('address1');

        zipcodeInput.addEventListener('blur', async () => {
            const zipcode = zipcodeInput.value.replace(/[^0-9]/g, '');
            if (zipcode.length === 7) {
                try {
                    // 郵便番号APIを使用
                    const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zipcode}`);
                    const data = await response.json();
                    
                    if (data.results && data.results.length > 0) {
                        const result = data.results[0];
                        address1Input.value = `${result.address1}${result.address2}${result.address3}`;
                    }
                } catch (error) {
                    console.error('住所取得エラー:', error);
                }
            }
        });
    }

    showStep(stepNumber) {
        // 全ステップを非表示
        for (let i = 1; i <= 4; i++) {
            document.getElementById(`step${i}`).style.display = 'none';
            document.getElementById(`step-indicator-${i}`).classList.remove('active', 'completed');
        }

        // 現在のステップを表示
        document.getElementById(`step${stepNumber}`).style.display = 'block';
        document.getElementById(`step-indicator-${stepNumber}`).classList.add('active');

        // 完了したステップをマーク
        for (let i = 1; i < stepNumber; i++) {
            document.getElementById(`step-indicator-${i}`).classList.add('completed');
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
        const name = document.getElementById('name').value.trim();
        const phone = document.getElementById('phone').value.trim();

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
        const zipcode = document.getElementById('zipcode').value.trim();
        const address1 = document.getElementById('address1').value.trim();

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
        this.formData.name = document.getElementById('name').value.trim();
        this.formData.phone = document.getElementById('phone').value.trim();
    }

    saveStep2Data() {
        this.formData.zipcode = document.getElementById('zipcode').value.trim();
        this.formData.address1 = document.getElementById('address1').value.trim();
        this.formData.address2 = document.getElementById('address2').value.trim();
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
        const dt = new DataTransfer();
        files.forEach(file => dt.items.add(file));
        input.files = dt.files;

        // プレビュー再表示
        this.handleFileSelect({ target: input });
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

        document.getElementById('final-summary').textContent = summary;
    }

    async handleSubmit() {
        const submitBtn = document.getElementById('submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = '送信中...';

        try {
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
            this.selectedFiles.forEach((files, inputId) => {
                files.forEach(file => {
                    formData.append('photos', file);
                });
            });

            // 送信
            const response = await fetch('/api/submit', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                this.showSuccess();
            } else {
                const error = await response.json();
                throw new Error(error.error || '送信に失敗しました');
            }

        } catch (error) {
            console.error('送信エラー:', error);
            alert('送信に失敗しました。もう一度お試しください。');
            submitBtn.disabled = false;
            submitBtn.textContent = '見積もりを依頼';
        }
    }

    showSuccess() {
        // 全ステップを非表示
        for (let i = 1; i <= 4; i++) {
            document.getElementById(`step${i}`).style.display = 'none';
        }
        
        document.getElementById('success').style.display = 'block';
        
        // 3秒後にLIFFを閉じる
        setTimeout(() => {
            if (liff.isInClient()) {
                liff.closeWindow();
            }
        }, 3000);
    }

    showError(message) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error-message').textContent = message;
        document.getElementById('error').style.display = 'block';
    }

    clearErrors() {
        document.querySelectorAll('.error-message').forEach(el => el.remove());
        document.querySelectorAll('input.error').forEach(el => el.classList.remove('error'));
    }

    showFieldError(input, message) {
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
    app = new LiffStepApp();
    window.app = app; // グローバルアクセス用
});

