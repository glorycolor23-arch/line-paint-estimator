// シンプルなテスト版
console.log('app_simple.js 読み込み開始');

// DOM読み込み完了時の処理
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM読み込み完了');
    
    // ローディングを非表示
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = 'none';
        console.log('ローディング非表示成功');
    } else {
        console.error('loading要素が見つかりません');
    }
    
    // step1を表示
    const step1 = document.getElementById('step1');
    if (step1) {
        step1.style.display = 'block';
        console.log('step1表示成功');
    } else {
        console.error('step1要素が見つかりません');
    }
    
    // 質問タイトルを設定
    const questionTitle = document.getElementById('question-title');
    if (questionTitle) {
        questionTitle.textContent = 'テスト質問';
        console.log('質問タイトル設定成功');
    } else {
        console.error('question-title要素が見つかりません');
    }
    
    // 質問説明を設定
    const questionDescription = document.getElementById('question-description');
    if (questionDescription) {
        questionDescription.textContent = 'これはテストです';
        console.log('質問説明設定成功');
    } else {
        console.error('question-description要素が見つかりません');
    }
    
    // 選択肢を追加
    const questionOptions = document.getElementById('question-options');
    if (questionOptions) {
        questionOptions.innerHTML = `
            <div class="question-option">
                <input type="radio" id="option_0" name="question_option" value="テスト1">
                <label for="option_0" class="option-label">
                    <div class="option-title">テスト選択肢1</div>
                </label>
            </div>
            <div class="question-option">
                <input type="radio" id="option_1" name="question_option" value="テスト2">
                <label for="option_1" class="option-label">
                    <div class="option-title">テスト選択肢2</div>
                </label>
            </div>
        `;
        console.log('選択肢設定成功');
    } else {
        console.error('question-options要素が見つかりません');
    }
    
    console.log('初期化完了');
});

console.log('app_simple.js 読み込み完了');

