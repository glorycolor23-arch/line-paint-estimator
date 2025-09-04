// LIFF見積りアプリ（正しい質問項目版）
console.log('[DEBUG] LIFF見積りアプリ開始');

// 正しい質問データ（12問）
const QUESTIONS = [
    {
        id: 'q1_floors',
        title: '工事物件の階数は？',
        description: '建物の階数を選択してください',
        options: [
            { value: '1階建て', label: '1階建て' },
            { value: '2階建て', label: '2階建て' },
            { value: '3階建て', label: '3階建て' }
        ],
        hasImage: false
    },
    {
        id: 'q2_layout',
        title: '間取りは？',
        description: '建物の間取りを選択してください',
        options: [
            { value: '1K', label: '1K' },
            { value: '1DK', label: '1DK' },
            { value: '1LDK', label: '1LDK' },
            { value: '2K', label: '2K' },
            { value: '2DK', label: '2DK' },
            { value: '2LDK', label: '2LDK' },
            { value: '3K', label: '3K' },
            { value: '3DK', label: '3DK' },
            { value: '4K', label: '4K' },
            { value: '4DK', label: '4DK' },
            { value: '4LDK', label: '4LDK' }
        ],
        hasImage: false
    },
    {
        id: 'q3_age',
        title: '築年数は？',
        description: '建物の築年数を選択してください',
        options: [
            { value: '新築', label: '新築' },
            { value: '〜10年', label: '〜10年' },
            { value: '〜20年', label: '〜20年' },
            { value: '〜30年', label: '〜30年' },
            { value: '〜40年', label: '〜40年' },
            { value: '〜50年', label: '〜50年' },
            { value: '51年以上', label: '51年以上' }
        ],
        hasImage: false
    },
    {
        id: 'q4_painted',
        title: '過去に塗装をしたことはありますか？',
        description: '外壁塗装の経験について教えてください',
        options: [
            { value: 'はい', label: 'はい' },
            { value: 'いいえ', label: 'いいえ' }
        ],
        hasImage: false
    },
    {
        id: 'q5_last',
        title: '前回の塗装から何年経ちましたか？',
        description: '最後に塗装してからの年数を選択してください',
        options: [
            { value: '〜5年', label: '〜5年' },
            { value: '〜10年', label: '〜10年' },
            { value: '〜15年', label: '〜15年' },
            { value: '〜20年', label: '〜20年' },
            { value: '21年以上', label: '21年以上' }
        ],
        hasImage: false,
        condition: (answers) => answers.q4_painted === 'はい'
    },
    {
        id: 'q6_work',
        title: '希望する工事内容は？',
        description: '希望する工事内容を選択してください',
        options: [
            { value: '外壁塗装', label: '外壁塗装のみ' },
            { value: '屋根塗装', label: '屋根塗装のみ' },
            { value: '外壁塗装+屋根塗装', label: '外壁・屋根塗装' }
        ],
        hasImage: false
    },
    {
        id: 'q7_wall',
        title: '外壁材の種類は？',
        description: '現在の外壁材を選択してください',
        options: [
            { 
                value: 'モルタル', 
                label: 'モルタル',
                description: 'セメントと砂を混ぜた塗り壁',
                image: '/images/mortar.jpg'
            },
            { 
                value: 'サイディング', 
                label: 'サイディング',
                description: 'パネル状の外壁材',
                image: '/images/siding.jpg'
            },
            { 
                value: 'タイル', 
                label: 'タイル',
                description: '焼き物の外壁材',
                image: '/images/tile.jpg'
            },
            { 
                value: 'ALC', 
                label: 'ALC',
                description: '軽量気泡コンクリート',
                image: '/images/alc.jpg'
            }
        ],
        hasImage: true,
        condition: (answers) => answers.q6_work === '外壁塗装' || answers.q6_work === '外壁塗装+屋根塗装'
    },
    {
        id: 'q8_roof',
        title: '屋根材の種類は？',
        description: '現在の屋根材を選択してください',
        options: [
            { 
                value: '瓦', 
                label: '瓦',
                description: '粘土瓦・セメント瓦',
                image: '/images/kawara.jpg'
            },
            { 
                value: 'スレート', 
                label: 'スレート',
                description: 'コロニアル・カラーベスト',
                image: '/images/slate.jpg'
            },
            { 
                value: 'ガルバリウム', 
                label: 'ガルバリウム',
                description: '金属屋根材',
                image: '/images/galvalume.jpg'
            },
            { 
                value: 'トタン', 
                label: 'トタン',
                description: '亜鉛メッキ鋼板',
                image: '/images/totan.jpg'
            }
        ],
        hasImage: true,
        condition: (answers) => answers.q6_work === '屋根塗装' || answers.q6_work === '外壁塗装+屋根塗装'
    },
    {
        id: 'q9_leak',
        title: '雨漏りはありますか？',
        description: '雨漏りの状況を教えてください',
        options: [
            { value: '雨の日に水滴が落ちる', label: '雨の日に水滴が落ちる' },
            { value: '天井にシミがある', label: '天井にシミがある' },
            { value: 'ない', label: 'ない' }
        ],
        hasImage: false
    },
    {
        id: 'q10_dist',
        title: '隣家との距離は？',
        description: '隣の建物との距離を選択してください',
        options: [
            { value: '30cm以下', label: '30cm以下' },
            { value: '50cm以下', label: '50cm以下' },
            { value: '70cm以下', label: '70cm以下' },
            { value: '70cm以上', label: '70cm以上' }
        ],
        hasImage: false
    },
    {
        id: 'q11_wall_paint',
        title: '外壁塗料のグレードは？',
        description: '希望する塗料のグレードを選択してください',
        options: [
            { value: 'コストが安い塗料（耐久性 低い）', label: 'コストが安い塗料' },
            { value: '一般的な塗料（コスト 一般的）', label: '一般的な塗料' },
            { value: '耐久性が高い塗料（コスト 高い）', label: '耐久性が高い塗料' },
            { value: '遮熱性が高い（コスト 高い）', label: '遮熱性が高い塗料' }
        ],
        hasImage: false,
        condition: (answers) => answers.q6_work === '外壁塗装' || answers.q6_work === '外壁塗装+屋根塗装'
    },
    {
        id: 'q12_timing',
        title: '希望時期は？',
        description: '工事の希望時期を選択してください',
        options: [
            { value: '1ヶ月以内', label: '1ヶ月以内' },
            { value: '2-3ヶ月以内', label: '2-3ヶ月以内' },
            { value: '半年以内', label: '半年以内' },
            { value: '1年以内', label: '1年以内' },
            { value: '未定', label: '未定' }
        ],
        hasImage: false
    }
];

