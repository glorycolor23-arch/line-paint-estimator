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
        options: ['外壁塗装のみ', '屋根塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'],
        hasImage: false
    },
    {
        id: 'q5_wall_area',
        title: '外壁の面積は？',
        description: '建物の外壁面積を選択してください',
        options: ['100㎡未満', '100-150㎡', '151-200㎡', '201-250㎡', '251㎡以上'],
        hasImage: false,
        condition: (answers) => ['外壁塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(answers.q4_work_type)
    },
    {
        id: 'q6_roof_area',
        title: '屋根の面積は？',
        description: '建物の屋根面積を選択してください',
        options: ['50㎡未満', '50-80㎡', '81-120㎡', '121-150㎡', '151㎡以上'],
        hasImage: false,
        condition: (answers) => ['屋根塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(answers.q4_work_type)
    },
    {
        id: 'q7_wall_material',
        title: '外壁の種類は？',
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
        condition: (answers) => ['外壁塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(answers.q4_work_type)
    },
    {
        id: 'q8_roof_material',
        title: '屋根の種類は？',
        description: '現在の屋根材を選択してください',
        options: [
            { 
                value: '瓦', 
                label: '瓦', 
                description: '粘土を焼いた伝統的な屋根材',
                image: '/images/kawara.jpg'
            },
            { 
                value: 'スレート', 
                label: 'スレート', 
                description: 'セメント系の薄い板状屋根材',
                image: '/images/slate.jpg'
            },
            { 
                value: 'ガルバリウム', 
                label: 'ガルバリウム', 
                description: '金属系の軽量屋根材',
                image: '/images/galvalume.jpg'
            },
            { 
                value: 'トタン', 
                label: 'トタン', 
                description: '亜鉛メッキ鋼板の屋根材',
                image: '/images/totan.jpg'
            }
        ],
        hasImage: true,
        condition: (answers) => ['屋根塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(answers.q4_work_type)
    },
    {
        id: 'q9_wall_condition',
        title: '外壁の状態は？',
        description: '現在の外壁の劣化状況を選択してください',
        options: ['良好', '軽微な汚れ・色あせ', 'ひび割れ・剥がれ', '重度の劣化'],
        hasImage: false,
        condition: (answers) => ['外壁塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(answers.q4_work_type)
    },
    {
        id: 'q10_roof_condition',
        title: '屋根の状態は？',
        description: '現在の屋根の劣化状況を選択してください',
        options: ['良好', '軽微な汚れ・色あせ', 'ひび割れ・剥がれ', '重度の劣化'],
        hasImage: false,
        condition: (answers) => ['屋根塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(answers.q4_work_type)
    },
    {
        id: 'q11_paint_grade',
        title: '塗料のグレードは？',
        description: '希望する塗料のグレードを選択してください',
        options: [
            { value: 'スタンダード', label: 'スタンダード', description: 'アクリル・ウレタン系（耐用年数5-8年）' },
            { value: 'ハイグレード', label: 'ハイグレード', description: 'シリコン系（耐用年数10-12年）' },
            { value: 'プレミアム', label: 'プレミアム', description: 'フッ素・無機系（耐用年数15-20年）' }
        ],
        hasImage: false
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
        return this.questions.filter(q => {
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
    
    // 概算見積り計算
    calculateEstimate() {
        const answers = this.answers;
        let totalPrice = 0;
        let breakdown = {};
        
        // 基本価格の設定
        const basePrices = {
            floors: {
                '1階建て': 50000,
                '2階建て': 80000,
                '3階建て': 120000,
                '4階建て以上': 160000
            },
            rooms: {
                '1K・1DK': 1.0,
                '1LDK・2K・2DK': 1.2,
                '2LDK・3K・3DK': 1.4,
                '3LDK・4K・4DK': 1.6,
                '4LDK以上': 1.8
            },
            age: {
                '5年未満': 1.0,
                '5-10年': 1.1,
                '11-15年': 1.2,
                '16-20年': 1.3,
                '21年以上': 1.4
            }
        };
        
        // 外壁塗装価格
        if (['外壁塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(answers.q4_work_type)) {
            const wallAreaPrices = {
                '100㎡未満': 400000,
                '100-150㎡': 600000,
                '151-200㎡': 800000,
                '201-250㎡': 1000000,
                '251㎡以上': 1200000
            };
            
            const wallMaterialMultiplier = {
                'モルタル': 1.0,
                'サイディング': 1.1,
                'タイル': 1.3,
                'ALC': 1.2
            };
            
            const wallConditionMultiplier = {
                '良好': 1.0,
                '軽微な汚れ・色あせ': 1.1,
                'ひび割れ・剥がれ': 1.3,
                '重度の劣化': 1.5
            };
            
            let wallPrice = wallAreaPrices[answers.q5_wall_area] || 600000;
            wallPrice *= wallMaterialMultiplier[answers.q7_wall_material] || 1.0;
            wallPrice *= wallConditionMultiplier[answers.q9_wall_condition] || 1.0;
            
            breakdown.wall = Math.round(wallPrice);
            totalPrice += breakdown.wall;
        }
        
        // 屋根塗装価格
        if (['屋根塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(answers.q4_work_type)) {
            const roofAreaPrices = {
                '50㎡未満': 200000,
                '50-80㎡': 300000,
                '81-120㎡': 400000,
                '121-150㎡': 500000,
                '151㎡以上': 600000
            };
            
            const roofMaterialMultiplier = {
                '瓦': 1.2,
                'スレート': 1.0,
                'ガルバリウム': 1.1,
                'トタン': 0.9
            };
            
            const roofConditionMultiplier = {
                '良好': 1.0,
                '軽微な汚れ・色あせ': 1.1,
                'ひび割れ・剥がれ': 1.3,
                '重度の劣化': 1.5
            };
            
            let roofPrice = roofAreaPrices[answers.q6_roof_area] || 300000;
            roofPrice *= roofMaterialMultiplier[answers.q8_roof_material] || 1.0;
            roofPrice *= roofConditionMultiplier[answers.q10_roof_condition] || 1.0;
            
            breakdown.roof = Math.round(roofPrice);
            totalPrice += breakdown.roof;
        }
        
        // 付帯部塗装価格
        if (answers.q4_work_type === '外壁・屋根・付帯部塗装') {
            breakdown.additional = 150000;
            totalPrice += breakdown.additional;
        }
        
        // 塗料グレード調整
        const paintGradeMultiplier = {
            'スタンダード': 1.0,
            'ハイグレード': 1.3,
            'プレミアム': 1.6
        };
        
        totalPrice *= paintGradeMultiplier[answers.q11_paint_grade] || 1.0;
        
        // 築年数・間取り調整
        totalPrice *= basePrices.rooms[answers.q2_rooms] || 1.0;
        totalPrice *= basePrices.age[answers.q3_age] || 1.0;
        
        return {
            total: Math.round(totalPrice),
            breakdown: breakdown
        };
    }
    
    // 回答サマリー生成
    generateSummary() {
        const answers = this.answers;
        const summary = [];
        
        // 基本情報
        if (answers.q1_floors) summary.push(`階数: ${answers.q1_floors}`);
        if (answers.q2_rooms) summary.push(`間取り: ${answers.q2_rooms}`);
        if (answers.q3_age) summary.push(`築年数: ${answers.q3_age}`);
        if (answers.q4_work_type) summary.push(`工事内容: ${answers.q4_work_type}`);
        
        // 外壁情報
        if (answers.q5_wall_area) summary.push(`外壁面積: ${answers.q5_wall_area}`);
        if (answers.q7_wall_material) summary.push(`外壁材: ${answers.q7_wall_material}`);
        if (answers.q9_wall_condition) summary.push(`外壁状態: ${answers.q9_wall_condition}`);
        
        // 屋根情報
        if (answers.q6_roof_area) summary.push(`屋根面積: ${answers.q6_roof_area}`);
        if (answers.q8_roof_material) summary.push(`屋根材: ${answers.q8_roof_material}`);
        if (answers.q10_roof_condition) summary.push(`屋根状態: ${answers.q10_roof_condition}`);
        
        // 塗料・時期
        if (answers.q11_paint_grade) summary.push(`塗料グレード: ${answers.q11_paint_grade}`);
        if (answers.q12_urgency) summary.push(`希望時期: ${answers.q12_urgency}`);
        
        return summary;
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
            
            // ローディング表示
            this.showLoading();
            
            // 質問フロー初期化（LIFF初期化前に実行）
            try {
                this.questionFlow = new QuestionFlow();
                console.log('[DEBUG] QuestionFlow初期化成功');
            } catch (error) {
                console.error('[ERROR] QuestionFlow初期化エラー:', error);
                throw new Error('QuestionFlowの初期化に失敗しました');
            }
            
            // LIFF初期化
            await this.initLIFF();
            
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
        // ローカルテスト用：LIFF_IDが設定されていない場合はスキップ
        if (!this.liffId || this.liffId === 'dummy_liff_id') {
            console.log('[DEBUG] ローカルテストモード：LIFF初期化をスキップ');
            return;
        }
        
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
            zipcodeInput.addEventListener('input', (e) => this.handlePostalCodeInput(e.target.value));
        }
        
        // 写真アップロード
        const photoInput = document.getElementById('photo-input');
        const albumInput = document.getElementById('album-input');
        const dropZone = document.getElementById('drop-zone');
        const cameraBtn = document.querySelector('.camera-btn');
        const albumBtn = document.querySelectorAll('.camera-btn')[1];
        
        if (photoInput && dropZone) {
            // カメラボタン
            if (cameraBtn) {
                cameraBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    photoInput.click();
                });
            }
            
            // アルバムボタン
            if (albumBtn) {
                albumBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    albumInput.click();
                });
            }
            
            photoInput.addEventListener('change', (e) => this.handlePhotoSelect(e));
            albumInput.addEventListener('change', (e) => this.handlePhotoSelect(e));
            
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
            
            dropZone.addEventListener('click', () => {
                albumInput.click();
            });
        }
    }
    
    showLoading() {
        console.log('[DEBUG] showLoading開始');
        const loadingElement = document.getElementById('loading');
        if (loadingElement) {
            loadingElement.style.display = 'block';
            console.log('[DEBUG] ローディング表示');
        } else {
            console.error('[ERROR] loading要素が見つかりません');
        }
        this.hideAllSteps();
    }
    
    hideLoading() {
        console.log('[DEBUG] hideLoading開始');
        const loadingElement = document.getElementById('loading');
        if (loadingElement) {
            loadingElement.style.display = 'none';
            console.log('[DEBUG] ローディング非表示');
        } else {
            console.error('[ERROR] loading要素が見つかりません');
        }
    }
    
    showError(message) {
        this.hideLoading();
        this.hideAllSteps();
        
        const errorMessage = document.getElementById('error-message');
        const errorElement = document.getElementById('error');
        
        if (errorMessage) errorMessage.textContent = message;
        if (errorElement) errorElement.style.display = 'block';
    }
    
    hideAllSteps() {
        ['step1', 'step2', 'step3', 'step4', 'complete'].forEach(stepId => {
            const element = document.getElementById(stepId);
            if (element) element.style.display = 'none';
        });
    }
    
    showStep(stepNumber) {
        console.log('[DEBUG] showStep開始:', stepNumber);
        
        this.hideLoading();
        this.hideAllSteps();
        
        this.currentStep = stepNumber;
        
        switch (stepNumber) {
            case 1:
                console.log('[DEBUG] 質問ステップを表示');
                this.showQuestionStep();
                break;
            case 2:
                console.log('[DEBUG] 見積りステップを表示');
                this.showEstimateStep();
                break;
            case 3:
                console.log('[DEBUG] 顧客情報ステップを表示');
                this.showCustomerInfoStep();
                break;
            case 4:
                console.log('[DEBUG] 写真アップロードステップを表示');
                this.showPhotoUploadStep();
                break;
            case 5:
                console.log('[DEBUG] 完了ステップを表示');
                this.showCompleteStep();
                break;
        }
        
        this.updateProgress();
        console.log('[DEBUG] showStep完了:', stepNumber);
    }
    
    showQuestionStep() {
        console.log('[DEBUG] showQuestionStep開始');
        
        const step1Element = document.getElementById('step1');
        if (!step1Element) {
            console.error('[ERROR] step1要素が見つかりません');
            return;
        }
        
        step1Element.style.display = 'block';
        console.log('[DEBUG] step1要素を表示');
        
        const question = this.questionFlow.getCurrentQuestion();
        if (!question) {
            console.log('[DEBUG] 全質問完了、見積りステップへ');
            // 全質問完了
            this.showStep(2);
            return;
        }
        
        console.log('[DEBUG] 現在の質問:', question);
        this.renderQuestion(question);
    }
    
    renderQuestion(question) {
        console.log('[DEBUG] renderQuestion開始:', question);
        
        // 質問タイトルと説明
        const questionTitle = document.getElementById('question-title');
        const questionDescription = document.getElementById('question-description');
        
        if (questionTitle) {
            questionTitle.textContent = question.title;
            console.log('[DEBUG] 質問タイトル設定:', question.title);
        } else {
            console.error('[ERROR] question-title要素が見つかりません');
        }
        
        if (questionDescription) {
            questionDescription.textContent = question.description;
            console.log('[DEBUG] 質問説明設定:', question.description);
        } else {
            console.error('[ERROR] question-description要素が見つかりません');
        }
        
        // 選択肢表示
        console.log('[DEBUG] 選択肢レンダリング開始');
        this.renderOptions(question);
        
        // ナビゲーションボタン
        console.log('[DEBUG] ナビゲーションボタン更新開始');
        this.updateNavigationButtons();
        
        console.log('[DEBUG] renderQuestion完了');
    }
    
    renderOptions(question) {
        console.log('[DEBUG] renderOptions開始:', question.options);
        
        const optionsContainer = document.getElementById('question-options');
        if (!optionsContainer) {
            console.error('[ERROR] question-options要素が見つかりません');
            return;
        }
        
        optionsContainer.innerHTML = '';
        console.log('[DEBUG] 既存の選択肢をクリア');
        
        // CSSクラスをリセット
        optionsContainer.className = 'question-options';
        
        // 1〜4階建ては"詰める"
        if (question.id === 'q1_floors') {
            optionsContainer.classList.add('compact');
        }
        
        // 画像付きの質問は"2カラム"にする（修正：正しく適用）
        const twoColIds = ['q7_wall_material', 'q8_roof_material'];
        if (twoColIds.includes(question.id)) {
            optionsContainer.classList.add('two-col');
            console.log('[DEBUG] 2カラムレイアウト適用:', question.id);
        }
        
        question.options.forEach((option, index) => {
            console.log('[DEBUG] 選択肢作成:', index, option);
            
            const optionElement = document.createElement('div');
            optionElement.className = 'question-option';
            
            let optionValue, optionLabel, optionDescription, optionImage;
            
            if (typeof option === 'string') {
                optionValue = optionLabel = option;
                optionDescription = '';
                optionImage = null;
            } else {
                optionValue = option.value;
                optionLabel = option.label;
                optionDescription = option.description || '';
                optionImage = option.image || null;
            }
            
            // 画像付きボタンの場合
            if (optionImage) {
                optionElement.innerHTML = `
                    <input type="radio" id="option_${index}" name="question_option" value="${optionValue}">
                    <label for="option_${index}" class="option-label image-option">
                        <div class="option-image">
                            <img src="${optionImage}" alt="${optionLabel}" onerror="this.style.display='none'">
                        </div>
                        <div class="option-content">
                            <div class="option-title">${optionLabel}</div>
                            <div class="option-description">${optionDescription}</div>
                        </div>
                    </label>
                `;
            } else {
                // 通常のボタン
                optionElement.innerHTML = `
                    <input type="radio" id="option_${index}" name="question_option" value="${optionValue}">
                    <label for="option_${index}" class="option-label">
                        <div class="option-title">${optionLabel}</div>
                        ${optionDescription ? `<div class="option-description">${optionDescription}</div>` : ''}
                    </label>
                `;
            }
            
            optionsContainer.appendChild(optionElement);
            console.log('[DEBUG] 選択肢追加完了:', index);
            
            // 選択イベントリスナー
            const radioInput = optionElement.querySelector('input[type="radio"]');
            radioInput.addEventListener('change', () => {
                console.log('[DEBUG] 選択肢変更:', optionValue);
                this.questionFlow.setAnswer(question.id, optionValue);
                this.updateNavigationButtons();
            });
        });
        
        console.log('[DEBUG] renderOptions完了、選択肢数:', question.options.length);
    }
    
    updateNavigationButtons() {
        const prevBtn = document.getElementById('prev-btn');
        const nextBtn = document.getElementById('next-btn');
        
        if (prevBtn) {
            prevBtn.style.display = this.questionFlow.currentQuestionIndex > 0 ? 'block' : 'none';
        }
        
        if (nextBtn) {
            const currentQuestion = this.questionFlow.getCurrentQuestion();
            const hasAnswer = currentQuestion && this.questionFlow.answers[currentQuestion.id];
            
            nextBtn.disabled = !hasAnswer;
            nextBtn.textContent = this.questionFlow.isComplete() ? '見積り結果へ' : '次へ';
        }
    }
    
    nextQuestion() {
        const currentQuestion = this.questionFlow.getCurrentQuestion();
        if (!currentQuestion || !this.questionFlow.answers[currentQuestion.id]) {
            return;
        }
        
        if (this.questionFlow.isComplete()) {
            // 全質問完了、見積り画面へ
            this.showStep(2);
        } else {
            // 次の質問へ
            this.questionFlow.nextQuestion();
            this.renderQuestion(this.questionFlow.getCurrentQuestion());
        }
    }
    
    previousQuestion() {
        this.questionFlow.previousQuestion();
        this.renderQuestion(this.questionFlow.getCurrentQuestion());
    }
    
    showEstimateStep() {
        const step2Element = document.getElementById('step2');
        if (step2Element) {
            step2Element.style.display = 'block';
        }
        
        // 概算見積り計算
        const estimate = this.questionFlow.calculateEstimate();
        
        // 見積り金額表示
        const priceElement = document.getElementById('estimate-price');
        if (priceElement) {
            priceElement.textContent = `¥${estimate.total.toLocaleString()}`;
        }
        
        // 詳細表示
        const detailsContainer = document.getElementById('estimate-details');
        if (detailsContainer) {
            let detailsHtml = '<div class="estimate-breakdown">';
            
            if (estimate.breakdown.wall) {
                detailsHtml += `<div class="breakdown-item"><span>外壁塗装</span><span>¥${estimate.breakdown.wall.toLocaleString()}</span></div>`;
            }
            if (estimate.breakdown.roof) {
                detailsHtml += `<div class="breakdown-item"><span>屋根塗装</span><span>¥${estimate.breakdown.roof.toLocaleString()}</span></div>`;
            }
            if (estimate.breakdown.additional) {
                detailsHtml += `<div class="breakdown-item"><span>付帯部塗装</span><span>¥${estimate.breakdown.additional.toLocaleString()}</span></div>`;
            }
            
            detailsHtml += `<div class="breakdown-item total"><span>合計</span><span>¥${estimate.total.toLocaleString()}</span></div>`;
            detailsHtml += '</div>';
            detailsHtml += '<div class="estimate-note">※上記は概算金額です。正確な見積りには現地調査が必要です。</div>';
            
            detailsContainer.innerHTML = detailsHtml;
        }
    }
    
    showCustomerInfoStep() {
        const step3Element = document.getElementById('step3');
        if (step3Element) {
            step3Element.style.display = 'block';
        }
        
        // 既存データがあれば復元
        Object.keys(this.customerData).forEach(key => {
            const input = document.getElementById(key);
            if (input) {
                input.value = this.customerData[key];
            }
        });
    }
    
    showPhotoUploadStep() {
        const step4Element = document.getElementById('step4');
        if (step4Element) {
            step4Element.style.display = 'block';
        }
        
        // アップロード済み写真を表示
        this.renderPhotoPreview();
    }
    
    showCompleteStep() {
        const completeElement = document.getElementById('complete');
        if (completeElement) {
            completeElement.style.display = 'block';
        }
    }
    
    async handlePostalCodeInput(postalCode) {
        // 7桁の数字が入力されたら住所を自動取得
        if (postalCode.length === 7 && /^\d{7}$/.test(postalCode)) {
            console.log('[DEBUG] 郵便番号自動入力:', postalCode);
            
            try {
                const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${postalCode}`);
                const data = await response.json();
                
                if (data.status === 200 && data.results && data.results.length > 0) {
                    const result = data.results[0];
                    const address = result.address1 + result.address2 + result.address3;
                    
                    // 住所フィールドに自動入力
                    const addressInput = document.getElementById('address1');
                    if (addressInput) {
                        addressInput.value = address;
                        this.customerData.address1 = address;
                        console.log('[DEBUG] 住所自動入力成功:', address);
                    }
                } else {
                    console.log('[DEBUG] 郵便番号が見つかりません:', postalCode);
                }
            } catch (error) {
                console.error('[ERROR] 郵便番号API エラー:', error);
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
                const result = data.results[0];
                const address = `${result.address1}${result.address2}${result.address3}`;
                const address1Input = document.getElementById('address1');
                if (address1Input) {
                    address1Input.value = address;
                    this.customerData.address1 = address;
                }
            }
        } catch (error) {
            console.error('住所自動入力エラー:', error);
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
                    photoType: selectedType,
                    data: e.target.result
                });
                
                this.renderPhotoPreview();
                this.updateSubmitButton();
            };
            reader.readAsDataURL(file);
        });
        
        // 写真種類をリセット
        if (photoTypeSelect) {
            photoTypeSelect.value = '';
        }
    }
    
    renderPhotoPreview() {
        const previewContainer = document.getElementById('photo-preview');
        if (!previewContainer) return;
        
        previewContainer.innerHTML = '';
        
        this.uploadedPhotos.forEach((photo, index) => {
            const photoElement = document.createElement('div');
            photoElement.className = 'photo-item';
            
            // 写真種類のラベル取得
            const photoTypeLabels = {
                'facade': '外観正面',
                'side': '外観側面',
                'back': '外観背面',
                'roof': '屋根全体',
                'wall_detail': '外壁詳細',
                'damage': '損傷箇所',
                'floor_plan': '平面図',
                'elevation': '立面図',
                'other': 'その他'
            };
            
            const typeLabel = photoTypeLabels[photo.photoType] || photo.photoType;
            
            photoElement.innerHTML = `
                <img src="${photo.data}" alt="${photo.name}">
                <div class="photo-info">
                    <div class="photo-type">${typeLabel}</div>
                    <div class="photo-name">${photo.name}</div>
                    <div class="photo-size">${(photo.size / 1024 / 1024).toFixed(1)}MB</div>
                </div>
                <button class="remove-photo" onclick="window.app.removePhoto(${index})">×</button>
            `;
            
            previewContainer.appendChild(photoElement);
        });
    }
    
    removePhoto(index) {
        this.uploadedPhotos.splice(index, 1);
        this.renderPhotoPreview();
        this.updateSubmitButton();
    }
    
    updateSubmitButton() {
        const submitBtn = document.getElementById('submit-btn');
        if (submitBtn) {
            const hasPhotos = this.uploadedPhotos.length > 0;
            
            if (hasPhotos) {
                submitBtn.disabled = false;
                submitBtn.classList.remove('disabled');
                submitBtn.textContent = 'この内容で送信する';
            } else {
                submitBtn.disabled = true;
                submitBtn.classList.add('disabled');
                submitBtn.textContent = '写真をアップロードしてください';
            }
        }
    }
    
    async submitForm() {
        try {
            // 顧客データ収集
            ['name', 'phone', 'zipcode', 'address1', 'address2'].forEach(fieldId => {
                const input = document.getElementById(fieldId);
                if (input) {
                    this.customerData[fieldId] = input.value;
                }
            });
            
            // 必須項目チェック
            const requiredFields = ['name', 'phone', 'zipcode', 'address1'];
            const missingFields = requiredFields.filter(field => !this.customerData[field]);
            
            if (missingFields.length > 0) {
                alert('必須項目が入力されていません: ' + missingFields.join(', '));
                return;
            }
            
            // LINEユーザー情報取得
            let lineUserId = 'local_test_user';
            if (window.liff && liff.isLoggedIn()) {
                try {
                    const profile = await liff.getProfile();
                    lineUserId = profile.userId;
                } catch (error) {
                    console.warn('LINEプロフィール取得エラー:', error);
                }
            }
            
            // FormData作成
            const formData = new FormData();
            formData.append('userId', lineUserId);
            formData.append('name', this.customerData.name);
            formData.append('phone', this.customerData.phone);
            formData.append('zipcode', this.customerData.zipcode);
            formData.append('address1', this.customerData.address1);
            formData.append('address2', this.customerData.address2 || '');
            
            // 質問回答データを追加
            formData.append('answers', JSON.stringify(this.questionFlow.answers));
            formData.append('estimate', JSON.stringify(this.questionFlow.calculateEstimate()));
            
            // 写真を追加
            this.uploadedPhotos.forEach((photo, index) => {
                // Base64データをBlobに変換
                const byteCharacters = atob(photo.data.split(',')[1]);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: photo.type });
                formData.append('photos', blob, photo.name);
            });
            
            // サーバーに送信
            const response = await fetch('/api/submit', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`送信エラー: ${response.status} - ${errorText}`);
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
    console.log('[DEBUG] DOM読み込み完了、アプリ初期化開始');
    window.app = new LIFFEstimateApp();
});

