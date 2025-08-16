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
            
            // ローディング表示
            this.showLoading();
            
            // LIFF初期化
            await this.initLIFF();
            
            // 質問フロー初期化
            this.questionFlow = new QuestionFlow();
            
            // UI初期化
            this.initUI();
            
            // 最初の質問を表示
            this.showStep(1);
            
            console.log('[DEBUG] アプリ初期化完了');
            
        } catch (error) {
            console.error('[ERROR] 初期化エラー:', error);
            this.showError('アプリの初期化に失敗しました: ' + error.message);
        }
    }
    
    async initLIFF() {
        if (!window.liff) {
            throw new Error('LIFF SDKが読み込まれていません');
        }
        
        console.log('[DEBUG] LIFF初期化開始');
        
        // タイムアウト付きLIFF初期化
        const initPromise = liff.init({ liffId: this.liffId });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('LIFF初期化がタイムアウトしました')), 10000);
        });
        
        await Promise.race([initPromise, timeoutPromise]);
        
        console.log('[DEBUG] LIFF初期化成功');
        
        // ログイン確認
        if (!liff.isLoggedIn()) {
            console.log('[DEBUG] ログインが必要です');
            liff.login();
            return;
        }
        
        console.log('[DEBUG] ログイン済み');
    }
    
    initUI() {
        // イベントリスナー設定
        this.setupEventListeners();
        
        // プログレスバー初期化
        this.updateProgress();
    }
    
    setupEventListeners() {
        // 郵便番号自動入力
        const zipcodeInput = document.getElementById('zipcode');
        if (zipcodeInput) {
            zipcodeInput.addEventListener('blur', () => this.autoFillAddress());
        }
        
        // 写真アップロード
        const photoInput = document.getElementById('photo-input');
        const dropZone = document.getElementById('drop-zone');
        
        if (photoInput && dropZone) {
            photoInput.addEventListener('change', (e) => this.handlePhotoSelect(e));
            
            // ドラッグ&ドロップ
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });
            
            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('drag-over');
            });
            
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('drag-over');
                this.handlePhotoSelect({ target: { files: e.dataTransfer.files } });
            });
        }
    }
    
    showLoading() {
        document.getElementById('loading').style.display = 'block';
        this.hideAllSteps();
    }
    
    hideLoading() {
        document.getElementById('loading').style.display = 'none';
    }
    
    showError(message) {
        this.hideLoading();
        this.hideAllSteps();
        
        document.getElementById('error-message').textContent = message;
        document.getElementById('error').style.display = 'block';
    }
    
    hideAllSteps() {
        ['step1', 'step2', 'step3', 'step4', 'complete'].forEach(stepId => {
            const element = document.getElementById(stepId);
            if (element) element.style.display = 'none';
        });
    }
    
    showStep(stepNumber) {
        this.hideLoading();
        this.hideAllSteps();
        
        this.currentStep = stepNumber;
        
        switch (stepNumber) {
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
        document.getElementById('step1').style.display = 'block';
        
        const question = this.questionFlow.getCurrentQuestion();
        if (!question) {
            // 全質問完了
            this.showStep(2);
            return;
        }
        
        this.renderQuestion(question);
    }
    
    renderQuestion(question) {
        // 質問タイトルと説明
        document.getElementById('question-title').textContent = question.title;
        document.getElementById('question-description').textContent = question.description;
        
        // 画像表示
        const imageContainer = document.getElementById('question-image');
        if (question.hasImage && question.imageUrl) {
            const img = document.getElementById('question-img');
            img.src = question.imageUrl;
            img.alt = question.title;
            imageContainer.style.display = 'block';
        } else {
            imageContainer.style.display = 'none';
        }
        
        // 選択肢表示
        this.renderOptions(question);
        
        // ナビゲーションボタン
        this.updateNavigationButtons();
    }
    
    renderOptions(question) {
        const optionsContainer = document.getElementById('question-options');
        optionsContainer.innerHTML = '';
        
        question.options.forEach((option, index) => {
            const optionElement = document.createElement('div');
            optionElement.className = 'question-option';
            
            let optionValue, optionLabel, optionDescription;
            
            if (typeof option === 'string') {
                optionValue = optionLabel = option;
                optionDescription = '';
            } else {
                optionValue = option.value;
                optionLabel = option.label;
                optionDescription = option.description || '';
            }
            
            optionElement.innerHTML = `
                <input type="radio" id="option_${index}" name="question_option" value="${optionValue}">
                <label for="option_${index}" class="option-label">
                    <div class="option-title">${optionLabel}</div>
                    ${optionDescription ? `<div class="option-description">${optionDescription}</div>` : ''}
                </label>
            `;
            
            optionsContainer.appendChild(optionElement);
        });
        
        // 既存の回答があれば選択状態にする
        const currentAnswer = this.questionFlow.answers[question.id];
        if (currentAnswer) {
            const radio = optionsContainer.querySelector(`input[value="${currentAnswer}"]`);
            if (radio) {
                radio.checked = true;
                this.enableNextButton();
            }
        }
        
        // 選択時のイベントリスナー
        optionsContainer.addEventListener('change', (e) => {
            if (e.target.type === 'radio') {
                this.questionFlow.setAnswer(question.id, e.target.value);
                this.enableNextButton();
            }
        });
    }
    
    updateNavigationButtons() {
        const prevBtn = document.getElementById('prev-btn');
        const nextBtn = document.getElementById('next-btn');
        
        // 前へボタン
        if (this.questionFlow.currentQuestionIndex > 0) {
            prevBtn.style.display = 'inline-block';
        } else {
            prevBtn.style.display = 'none';
        }
        
        // 次へボタン
        const currentQuestion = this.questionFlow.getCurrentQuestion();
        const hasAnswer = currentQuestion && this.questionFlow.answers[currentQuestion.id];
        
        if (hasAnswer) {
            this.enableNextButton();
        } else {
            this.disableNextButton();
        }
    }
    
    enableNextButton() {
        const nextBtn = document.getElementById('next-btn');
        nextBtn.disabled = false;
        nextBtn.textContent = this.questionFlow.currentQuestionIndex >= this.questionFlow.getVisibleQuestions().length - 1 ? '見積り結果へ' : '次へ';
    }
    
    disableNextButton() {
        const nextBtn = document.getElementById('next-btn');
        nextBtn.disabled = true;
        nextBtn.textContent = '次へ';
    }
    
    nextQuestion() {
        const nextQuestion = this.questionFlow.nextQuestion();
        if (nextQuestion) {
            this.renderQuestion(nextQuestion);
        } else {
            // 全質問完了
            this.showStep(2);
        }
    }
    
    previousQuestion() {
        const prevQuestion = this.questionFlow.previousQuestion();
        if (prevQuestion) {
            this.renderQuestion(prevQuestion);
        }
    }
    
    showEstimateStep() {
        document.getElementById('step2').style.display = 'block';
        
        // 概算見積り計算
        const estimate = this.questionFlow.calculateEstimate();
        const summary = this.questionFlow.generateSummary();
        
        // 見積り金額表示
        document.getElementById('estimate-amount').textContent = `¥${estimate.totalPrice.toLocaleString()}`;
        
        // 条件サマリー表示
        const summaryContainer = document.getElementById('estimate-summary');
        summaryContainer.innerHTML = summary.map(item => `<div class="summary-item">• ${item}</div>`).join('');
    }
    
    showCustomerInfoStep() {
        document.getElementById('step3').style.display = 'block';
        
        // 既存データがあれば復元
        Object.keys(this.customerData).forEach(key => {
            const input = document.getElementById(key);
            if (input) {
                input.value = this.customerData[key];
            }
        });
    }
    
    showPhotoUploadStep() {
        document.getElementById('step4').style.display = 'block';
        
        // アップロード済み写真を表示
        this.renderPhotoPreview();
    }
    
    showCompleteStep() {
        document.getElementById('complete').style.display = 'block';
    }
    
    async autoFillAddress() {
        const zipcode = document.getElementById('zipcode').value;
        if (zipcode.length !== 7) return;
        
        try {
            const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zipcode}`);
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                const result = data.results[0];
                const address = `${result.address1}${result.address2}${result.address3}`;
                document.getElementById('address1').value = address;
            }
        } catch (error) {
            console.error('住所自動入力エラー:', error);
        }
    }
    
    handlePhotoSelect(event) {
        const files = Array.from(event.target.files);
        
        files.forEach(file => {
            // ファイルサイズチェック（15MB）
            if (file.size > 15 * 1024 * 1024) {
                alert(`${file.name} のファイルサイズが大きすぎます（15MB以下にしてください）`);
                return;
            }
            
            // ファイル形式チェック
            if (!file.type.startsWith('image/')) {
                alert(`${file.name} は画像ファイルではありません`);
                return;
            }
            
            // 最大10枚チェック
            if (this.uploadedPhotos.length >= 10) {
                alert('写真は最大10枚までアップロードできます');
                return;
            }
            
            // Base64エンコード
            const reader = new FileReader();
            reader.onload = (e) => {
                this.uploadedPhotos.push({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    data: e.target.result
                });
                
                this.renderPhotoPreview();
            };
            reader.readAsDataURL(file);
        });
    }
    
    renderPhotoPreview() {
        const previewContainer = document.getElementById('photo-preview');
        if (!previewContainer) return;
        
        previewContainer.innerHTML = '';
        
        this.uploadedPhotos.forEach((photo, index) => {
            const photoElement = document.createElement('div');
            photoElement.className = 'photo-item';
            photoElement.innerHTML = `
                <img src="${photo.data}" alt="${photo.name}">
                <div class="photo-info">
                    <div class="photo-name">${photo.name}</div>
                    <div class="photo-size">${(photo.size / 1024 / 1024).toFixed(1)}MB</div>
                </div>
                <button class="remove-photo" onclick="app.removePhoto(${index})">×</button>
            `;
            previewContainer.appendChild(photoElement);
        });
        
        // 送信ボタンの状態更新
        this.updateSubmitButton();
    }
    
    removePhoto(index) {
        this.uploadedPhotos.splice(index, 1);
        this.renderPhotoPreview();
    }
    
    updateSubmitButton() {
        const submitBtn = document.getElementById('submit-btn');
        if (!submitBtn) return;
        
        const hasRequiredInfo = this.validateCustomerInfo();
        
        submitBtn.disabled = !hasRequiredInfo;
        submitBtn.textContent = hasRequiredInfo ? '送信' : '必須項目を入力してください';
    }
    
    validateCustomerInfo() {
        const requiredFields = ['name', 'phone', 'zipcode', 'address1'];
        
        // フォームデータを収集
        this.customerData = {};
        requiredFields.forEach(field => {
            const input = document.getElementById(field);
            if (input) {
                this.customerData[field] = input.value.trim();
            }
        });
        
        // 住所2も収集（必須ではない）
        const address2Input = document.getElementById('address2');
        if (address2Input) {
            this.customerData.address2 = address2Input.value.trim();
        }
        
        // 必須項目チェック
        return requiredFields.every(field => this.customerData[field]);
    }
    
    async submitForm() {
        if (!this.validateCustomerInfo()) {
            alert('必須項目をすべて入力してください');
            return;
        }
        
        try {
            // ローディング表示
            this.showLoading();
            
            // 送信データ準備
            const submitData = {
                answers: this.questionFlow.answers,
                estimate: this.questionFlow.calculateEstimate(),
                summary: this.questionFlow.generateSummary(),
                customer: this.customerData,
                photos: this.uploadedPhotos,
                timestamp: new Date().toISOString()
            };
            
            // ユーザー情報取得
            if (liff.isLoggedIn()) {
                const profile = await liff.getProfile();
                submitData.lineUser = {
                    userId: profile.userId,
                    displayName: profile.displayName,
                    pictureUrl: profile.pictureUrl
                };
            }
            
            // サーバーに送信
            const response = await fetch('/api/submit-estimate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(submitData)
            });
            
            if (!response.ok) {
                throw new Error(`送信エラー: ${response.status}`);
            }
            
            const result = await response.json();
            console.log('[DEBUG] 送信成功:', result);
            
            // 完了画面表示
            this.showStep(5);
            
        } catch (error) {
            console.error('[ERROR] 送信エラー:', error);
            this.showError('送信に失敗しました: ' + error.message);
        }
    }
    
    updateProgress() {
        const progressFill = document.getElementById('progress-fill');
        const currentStepSpan = document.getElementById('current-step');
        
        if (progressFill && currentStepSpan) {
            const progress = (this.currentStep / 4) * 100;
            progressFill.style.width = `${progress}%`;
            currentStepSpan.textContent = this.currentStep;
        }
    }
}

// グローバル関数（HTMLから呼び出し用）
function nextQuestion() {
    if (window.app) {
        window.app.nextQuestion();
    }
}

function previousQuestion() {
    if (window.app) {
        window.app.previousQuestion();
    }
}

function showStep(stepNumber) {
    if (window.app) {
        window.app.showStep(stepNumber);
    }
}

function submitForm() {
    if (window.app) {
        window.app.submitForm();
    }
}

// アプリ初期化
document.addEventListener('DOMContentLoaded', () => {
    window.app = new LIFFEstimateApp();
});