// QuestionFlowクラス
class QuestionFlow {
    constructor() {
        this.questions = QUESTIONS;
        this.answers = {};
        this.currentIndex = 0;
        console.log('[DEBUG] QuestionFlow初期化完了');
    }

    getCurrentQuestion() {
        const filteredQuestions = this.getFilteredQuestions();
        if (this.currentIndex >= filteredQuestions.length) {
            return null;
        }
        return filteredQuestions[this.currentIndex];
    }

    getFilteredQuestions() {
        return this.questions.filter(q => {
            if (!q.condition) return true;
            return q.condition(this.answers);
        });
    }

    setAnswer(questionId, answer) {
        this.answers[questionId] = answer;
        console.log('[DEBUG] 回答設定:', questionId, '=', answer);
    }

    nextQuestion() {
        this.currentIndex++;
        return this.getCurrentQuestion();
    }

    previousQuestion() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
        }
        return this.getCurrentQuestion();
    }

    isComplete() {
        const filteredQuestions = this.getFilteredQuestions();
        return this.currentIndex >= filteredQuestions.length;
    }

    getProgress() {
        const filteredQuestions = this.getFilteredQuestions();
        return {
            current: Math.min(this.currentIndex + 1, filteredQuestions.length),
            total: filteredQuestions.length
        };
    }

    calculateEstimate() {
        // 概算見積り計算ロジック
        const BASE_PRICE = 1000000; // 基本料金：100万円
        
        const COEFFICIENTS = {
            floors: { '1階建て': 1.0, '2階建て': 1.15, '3階建て': 1.30 },
            layout: { '1K': 0.8, '1DK': 0.85, '1LDK': 0.9, '2K': 1.0, '2DK': 1.05, '2LDK': 1.1, '3K': 1.15, '3DK': 1.2, '4K': 1.25, '4DK': 1.3, '4LDK': 1.35 },
            work: { '外壁塗装': 220000, '屋根塗装': 180000, '外壁塗装+屋根塗装': 380000 },
            wallMaterial: { 'モルタル': 1.0, 'サイディング': 1.05, 'タイル': 1.2, 'ALC': 1.1 },
            wallPaint: { 'コストが安い塗料（耐久性 低い）': 0.8, '一般的な塗料（コスト 一般的）': 1.0, '耐久性が高い塗料（コスト 高い）': 1.3, '遮熱性が高い（コスト 高い）': 1.4 },
            age: { '新築': 0.8, '〜10年': 0.9, '〜20年': 1.0, '〜30年': 1.1, '〜40年': 1.2, '〜50年': 1.3, '51年以上': 1.4 },
            leak: { '雨の日に水滴が落ちる': 150000, '天井にシミがある': 100000, 'ない': 0 },
            distance: { '30cm以下': 1.3, '50cm以下': 1.2, '70cm以下': 1.1, '70cm以上': 1.0 }
        };

        let price = BASE_PRICE;
        
        // 各係数を適用
        if (this.answers.q1_floors && COEFFICIENTS.floors[this.answers.q1_floors]) {
            price *= COEFFICIENTS.floors[this.answers.q1_floors];
        }
        if (this.answers.q2_layout && COEFFICIENTS.layout[this.answers.q2_layout]) {
            price *= COEFFICIENTS.layout[this.answers.q2_layout];
        }
        if (this.answers.q3_age && COEFFICIENTS.age[this.answers.q3_age]) {
            price *= COEFFICIENTS.age[this.answers.q3_age];
        }
        if (this.answers.q6_work && COEFFICIENTS.work[this.answers.q6_work]) {
            price += COEFFICIENTS.work[this.answers.q6_work];
        }
        if (this.answers.q7_wall && COEFFICIENTS.wallMaterial[this.answers.q7_wall]) {
            price *= COEFFICIENTS.wallMaterial[this.answers.q7_wall];
        }
        if (this.answers.q11_wall_paint && COEFFICIENTS.wallPaint[this.answers.q11_wall_paint]) {
            price *= COEFFICIENTS.wallPaint[this.answers.q11_wall_paint];
        }
        if (this.answers.q9_leak && COEFFICIENTS.leak[this.answers.q9_leak]) {
            price += COEFFICIENTS.leak[this.answers.q9_leak];
        }
        if (this.answers.q10_dist && COEFFICIENTS.distance[this.answers.q10_dist]) {
            price *= COEFFICIENTS.distance[this.answers.q10_dist];
        }

        return {
            total: Math.round(price / 10000) * 10000, // 万円単位で丸める
            breakdown: {
                base: BASE_PRICE,
                floors: this.answers.q1_floors,
                layout: this.answers.q2_layout,
                work: this.answers.q6_work,
                wall: this.answers.q7_wall,
                paint: this.answers.q11_wall_paint
            }
        };
    }
}

