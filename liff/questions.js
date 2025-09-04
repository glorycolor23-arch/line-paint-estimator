// 見積り質問データ定義
const QUESTIONS = [
    {
        id: 'q1_floors',
        title: '工事物件の階数は？',
        description: '建物の階数をお選びください',
        type: 'single',
        options: ['1階建て', '2階建て', '3階建て'],
        required: true,
        hasImage: false
    },
    {
        id: 'q2_layout',
        title: '物件の間取りは？',
        description: '建物の間取りをお選びください',
        type: 'single',
        options: ['1K', '1DK', '1LDK', '2K', '2DK', '2LDK', '3K', '3DK', '3LDK', '4K', '4DK', '4LDK'],
        required: true,
        hasImage: false
    },
    {
        id: 'q3_age',
        title: '物件の築年数は？',
        description: '建物の築年数をお選びください',
        type: 'single',
        options: ['新築', '～5年', '～10年', '～15年', '～20年', '～25年', '～30年', '30年以上'],
        required: true,
        hasImage: false
    },
    {
        id: 'q4_previous_paint',
        title: '過去に塗装工事をしたことはありますか？',
        description: '前回の塗装工事についてお答えください',
        type: 'single',
        options: ['ない', 'ある'],
        required: true,
        hasImage: false,
        conditional: {
            'ある': {
                followUp: {
                    id: 'q4_paint_years',
                    title: '前回の塗装工事からどのくらい経ちますか？',
                    options: ['～5年', '～10年', '～15年', '15年以上']
                }
            }
        }
    },
    {
        id: 'q5_work_type',
        title: '工事内容は？',
        description: 'ご希望の工事内容をお選びください',
        type: 'single',
        options: ['外壁塗装のみ', '屋根塗装のみ', '外壁・屋根両方'],
        required: true,
        hasImage: false
    },
    {
        id: 'q6_wall_material',
        title: '外壁の種類は？',
        description: '現在の外壁材をお選びください。画像を参考にしてください',
        type: 'single',
        options: [
            {
                value: 'モルタル',
                label: 'モルタル',
                description: 'セメントと砂を混ぜた塗り壁。表面がざらざらしている'
            },
            {
                value: 'サイディング',
                label: 'サイディング',
                description: 'パネル状の外壁材。継ぎ目があり、表面が平らで模様がある'
            },
            {
                value: 'タイル',
                label: 'タイル',
                description: '陶器製の小さな板を貼り付けた外壁。光沢があり高級感がある'
            },
            {
                value: 'ALC',
                label: 'ALC',
                description: '軽量コンクリート。表面に小さな穴があり、白っぽい色が多い'
            }
        ],
        required: true,
        hasImage: true,
        imageUrl: 'images/wall_materials.png',
        conditional: {
            condition: 'q5_work_type',
            showWhen: ['外壁塗装のみ', '外壁・屋根両方']
        }
    },
    {
        id: 'q7_wall_paint',
        title: '外壁塗料のグレードは？',
        description: 'ご希望の塗料グレードをお選びください',
        type: 'single',
        options: [
            {
                value: 'standard',
                label: '一般的な塗料（コスト重視）',
                description: 'アクリル・ウレタン系塗料。耐用年数5-8年'
            },
            {
                value: 'premium',
                label: '高品質塗料（バランス重視）',
                description: 'シリコン系塗料。耐用年数10-12年'
            },
            {
                value: 'luxury',
                label: '最高級塗料（品質重視）',
                description: 'フッ素・無機系塗料。耐用年数15-20年'
            }
        ],
        required: true,
        hasImage: false,
        conditional: {
            condition: 'q5_work_type',
            showWhen: ['外壁塗装のみ', '外壁・屋根両方']
        }
    },
    {
        id: 'q8_roof_material',
        title: '屋根の種類は？',
        description: '現在の屋根材をお選びください。画像を参考にしてください',
        type: 'single',
        options: [
            {
                value: '瓦',
                label: '瓦',
                description: '粘土を焼いて作った屋根材。重厚で和風の印象'
            },
            {
                value: 'スレート',
                label: 'スレート',
                description: '薄い板状の屋根材。表面が平らで灰色が多い'
            },
            {
                value: 'ガルバリウム',
                label: 'ガルバリウム',
                description: '金属製の屋根材。表面に光沢があり軽量'
            },
            {
                value: 'トタン',
                label: 'トタン',
                description: '亜鉛メッキ鋼板。波型や平型がある'
            }
        ],
        required: true,
        hasImage: true,
        imageUrl: 'images/roof_materials.png',
        conditional: {
            condition: 'q5_work_type',
            showWhen: ['屋根塗装のみ', '外壁・屋根両方']
        }
    },
    {
        id: 'q9_roof_paint',
        title: '屋根塗料のグレードは？',
        description: 'ご希望の塗料グレードをお選びください',
        type: 'single',
        options: [
            {
                value: 'standard',
                label: '一般的な塗料（コスト重視）',
                description: 'アクリル・ウレタン系塗料。耐用年数5-8年'
            },
            {
                value: 'premium',
                label: '高品質塗料（バランス重視）',
                description: 'シリコン系塗料。耐用年数10-12年'
            },
            {
                value: 'luxury',
                label: '最高級塗料（品質重視）',
                description: 'フッ素・無機系塗料。耐用年数15-20年'
            }
        ],
        required: true,
        hasImage: false,
        conditional: {
            condition: 'q5_work_type',
            showWhen: ['屋根塗装のみ', '外壁・屋根両方']
        }
    },
    {
        id: 'q10_leak',
        title: '雨漏りや漏水の症状はありますか？',
        description: '現在の建物の状況をお選びください',
        type: 'single',
        options: ['ない', '雨の日に水滴が落ちる', '天井にシミがある'],
        required: true,
        hasImage: false
    },
    {
        id: 'q11_distance',
        title: '隣や裏の家との距離は？（周囲で一番近い距離）',
        description: '足場設置のため、隣家との距離をお教えください',
        type: 'single',
        options: ['30cm以下', '50cm以下', '70cm以下', '1m以上'],
        required: true,
        hasImage: false
    },
    {
        id: 'q12_urgency',
        title: '工事の希望時期は？',
        description: 'ご希望の工事開始時期をお選びください',
        type: 'single',
        options: ['すぐにでも', '1ヶ月以内', '3ヶ月以内', '半年以内', '1年以内', '未定'],
        required: true,
        hasImage: false
    }
];

