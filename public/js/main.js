/**
 * 外壁塗装見積もりシステム
 * メインJavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
  // セッションIDの生成または取得
  let sessionId = localStorage.getItem('estimateSessionId');
  
  // 見積もり開始ボタンのイベントリスナー
  const startEstimateButtons = document.querySelectorAll('#startEstimate, #startEstimateFlow, #startEstimateContact');
  startEstimateButtons.forEach(button => {
    button.addEventListener('click', startEstimateProcess);
  });
  
  // FAQのトグル機能
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      // 現在開いているFAQを閉じる
      const currentActive = document.querySelector('.faq-item.active');
      if (currentActive && currentActive !== item) {
        currentActive.classList.remove('active');
      }
      
      // クリックされたFAQをトグル
      item.classList.toggle('active');
    });
  });
  
  // スムーススクロール
  const navLinks = document.querySelectorAll('a[href^="#"]');
  navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      
      // #だけの場合はスクロールしない
      if (href === '#') return;
      
      e.preventDefault();
      
      const targetElement = document.querySelector(href);
      if (targetElement) {
        // ヘッダーの高さを考慮したスクロール位置
        const headerHeight = document.querySelector('.header').offsetHeight;
        const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - headerHeight;
        
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
  
  // スクロール時のヘッダースタイル変更
  const header = document.querySelector('.header');
  let lastScrollTop = 0;
  
  window.addEventListener('scroll', () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    
    // スクロール方向の検出
    if (scrollTop > lastScrollTop) {
      // 下にスクロール
      header.style.transform = 'translateY(-100%)';
    } else {
      // 上にスクロール
      header.style.transform = 'translateY(0)';
    }
    
    // 少しでもスクロールしたらヘッダーに影をつける
    if (scrollTop > 10) {
      header.style.boxShadow = 'var(--shadow-md)';
    } else {
      header.style.boxShadow = 'var(--shadow-sm)';
    }
    
    lastScrollTop = scrollTop;
  });
  
  /**
   * 見積もりプロセスを開始する関数
   */
  async function startEstimateProcess() {
    try {
      showLoading();
      
      // セッションIDがない場合は新規作成
      if (!sessionId) {
        const response = await fetch('/api/create-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        const data = await response.json();
        
        if (data.success) {
          sessionId = data.sessionId;
          localStorage.setItem('estimateSessionId', sessionId);
        } else {
          throw new Error('セッション作成に失敗しました');
        }
      }
      
      // フォームページへリダイレクト
      window.location.href = `/form.html?session=${sessionId}`;
      
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
});