// LIFFEstimateAppクラス
class LIFFEstimateApp {
    constructor() {
        this.questionFlow = null;
        this.currentStep = 1;
        this.customerData = {};
        this.uploadedPhotos = [];
        this.userId = null;
        
        console.log('[DEBUG] LIFFEstimateApp初期化開始');
        this.init();
    }

    async init() {
        try {
            console.log('[DEBUG] DOM読み込み完了、アプリ初期化開始');
            
            // 質問フロー初期化（LIFF初期化前に実行）
            try {
                this.questionFlow = new QuestionFlow();
                console.log('[DEBUG] QuestionFlow初期化成功');
            } catch (error) {
                console.error('[ERROR] QuestionFlow初期化エラー:', error);
                throw new Error('QuestionFlowの初期化に失敗しました');
            }

            // ローディング表示
            this.showLoading();
            
            // LIFF初期化
            console.log('[DEBUG] LIFF初期化開始');
            await this.initLiff();
            
            // ログイン済み確認
            console.log('[DEBUG] ログイン済み');
            
            // 最初のステップを表示
            console.log('[DEBUG] showStep開始: 1');
            this.showStep(1);
            
            // ローディング非表示
            console.log('[DEBUG] hideLoading開始');
            this.hideLoading();
            
            console.log('[DEBUG] アプリ初期化完了');
            
        } catch (error) {
            console.error('[ERROR] アプリ初期化エラー:', error);
            this.showError('アプリの初期化に失敗しました: ' + error.message);
        }
    }

