// LIFF アプリケーション
class LiffEstimateApp {
    constructor() {
        this.userId = null;
        this.userProfile = null;
        this.sessionData = null;
        this.selectedFiles = new Map(); // ファイル管理用
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
        
        // フォーム表示
        document.getElementById('estimate-form').style.display = 'block';
        
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
        // ファイル選択イベント
        const fileInputs = document.querySelectorAll('input[type="file"]');
        fileInputs.forEach(input => {
            input.addEventListener('change', (e) => this.handleFileSelect(e));
        });

        // フォーム送信イベント
        const form = document.getElementById('estimate-form');
        form.addEventListener('submit', (e) => this.handleSubmit(e));

        // 最終確認更新
        const inputs = form.querySelectorAll('input[type="text"], input[type="tel"]');
        inputs.forEach(input => {
            input.addEventListener('input', () => this.updateFinalSummary());
        });
    }

    setupZipcodeInput() {
        const zipcodeInput = document.getElementById('zipcode');
        const address1Input = document.getElementById('address1');

        zipcodeInput.addEventListener('blur', async () => {
            const zipcode = zipcodeInput.value.replace(/[^0-9]/g, '');
            if (zipcode.length === 7) {
                try {
                    // 郵便番号APIを使用（実際の実装では適切なAPIを使用）
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

        this.updateFinalSummary();
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
        const form = document.getElementById('estimate-form');
        const formData = new FormData(form);
        
        let summary = '【お客様情報】\n';
        summary += `お名前: ${formData.get('name') || '未入力'}\n`;
        summary += `電話番号: ${formData.get('phone') || '未入力'}\n`;
        summary += `郵便番号: ${formData.get('zipcode') || '未入力'}\n`;
        summary += `住所: ${formData.get('address1') || '未入力'} ${formData.get('address2') || ''}\n\n`;
        
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

    async handleSubmit(event) {
        event.preventDefault();
        
        if (!this.validateForm()) {
            return;
        }

        const submitBtn = document.getElementById('submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = '送信中...';

        try {
            const formData = new FormData();
            
            // ユーザーID追加
            formData.append('userId', this.userId);
            
            // フォームデータ追加
            const form = document.getElementById('estimate-form');
            const inputs = form.querySelectorAll('input[type="text"], input[type="tel"]');
            inputs.forEach(input => {
                formData.append(input.name, input.value);
            });

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

    validateForm() {
        const requiredFields = [
            { id: 'name', name: 'お名前' },
            { id: 'phone', name: '電話番号' },
            { id: 'zipcode', name: '郵便番号' },
            { id: 'address1', name: 'ご住所' }
        ];

        let isValid = true;
        
        // エラー表示をクリア
        document.querySelectorAll('.error-message').forEach(el => el.remove());
        document.querySelectorAll('input.error').forEach(el => el.classList.remove('error'));

        requiredFields.forEach(field => {
            const input = document.getElementById(field.id);
            const value = input.value.trim();
            
            if (!value) {
                this.showFieldError(input, `${field.name}は必須項目です`);
                isValid = false;
            }
        });

        // 電話番号形式チェック
        const phoneInput = document.getElementById('phone');
        const phoneValue = phoneInput.value.replace(/[^0-9]/g, '');
        if (phoneValue && (phoneValue.length < 10 || phoneValue.length > 11)) {
            this.showFieldError(phoneInput, '正しい電話番号を入力してください');
            isValid = false;
        }

        // 郵便番号形式チェック
        const zipcodeInput = document.getElementById('zipcode');
        const zipcodeValue = zipcodeInput.value.replace(/[^0-9]/g, '');
        if (zipcodeValue && zipcodeValue.length !== 7) {
            this.showFieldError(zipcodeInput, '正しい郵便番号を入力してください（7桁）');
            isValid = false;
        }

        return isValid;
    }

    showFieldError(input, message) {
        input.classList.add('error');
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        input.parentNode.appendChild(errorDiv);
    }

    showSuccess() {
        document.getElementById('estimate-form').style.display = 'none';
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
}

// アプリケーション初期化
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new LiffEstimateApp();
});

// グローバル関数（HTML から呼び出し用）
window.app = {
    removeFile: (inputId, index) => app?.removeFile(inputId, index)
};