// 価格計算用の基準データ
const PRICE_BASE = {
    // 基本価格（1階建て・1K・標準塗料）
    base: {
        wall: 300000,  // 外壁塗装基本価格
        roof: 200000   // 屋根塗装基本価格
    },
    
    // 階数による係数
    floors: {
        '1階建て': 1.0,
        '2階建て': 1.5,
        '3階建て': 2.0
    },
    
    // 間取りによる係数
    layout: {
        '1K': 1.0, '1DK': 1.1, '1LDK': 1.2,
        '2K': 1.3, '2DK': 1.4, '2LDK': 1.5,
        '3K': 1.6, '3DK': 1.7, '3LDK': 1.8,
        '4K': 1.9, '4DK': 2.0, '4LDK': 2.1
    },
    
    // 築年数による係数
    age: {
        '新築': 0.8,
        '～5年': 0.9,
        '～10年': 1.0,
        '～15年': 1.1,
        '～20年': 1.2,
        '～25年': 1.3,
        '～30年': 1.4,
        '30年以上': 1.5
    },
    
    // 塗料グレードによる係数
    paintGrade: {
        'standard': 1.0,
        'premium': 1.4,
        'luxury': 1.8
    },
    
    // 外壁材による係数
    wallMaterial: {
        'モルタル': 1.0,
        'サイディング': 1.1,
        'タイル': 1.3,
        'ALC': 1.2
    },
    
    // 屋根材による係数
    roofMaterial: {
        '瓦': 1.2,
        'スレート': 1.0,
        'ガルバリウム': 1.1,
        'トタン': 0.9
    },
    
    // 追加工事費用
    additional: {
        leak: {
            'ない': 0,
            '雨の日に水滴が落ちる': 50000,
            '天井にシミがある': 100000
        },
        distance: {
            '30cm以下': 100000,  // 足場設置困難
            '50cm以下': 50000,   // 足場設置やや困難
            '70cm以下': 20000,   // 足場設置注意
            '1m以上': 0          // 通常
        }
    }
};

// 質問フロー制御クラス
class QuestionFlow {
    constructor() {
        this.currentQuestionIndex = 0;
        this.answers = {};
        this.questionHistory = [];
    }
    
    // 現在の質問を取得
    getCurrentQuestion() {
        const visibleQuestions = this.getVisibleQuestions();
        if (this.currentQuestionIndex >= visibleQuestions.length) {
            return null; // 全質問完了
        }
        return visibleQuestions[this.currentQuestionIndex];
    }
    
    // 表示すべき質問のリストを取得（条件分岐を考慮）
    getVisibleQuestions() {
        return QUESTIONS.filter(question => {
            if (!question.conditional) return true;
            
            const condition = question.conditional.condition;
            const showWhen = question.conditional.showWhen;
            const conditionAnswer = this.answers[condition];
            
            return showWhen.includes(conditionAnswer);
        });
    }
    
