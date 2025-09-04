/**
 * 外壁塗装見積もりシステム
 * LINE友達登録JavaScript
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
  
  // 戻るボタン
  const backToFormButton = document.getElementById('backToForm');
  backToFormButton.addEventListener('click', () => {
    window.location.href = `/form.html?session=${sessionId}`;
  });
  
  // LINE友達追加ボタン
  const addFriendButton = document.getElementById('addFriendButton');
  addFriendButton.addEventListener('click', () => {
    // LINE公式アカウントのURLを設定（実際のURLに変更する必要あり）
    const lineUrl = 'https://line.me/R/ti/p/@your_line_id';
    
    // セッションIDをLINEに紐付け
    linkSessionToLine(sessionId)
      .then(() => {
        // LINEアプリを開く
        window.location.href = lineUrl;
      })
      .catch(error => {
        console.error('エラー:', error);
        showError('LINE連携に失敗しました。再度お試しください。');
      });
  });
  
  // セッションデータの取得と表示
  fetchSessionData(sessionId);
  
  /**
   * セッションデータを取得して表示する
   */
  async function fetchSessionData(sessionId) {
    try {
      showLoading();
      
      const response = await fetch(`/api/get-session-data/${sessionId}`);
      const data = await response.json();
      
      if (data.success) {
        // 見積もり金額の表示
        displayEstimateAmount(data.estimateResult);
        
        // 選択内容の表示
        displaySummary(data.data);
      } else {
        throw new Error(data.message || 'データの取得に失敗しました');
      }
      
    } catch (error) {
      console.error('エラー:', error);
      showError('データの取得に失敗しました。再度お試しください。');
    } finally {
      hideLoading();
    }
  }
  
  /**
   * 見積もり金額を表示する
   */
  function displayEstimateAmount(estimateResult) {
    const estimateAmountElement = document.getElementById('estimateAmount');
    
    if (estimateResult && estimateResult.totalCost) {
      // 金額をカンマ区切りで表示
      const formattedAmount = estimateResult.totalCost.toLocaleString();
      
      // アニメーション付きで表示
      animateNumber(estimateAmountElement, formattedAmount);
    } else {
      estimateAmountElement.textContent = '計算できません';
    }
  }
  
  /**
   * 数値をアニメーション付きで表示する
   */
  function animateNumber(element, targetValue) {
    // カンマを除去して数値に変換
    const targetNumber = parseInt(targetValue.replace(/,/g, ''));
    const duration = 1000; // アニメーション時間（ミリ秒）
    const startTime = performance.now();
    const startValue = 0;
    
    function updateNumber(currentTime) {
      const elapsedTime = currentTime - startTime;
      
      if (elapsedTime < duration) {
        // イージング関数（easeOutQuad）
        const progress = 1 - Math.pow(1 - elapsedTime / duration, 2);
        const currentValue = Math.floor(startValue + (targetNumber - startValue) * progress);
        element.textContent = currentValue.toLocaleString();
        requestAnimationFrame(updateNumber);
      } else {
        // アニメーション終了
        element.textContent = targetValue;
      }
    }
    
    requestAnimationFrame(updateNumber);
  }
  
  /**
   * 選択内容のサマリーを表示する
   */
  function displaySummary(formData) {
    const summaryContainer = document.getElementById('estimateSummary');
    summaryContainer.innerHTML = '';
    
    if (!formData) return;
    
    // 表示するフィールドとラベルのマッピング
    const fieldLabels = {
      floors: '階数',
      layout: '間取り',
      buildingAge: '築年数',
      paintHistory: '塗装歴',
      paintAge: '前回の塗装からの経過年数',
      workType: '工事内容',
      wallMaterial: '外壁材',
      roofMaterial: '屋根材',
      leakage: '雨漏り',
      neighborDistance: '隣家との距離',
      paintGrade: '塗料グレード',
      timeframe: '希望時期'
    };
    
    // 各フィールドの表示
    for (const [field, label] of Object.entries(fieldLabels)) {
      // 値がある場合のみ表示
      if (formData[field]) {
        const itemElement = document.createElement('div');
        itemElement.className = 'summary-item';
        
        const labelElement = document.createElement('span');
        labelElement.className = 'summary-item-label';
        labelElement.textContent = label;
        
        const valueElement = document.createElement('span');
        valueElement.className = 'summary-item-value';
        valueElement.textContent = formData[field];
        
        itemElement.appendChild(labelElement);
        itemElement.appendChild(valueElement);
        summaryContainer.appendChild(itemElement);
      }
    }
  }
  
  /**
   * セッションIDをLINEに紐付ける
   */
  async function linkSessionToLine(sessionId) {
    try {
      const response = await fetch('/api/link-session-to-line', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.message || 'LINE連携に失敗しました');
      }
      
      return data;
    } catch (error) {
      console.error('LINE連携エラー:', error);
      throw error;
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
        <p>データ取得中...</p>
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
  
  /**
   * デバイス判定
   */
  function detectDevice() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const mobileRegister = document.getElementById('mobileRegister');
    const pcRegister = document.getElementById('pcRegister');
    
    if (isMobile) {
      mobileRegister.style.display = 'block';
      pcRegister.style.display = 'none';
    } else {
      mobileRegister.style.display = 'none';
      pcRegister.style.display = 'block';
    }
  }
  
  // デバイス判定を実行
  detectDevice();
});