    async initLiff() {
        try {
            if (!window.ENV || !window.ENV.LIFF_ID) {
                throw new Error('LIFF IDが設定されていません');
            }

            console.log('[DEBUG] LIFF初期化開始:', window.ENV.LIFF_ID);
            
            // ローカルテスト環境の判定
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            
            if (window.ENV.LOCAL_TEST || isLocal) {
                console.log('[DEBUG] ローカルテストモード');
                this.userId = 'test_user_' + Date.now();
                return;
            }

            // 本番環境でのLIFF初期化
            await liff.init({ liffId: window.ENV.LIFF_ID });
            console.log('[DEBUG] LIFF初期化成功');

            if (!liff.isLoggedIn()) {
                console.log('[DEBUG] ログインが必要です');
                liff.login();
                return;
            }

            // ユーザー情報取得
            const profile = await liff.getProfile();
            this.userId = profile.userId;
            console.log('[DEBUG] ユーザー情報取得成功:', this.userId);

        } catch (error) {
            console.error('[ERROR] LIFF初期化エラー:', error);
            throw error;
        }
    }

    showLoading() {
        console.log('[DEBUG] ローディング表示');
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = 'flex';
        }
    }

    hideLoading() {
        console.log('[DEBUG] ローディング非表示');
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = 'none';
            console.log('[DEBUG] ローディング非表示成功');
        } else {
            console.error('[ERROR] loading要素が見つかりません');
        }
    }

    showError(message) {
        console.error('[ERROR] エラー表示:', message);
        this.hideLoading();
        
        const errorDiv = document.getElementById('error');
        const errorMessage = document.getElementById('error-message');
        
        if (errorDiv && errorMessage) {
            errorMessage.textContent = message;
            errorDiv.style.display = 'block';
        }
    }

    showStep(stepNumber) {
        console.log('[DEBUG] showStep開始:', stepNumber);
        
        // 全てのステップを非表示
        const steps = document.querySelectorAll('.step');
        steps.forEach(step => {
            step.style.display = 'none';
        });
        
        // 指定されたステップを表示
        const targetStep = document.getElementById(`step${stepNumber}`);
        if (targetStep) {
            targetStep.style.display = 'block';
            console.log('[DEBUG] step' + stepNumber + '表示成功');
        } else {
            console.error('[ERROR] step' + stepNumber + '要素が見つかりません');
            return;
        }
        
        this.currentStep = stepNumber;
        this.updateProgress();
        
        // ステップ別の処理
        if (stepNumber === 1) {
            console.log('[DEBUG] 質問ステップを表示');
            this.showQuestionStep();
        } else if (stepNumber === 2) {
            console.log('[DEBUG] 見積りステップを表示');
            this.showEstimateStep();
        }
        
        console.log('[DEBUG] showStep完了: ' + stepNumber);
    }

    showQuestionStep() {
        console.log('[DEBUG] showQuestionStep開始');
        
        const question = this.questionFlow.getCurrentQuestion();
        console.log('[DEBUG] 現在の質問:', question);
        
        if (!question) {
            console.log('[DEBUG] 質問完了、見積りステップへ');
            this.showStep(2);
            return;
        }
        
        this.renderQuestion(question);
        this.updateNavigationButtons();
        
        console.log('[DEBUG] showQuestionStep完了');
    }

    renderQuestion(question) {
        console.log('[DEBUG] renderQuestion開始:', question.id);
        
        // 質問タイトル設定
        const titleElement = document.getElementById('question-title');
        if (titleElement) {
            titleElement.textContent = question.title;
            console.log('[DEBUG] 質問タイトル設定:', question.title);
        }
        
        // 質問説明設定
        const descElement = document.getElementById('question-description');
        if (descElement) {
            descElement.textContent = question.description;
            console.log('[DEBUG] 質問説明設定:', question.description);
        }
        
        // 画像表示
        const imageContainer = document.getElementById('question-image');
        if (question.hasImage && imageContainer) {
            imageContainer.style.display = 'block';
            console.log('[DEBUG] 質問画像表示');
        } else if (imageContainer) {
            imageContainer.style.display = 'none';
        }
        
        // 選択肢レンダリング
        console.log('[DEBUG] 選択肢レンダリング開始');
        this.renderOptions(question);
        
        console.log('[DEBUG] renderQuestion完了');
    }

    renderOptions(question) {
        console.log('[DEBUG] renderOptions開始:', question.options.length, '個の選択肢');
        
        const container = document.getElementById('question-options');
        if (!container) {
            console.error('[ERROR] question-options要素が見つかりません');
            return;
        }
        
        // 既存の選択肢をクリア
        container.innerHTML = '';
        console.log('[DEBUG] 既存の選択肢をクリア');
        
        question.options.forEach((option, index) => {
            console.log('[DEBUG] 選択肢作成:', index, option.value);
            
            const optionElement = document.createElement('div');
            optionElement.className = 'option-card';
            
            if (question.hasImage && option.image) {
                // 画像付きオプション
                optionElement.innerHTML = `
                    <div class="option-image">
                        <img src="${option.image}" alt="${option.label}" onerror="this.style.display='none'">
                    </div>
                    <div class="option-content">
                        <h4>${option.label}</h4>
                        ${option.description ? `<p>${option.description}</p>` : ''}
                    </div>
                `;
            } else {
                // テキストのみオプション
                optionElement.innerHTML = `
                    <div class="option-content">
                        <h4>${option.label}</h4>
                        ${option.description ? `<p>${option.description}</p>` : ''}
                    </div>
                `;
            }
            
            // クリックイベント
            optionElement.addEventListener('click', () => {
                console.log('[DEBUG] 選択肢選択:', option.value);
                this.selectOption(question.id, option.value);
            });
            
            container.appendChild(optionElement);
            console.log('[DEBUG] 選択肢追加完了:', index);
        });
        
        console.log('[DEBUG] renderOptions完了、選択肢数:', question.options.length);
    }

    selectOption(questionId, value) {
        console.log('[DEBUG] selectOption:', questionId, '=', value);
        
        // 回答を保存
        this.questionFlow.setAnswer(questionId, value);
        
        // 選択状態を視覚的に表示
        const options = document.querySelectorAll('.option-card');
        options.forEach(option => {
            option.classList.remove('selected');
        });
        
        // クリックされた選択肢をハイライト
        event.target.closest('.option-card').classList.add('selected');
        
        // 次へボタンを有効化
        const nextBtn = document.getElementById('next-btn');
        if (nextBtn) {
            nextBtn.disabled = false;
        }
        
        console.log('[DEBUG] 選択完了');
    }

    updateNavigationButtons() {
        const prevBtn = document.getElementById('prev-btn');
        const nextBtn = document.getElementById('next-btn');
        
        if (prevBtn) {
            prevBtn.style.display = this.questionFlow.currentIndex > 0 ? 'inline-block' : 'none';
        }
        
        if (nextBtn) {
            nextBtn.disabled = true; // 選択するまで無効
            nextBtn.textContent = this.questionFlow.isComplete() ? '見積り結果へ' : '次へ';
        }
    }

    nextQuestion() {
        console.log('[DEBUG] nextQuestion');
        
        if (this.questionFlow.isComplete()) {
            this.showStep(2);
            return;
        }
        
        this.questionFlow.nextQuestion();
        this.showQuestionStep();
    }

    previousQuestion() {
        console.log('[DEBUG] previousQuestion');
        
        this.questionFlow.previousQuestion();
        this.showQuestionStep();
    }

    showEstimateStep() {
        console.log('[DEBUG] showEstimateStep開始');
        
        const estimate = this.questionFlow.calculateEstimate();
        console.log('[DEBUG] 概算見積り:', estimate);
        
        // 見積り金額表示
        const amountElement = document.getElementById('estimate-amount');
        if (amountElement) {
            amountElement.textContent = `¥${estimate.total.toLocaleString()}`;
        }
        
        // 見積り詳細表示
        const summaryElement = document.getElementById('estimate-summary');
        if (summaryElement) {
            const details = this.generateEstimateDetails();
            summaryElement.innerHTML = details;
        }
        
        console.log('[DEBUG] showEstimateStep完了');
    }

    generateEstimateDetails() {
        const answers = this.questionFlow.answers;
        const details = [];
        
        if (answers.q1_floors) details.push(`階数: ${answers.q1_floors}`);
        if (answers.q2_layout) details.push(`間取り: ${answers.q2_layout}`);
        if (answers.q3_age) details.push(`築年数: ${answers.q3_age}`);
        if (answers.q6_work) details.push(`工事内容: ${answers.q6_work}`);
        if (answers.q7_wall) details.push(`外壁材: ${answers.q7_wall}`);
        if (answers.q8_roof) details.push(`屋根材: ${answers.q8_roof}`);
        if (answers.q11_wall_paint) details.push(`塗料: ${answers.q11_wall_paint}`);
        if (answers.q12_timing) details.push(`希望時期: ${answers.q12_timing}`);
        
        return `
            <div class="estimate-details">
                <h3>見積り条件</h3>
                <ul>
                    ${details.map(detail => `<li>${detail}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    updateProgress() {
        const progress = this.questionFlow ? this.questionFlow.getProgress() : { current: this.currentStep, total: 4 };
        
        const currentStepElement = document.getElementById('current-step');
        const totalStepsElement = document.getElementById('total-steps');
        const progressFill = document.getElementById('progress-fill');
        
        if (currentStepElement) currentStepElement.textContent = progress.current;
        if (totalStepsElement) totalStepsElement.textContent = progress.total;
        if (progressFill) {
            const percentage = (progress.current / progress.total) * 100;
            progressFill.style.width = `${percentage}%`;
        }
    }

    async submitForm() {
        console.log('[DEBUG] submitForm開始');
        
        try {
            // 顧客情報取得
            const formData = new FormData();
            formData.append('userId', this.userId);
            formData.append('name', document.getElementById('name').value);
            formData.append('phone', document.getElementById('phone').value);
            formData.append('zipcode', document.getElementById('zipcode').value);
            formData.append('address1', document.getElementById('address1').value);
            formData.append('address2', document.getElementById('address2').value);
            formData.append('answers', JSON.stringify(this.questionFlow.answers));
            formData.append('estimate', JSON.stringify(this.questionFlow.calculateEstimate()));
            
            // 写真データ追加
            this.uploadedPhotos.forEach((photo, index) => {
                formData.append('photos', photo);
            });
            
            console.log('[DEBUG] 送信データ準備完了');
            
            // サーバーに送信
            const response = await fetch('/api/submit', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `送信エラー: ${response.status}`);
            }
            
            console.log('[DEBUG] 送信成功');
            this.showStep(5); // 完了画面
            
        } catch (error) {
            console.error('[ERROR] 送信エラー:', error);
            this.showError('送信に失敗しました: ' + error.message);
        }
    }
}

// グローバル関数（HTMLから呼び出し用）
window.nextQuestion = function() {
    if (window.liffApp) {
        window.liffApp.nextQuestion();
    }
};

window.previousQuestion = function() {
    if (window.liffApp) {
        window.liffApp.previousQuestion();
    }
};

window.showStep = function(step) {
    if (window.liffApp) {
        window.liffApp.showStep(step);
    }
};

window.submitForm = function() {
    if (window.liffApp) {
        window.liffApp.submitForm();
    }
};

// DOM読み込み完了後にアプリ初期化
document.addEventListener('DOMContentLoaded', function() {
    console.log('[DEBUG] DOM読み込み完了、アプリ初期化開始');
    window.liffApp = new LIFFEstimateApp();
});