    // 回答を記録
    setAnswer(questionId, answer) {
        this.answers[questionId] = answer;
        
        // フォローアップ質問の処理
        const question = QUESTIONS.find(q => q.id === questionId);
        if (question && question.conditional && question.conditional[answer]) {
            const followUp = question.conditional[answer].followUp;
            if (followUp) {
                this.answers[followUp.id] = null; // フォローアップ質問を有効化
            }
        }
    }
    
    // 次の質問に進む
    nextQuestion() {
        const visibleQuestions = this.getVisibleQuestions();
        if (this.currentQuestionIndex < visibleQuestions.length - 1) {
            this.currentQuestionIndex++;
            return this.getCurrentQuestion();
        }
        return null; // 全質問完了
    }
    
    // 前の質問に戻る
    previousQuestion() {
        if (this.currentQuestionIndex > 0) {
            this.currentQuestionIndex--;
            return this.getCurrentQuestion();
        }
        return null; // 最初の質問
    }
    
    // 進捗率を取得
    getProgress() {
        const visibleQuestions = this.getVisibleQuestions();
        return Math.round((this.currentQuestionIndex / visibleQuestions.length) * 100);
    }
    
    // 全質問完了かチェック
    isComplete() {
        const visibleQuestions = this.getVisibleQuestions();
        return this.currentQuestionIndex >= visibleQuestions.length;
    }
    
    // 概算見積りを計算
    calculateEstimate() {
        let wallPrice = 0;
        let roofPrice = 0;
        
        const workType = this.answers['q5_work_type'];
        const floors = this.answers['q1_floors'];
        const layout = this.answers['q2_layout'];
        const age = this.answers['q3_age'];
        
        // 外壁塗装価格計算
        if (workType === '外壁塗装のみ' || workType === '外壁・屋根両方') {
            const wallMaterial = this.answers['q6_wall_material'];
            const wallPaint = this.answers['q7_wall_paint'];
            
            wallPrice = PRICE_BASE.base.wall
                * PRICE_BASE.floors[floors]
                * PRICE_BASE.layout[layout]
                * PRICE_BASE.age[age]
                * PRICE_BASE.wallMaterial[wallMaterial]
                * PRICE_BASE.paintGrade[wallPaint];
        }
        
        // 屋根塗装価格計算
        if (workType === '屋根塗装のみ' || workType === '外壁・屋根両方') {
            const roofMaterial = this.answers['q8_roof_material'];
            const roofPaint = this.answers['q9_roof_paint'];
            
            roofPrice = PRICE_BASE.base.roof
                * PRICE_BASE.floors[floors]
                * PRICE_BASE.layout[layout]
                * PRICE_BASE.age[age]
                * PRICE_BASE.roofMaterial[roofMaterial]
                * PRICE_BASE.paintGrade[roofPaint];
        }
        
        // 追加費用
        const leakCost = PRICE_BASE.additional.leak[this.answers['q10_leak']] || 0;
        const distanceCost = PRICE_BASE.additional.distance[this.answers['q11_distance']] || 0;
        
        const totalPrice = wallPrice + roofPrice + leakCost + distanceCost;
        
        return {
            wallPrice: Math.round(wallPrice),
            roofPrice: Math.round(roofPrice),
            additionalCost: leakCost + distanceCost,
            totalPrice: Math.round(totalPrice)
        };
    }
    
    // 回答サマリーを生成
    generateSummary() {
        const summary = [];
        
        summary.push(`階数: ${this.answers['q1_floors']}`);
        summary.push(`間取り: ${this.answers['q2_layout']}`);
        summary.push(`築年数: ${this.answers['q3_age']}`);
        summary.push(`工事内容: ${this.answers['q5_work_type']}`);
        
        if (this.answers['q6_wall_material']) {
            summary.push(`外壁: ${this.answers['q6_wall_material']}`);
            summary.push(`外壁塗料: ${this.getGradeLabel(this.answers['q7_wall_paint'])}`);
        }
        
        if (this.answers['q8_roof_material']) {
            summary.push(`屋根: ${this.answers['q8_roof_material']}`);
            summary.push(`屋根塗料: ${this.getGradeLabel(this.answers['q9_roof_paint'])}`);
        }
        
        summary.push(`雨漏り: ${this.answers['q10_leak']}`);
        summary.push(`隣家距離: ${this.answers['q11_distance']}`);
        
        return summary;
    }
    
    // 塗料グレードのラベルを取得
    getGradeLabel(grade) {
        const gradeLabels = {
            'standard': '一般的な塗料',
            'premium': '高品質塗料',
            'luxury': '最高級塗料'
        };
        return gradeLabels[grade] || grade;
    }
}

// グローバルに公開
if (typeof window !== 'undefined') {
    window.QUESTIONS = QUESTIONS;
    window.PRICE_BASE = PRICE_BASE;
    window.QuestionFlow = QuestionFlow;
}

