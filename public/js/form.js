/**
 * 外壁塗装見積もりシステム
 * フォームJavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
  // URLからセッションIDを取得
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session');
  
  if (!sessionId) {
    // セッションIDがない場合はトップページにリダイレクト
    window.location.href = '/';
    return;
  }
  
  // フォームデータの初期化
  let formData = {
    floors: '',
    layout: '',
    buildingAge: '',
    paintHistory: '',
    paintAge: '',
    workType: '',
    wallMaterial: '',
    roofMaterial: '',
    leakage: '',
    neighborDistance: '',
    paintGrade: '',
    timeframe: ''
  };
  
  // 質問スライドの取得
  const slides = document.querySelectorAll('.question-slide');
  const totalSlides = slides.length;
  
  // 現在の質問インデックス
  let currentSlideIndex = 0;
  
  // 表示する質問の総数（条件分岐によって変動）
  let totalVisibleSlides = calculateTotalVisibleSlides();
  
  // プログレスバーの更新
  updateProgressBar();
  
  // ナビゲーションボタン
  const prevButton = document.getElementById('prevButton');
  const nextButton = document.getElementById('nextButton');
  
  // 戻るボタン
  const backToTopButton = document.getElementById('backToTop');
  
  // オプションボタン
  const optionButtons = document.querySelectorAll('.option-button');
  
  // イベントリスナーの設定
  prevButton.addEventListener('click', goToPreviousSlide);
  nextButton.addEventListener('click', goToNextSlide);
  backToTopButton.addEventListener('click', () => {
    if (confirm('入力内容は保存されません。トップページに戻りますか？')) {
      window.location.href = '/';
    }
  });
  
  // オプションボタンのイベントリスナー
  optionButtons.forEach(button => {
    button.addEventListener('click', () => {
      const slide = button.closest('.question-slide');
      const questionName = slide.dataset.question;
      const value = button.dataset.value;
      
      // 同じスライド内の他のボタンの選択を解除
      slide.querySelectorAll('.option-button').forEach(btn => {
        btn.classList.remove('selected');
      });
      
      // 選択したボタンにクラスを追加
      button.classList.add('selected');
      
      // フォームデータを更新
      formData[questionName] = value;
      
      // 条件分岐の更新
      updateConditionalSlides();
      
      // 表示する質問の総数を再計算
      totalVisibleSlides = calculateTotalVisibleSlides();
      
      // プログレスバーの更新
      updateProgressBar();
      
      // 自動的に次の質問に進む（最後の質問でない場合）
      if (currentSlideIndex < totalVisibleSlides - 1) {
        setTimeout(goToNextSlide, 500);
      } else {
        // 最後の質問の場合は送信処理
        submitForm();
      }
    });
  });
  
  /**
   * 前の質問に移動する
   */
  function goToPreviousSlide() {
    if (currentSlideIndex > 0) {
      // 現在のスライドを非表示
      slides[currentSlideIndex].classList.add('hidden');
      
      // 前のスライドを探す（条件分岐を考慮）
      let prevIndex = currentSlideIndex - 1;
      while (prevIndex >= 0) {
        const slide = slides[prevIndex];
        if (!shouldHideSlide(slide)) {
          break;
        }
        prevIndex--;
      }
      
      if (prevIndex >= 0) {
        currentSlideIndex = prevIndex;
        slides[currentSlideIndex].classList.remove('hidden');
        updateProgressBar();
        updateNavigationButtons();
      }
    }
  }
  
  /**
   * 次の質問に移動する
   */
  function goToNextSlide() {
    if (currentSlideIndex < totalSlides - 1) {
      // 現在のスライドを非表示
      slides[currentSlideIndex].classList.add('hidden');
      
      // 次のスライドを探す（条件分岐を考慮）
      let nextIndex = currentSlideIndex + 1;
      while (nextIndex < totalSlides) {
        const slide = slides[nextIndex];
        if (!shouldHideSlide(slide)) {
          break;
        }
        nextIndex++;
      }
      
      if (nextIndex < totalSlides) {
        currentSlideIndex = nextIndex;
        slides[currentSlideIndex].classList.remove('hidden');
        updateProgressBar();
        updateNavigationButtons();
        
        // 画面の一番上にスクロール
        window.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }
    }
  }
  
  /**
   * 条件分岐によるスライドの表示/非表示を更新
   */
  function updateConditionalSlides() {
    slides.forEach(slide => {
      const condition = slide.dataset.condition;
      const conditionValue = slide.dataset.conditionValue;
      
      if (condition && conditionValue) {
        const values = conditionValue.split(',');
        const shouldShow = values.includes(formData[condition]);
        
        if (!shouldShow && !slide.classList.contains('hidden')) {
          slide.classList.add('hidden');
        }
      }
    });
  }
  
  /**
   * スライドを非表示にすべきかどうかを判定
   */
  function shouldHideSlide(slide) {
    const condition = slide.dataset.condition;
    const conditionValue = slide.dataset.conditionValue;
    
    if (condition && conditionValue) {
      const values = conditionValue.split(',');
      return !values.includes(formData[condition]);
    }
    
    return false;
  }
  
  /**
   * 表示する質問の総数を計算
   */
  function calculateTotalVisibleSlides() {
    let count = 0;
    slides.forEach(slide => {
      if (!shouldHideSlide(slide)) {
        count++;
      }
    });
    return count;
  }
  
  /**
   * プログレスバーの更新
   */
  function updateProgressBar() {
    const currentStep = document.getElementById('currentStep');
    const totalSteps = document.getElementById('totalSteps');
    const progressFill = document.querySelector('.progress-fill');
    
    // 現在のステップ番号を更新
    const visibleIndex = getVisibleIndex();
    currentStep.textContent = visibleIndex + 1;
    
    // 総ステップ数を更新
    totalSteps.textContent = totalVisibleSlides;
    
    // プログレスバーの幅を更新
    const progressPercentage = ((visibleIndex + 1) / totalVisibleSlides) * 100;
    progressFill.style.width = `${progressPercentage}%`;
  }
  
  /**
   * 現在のスライドの可視インデックスを取得
   */
  function getVisibleIndex() {
    let visibleIndex = 0;
    for (let i = 0; i < currentSlideIndex; i++) {
      if (!shouldHideSlide(slides[i])) {
        visibleIndex++;
      }
    }
    return visibleIndex;
  }
  
  /**
   * ナビゲーションボタンの状態を更新
   */
  function updateNavigationButtons() {
    // 前へボタンの状態
    prevButton.disabled = currentSlideIndex === 0;
    
    // 次へボタンの状態
    const isLastSlide = currentSlideIndex === totalSlides - 1 || getVisibleIndex() === totalVisibleSlides - 1;
    nextButton.disabled = isLastSlide;
    
    // 最後のスライドの場合は次へボタンのテキストを変更
    nextButton.textContent = isLastSlide ? '送信' : '次の質問 →';
  }
  
  /**
   * フォームを送信する
   */
  async function submitForm() {
    try {
      showLoading();
      
      // フォームデータをサーバーに送信
      const response = await fetch('/api/save-form-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: sessionId,
          formData: formData
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // LINE登録ページにリダイレクト
        window.location.href = `/line-register.html?session=${sessionId}`;
      } else {
        throw new Error(data.message || 'データの保存に失敗しました');
      }
      
    } catch (error) {
      console.error('エラー:', error);
      showError('申し訳ありません。エラーが発生しました。再度お試しください。');
    } finally {
      hideLoading();
    }
  }
  
  /**
   * ローディング表示
   */
  function showLoading() {
    // ローディング要素がなければ作成
    if (!document.querySelector('.loading-overlay')) {
      const loadingOverlay = document.createElement('div');
      loadingOverlay.className = 'loading-overlay';
      loadingOverlay.innerHTML = `
        <div class="loading-spinner"></div>
        <p>処理中...</p>
      `;
      document.body.appendChild(loadingOverlay);
      
      // スタイルを追加
      const style = document.createElement('style');
      style.textContent = `
        .loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          z-index: 9999;
          color: white;
        }
        
        .loading-spinner {
          width: 50px;
          height: 50px;
          border: 5px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s ease-in-out infinite;
          margin-bottom: 10px;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.querySelector('.loading-overlay').style.display = 'flex';
  }
  
  /**
   * ローディング非表示
   */
  function hideLoading() {
    const loadingOverlay = document.querySelector('.loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }
  }
  
  /**
   * エラーメッセージ表示
   */
  function showError(message) {
    // エラー要素がなければ作成
    if (!document.querySelector('.error-message')) {
      const errorElement = document.createElement('div');
      errorElement.className = 'error-message';
      document.body.appendChild(errorElement);
      
      // スタイルを追加
      const style = document.createElement('style');
      style.textContent = `
        .error-message {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background-color: #ef4444;
          color: white;
          padding: 10px 20px;
          border-radius: 5px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          z-index: 9999;
          animation: fadeIn 0.3s ease-out;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, 20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `;
      document.head.appendChild(style);
    }
    
    const errorElement = document.querySelector('.error-message');
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    
    // 5秒後に非表示
    setTimeout(() => {
      errorElement.style.display = 'none';
    }, 5000);
  }
  
  // 初期化
  updateNavigationButtons();
});

