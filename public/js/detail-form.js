/**
 * 外壁塗装見積もりシステム
 * 詳細見積もり依頼フォームJavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
  // URLからセッションIDを取得
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session');
  
  // フォーム要素
  const detailForm = document.getElementById('detailForm');
  const submitButton = document.getElementById('submitButton');
  
  // 戻るボタン
  const backToTopButton = document.getElementById('backToTop');
  backToTopButton.addEventListener('click', () => {
    if (confirm('入力内容は保存されません。トップページに戻りますか？')) {
      window.location.href = '/';
    }
  });
  
  // 郵便番号検索ボタン
  const searchAddressButton = document.getElementById('searchAddress');
  searchAddressButton.addEventListener('click', searchAddress);
  
  // 写真アップロード処理
  setupPhotoUpload();
  
  // フォーム送信処理
  detailForm.addEventListener('submit', handleSubmit);
  
  // フォームバリデーション
  setupFormValidation();
  
  /**
   * 郵便番号から住所を検索する
   */
  async function searchAddress() {
    const postalCodeInput = document.getElementById('postalCode');
    const addressInput = document.getElementById('address');
    
    // 郵便番号のバリデーション
    const postalCode = postalCodeInput.value.replace(/[^\d]/g, '');
    if (postalCode.length !== 7) {
      showError(postalCodeInput, '郵便番号は7桁の数字で入力してください');
      return;
    }
    
    try {
      showLoading();
      
      // 郵便番号APIを呼び出し
      const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${postalCode}`);
      const data = await response.json();
      
      if (data.status === 200 && data.results) {
        const result = data.results[0];
        const address = `${result.address1}${result.address2}${result.address3}`;
        addressInput.value = address;
        
        // エラー表示をクリア
        clearError(postalCodeInput);
      } else {
        showError(postalCodeInput, '該当する住所が見つかりませんでした');
      }
    } catch (error) {
      console.error('郵便番号検索エラー:', error);
      showError(postalCodeInput, '住所検索に失敗しました');
    } finally {
      hideLoading();
    }
  }
  
  /**
   * 写真アップロード機能のセットアップ
   */
  function setupPhotoUpload() {
    const photoInputs = document.querySelectorAll('.photo-input');
    
    photoInputs.forEach(input => {
      const container = input.closest('.photo-upload-container');
      const preview = container.querySelector('.photo-preview');
      const placeholder = container.querySelector('.photo-upload-placeholder');
      
      input.addEventListener('change', function() {
        if (this.files && this.files[0]) {
          const file = this.files[0];
          
          // ファイルサイズチェック（5MB以下）
          if (file.size > 5 * 1024 * 1024) {
            alert('ファイルサイズは5MB以下にしてください');
            this.value = '';
            return;
          }
          
          // 画像ファイルかチェック
          if (!file.type.match('image.*')) {
            alert('画像ファイルを選択してください');
            this.value = '';
            return;
          }
          
          const reader = new FileReader();
          
          reader.onload = function(e) {
            // プレビュー表示
            preview.innerHTML = `
              <img src="${e.target.result}" alt="プレビュー">
              <div class="remove-photo">×</div>
            `;
            preview.style.display = 'block';
            placeholder.style.display = 'none';
            
            // 削除ボタンのイベントリスナー
            const removeButton = preview.querySelector('.remove-photo');
            removeButton.addEventListener('click', function(e) {
              e.stopPropagation();
              input.value = '';
              preview.style.display = 'none';
              placeholder.style.display = 'flex';
            });
          };
          
          reader.readAsDataURL(file);
        }
      });
      
      // クリックイベントの伝播
      container.addEventListener('click', function() {
        input.click();
      });
    });
  }
  
  /**
   * フォームバリデーションのセットアップ
   */
  function setupFormValidation() {
    const requiredInputs = document.querySelectorAll('input[required], select[required], textarea[required]');
    
    requiredInputs.forEach(input => {
      input.addEventListener('blur', function() {
        validateInput(this);
      });
      
      input.addEventListener('input', function() {
        if (this.classList.contains('error')) {
          validateInput(this);
        }
      });
    });
    
    // フリガナ自動変換
    const nameInput = document.getElementById('name');
    const furiganaInput = document.getElementById('furigana');
    
    nameInput.addEventListener('blur', function() {
      if (furiganaInput.value === '') {
        // 名前からフリガナを自動生成（実際にはAPIを使用するか、簡易的な変換）
        // ここでは簡易的な例として、名前をそのままカタカナに変換したと仮定
        furiganaInput.value = nameInput.value;
      }
    });
  }
  
  /**
   * 入力フィールドのバリデーション
   */
  function validateInput(input) {
    if (input.hasAttribute('required') && !input.value.trim()) {
      showError(input, '入力必須です');
      return false;
    }
    
    if (input.type === 'email' && input.value) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(input.value)) {
        showError(input, '有効なメールアドレスを入力してください');
        return false;
      }
    }
    
    if (input.type === 'tel' && input.value) {
      const telRegex = /^[\d\-+\s]+$/;
      if (!telRegex.test(input.value)) {
        showError(input, '有効な電話番号を入力してください');
        return false;
      }
    }
    
    if (input.id === 'postalCode' && input.value) {
      const postalCodeRegex = /^\d{3}-?\d{4}$/;
      if (!postalCodeRegex.test(input.value)) {
        showError(input, '郵便番号は123-4567の形式で入力してください');
        return false;
      }
    }
    
    clearError(input);
    return true;
  }
  
  /**
   * エラーメッセージを表示
   */
  function showError(input, message) {
    clearError(input);
    
    input.classList.add('error');
    
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    
    const parent = input.parentElement;
    parent.appendChild(errorElement);
  }
  
  /**
   * エラーメッセージをクリア
   */
  function clearError(input) {
    input.classList.remove('error');
    
    const parent = input.parentElement;
    const errorElement = parent.querySelector('.error-message');
    if (errorElement) {
      parent.removeChild(errorElement);
    }
  }
  
  /**
   * フォーム全体のバリデーション
   */
  function validateForm() {
    const requiredInputs = document.querySelectorAll('input[required], select[required], textarea[required]');
    let isValid = true;
    
    requiredInputs.forEach(input => {
      if (!validateInput(input)) {
        isValid = false;
      }
    });
    
    return isValid;
  }
  
  /**
   * フォーム送信処理
   */
  async function handleSubmit(e) {
    e.preventDefault();
    
    if (!validateForm()) {
      // スクロールして最初のエラー要素を表示
      const firstError = document.querySelector('.error');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    
    try {
      showLoading();
      
      // FormDataオブジェクトの作成
      const formData = new FormData(detailForm);
      
      // セッションIDを追加
      if (sessionId) {
        formData.append('sessionId', sessionId);
      }
      
      // 顧客データをJSON形式で追加
      const customerData = {
        name: document.getElementById('name').value,
        furigana: document.getElementById('furigana').value,
        phone: document.getElementById('phone').value,
        email: document.getElementById('email').value,
        postalCode: document.getElementById('postalCode').value,
        address: document.getElementById('address').value,
        preferredDate1: document.getElementById('preferredDate1').value,
        preferredTime1: document.getElementById('preferredTime1').value,
        preferredDate2: document.getElementById('preferredDate2').value,
        preferredTime2: document.getElementById('preferredTime2').value,
        message: document.getElementById('message').value,
        lineId: sessionId // 仮のLINE ID（実際にはLINE連携から取得）
      };
      
      formData.append('customerData', JSON.stringify(customerData));
      
      // サーバーにデータを送信
      const response = await fetch('/api/submit-detail-request', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      if (data.success) {
        // 送信成功時の処理
        showCompletionMessage();
      } else {
        throw new Error(data.message || '送信に失敗しました');
      }
      
    } catch (error) {
      console.error('送信エラー:', error);
      showError(submitButton, '送信に失敗しました。再度お試しください。');
    } finally {
      hideLoading();
    }
  }
  
  /**
   * 送信完了メッセージの表示
   */
  function showCompletionMessage() {
    // フォームを非表示
    detailForm.style.display = 'none';
    
    // 完了メッセージを表示
    const completionMessage = document.createElement('div');
    completionMessage.className = 'completion-message';
    completionMessage.innerHTML = `
      <div class="completion-icon">✓</div>
      <h3>詳細見積もり依頼を受け付けました</h3>
      <p>
        ご依頼ありがとうございます。<br>
        担当者より2営業日以内にご連絡いたします。
      </p>
      <div class="completion-actions">
        <button id="backToHomeButton" class="primary-button">トップページに戻る</button>
      </div>
    `;
    
    // スタイルを追加
    const style = document.createElement('style');
    style.textContent = `
      .completion-message {
        text-align: center;
        padding: var(--spacing-2xl) var(--spacing-xl);
      }
      
      .completion-icon {
        width: 80px;
        height: 80px;
        background-color: var(--success);
        color: white;
        border-radius: 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        font-size: 40px;
        margin: 0 auto var(--spacing-xl);
      }
      
      .completion-message h3 {
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-bold);
        margin-bottom: var(--spacing-md);
        color: var(--primary);
      }
      
      .completion-message p {
        margin-bottom: var(--spacing-xl);
        color: var(--text-light);
      }
      
      .completion-actions {
        margin-top: var(--spacing-xl);
      }
      
      .primary-button {
        background-color: var(--primary);
        color: var(--white);
        font-size: var(--font-size-md);
        font-weight: var(--font-weight-medium);
        padding: var(--spacing-md) var(--spacing-xl);
        border-radius: var(--border-radius-md);
        transition: background-color var(--transition-fast) ease;
      }
      
      .primary-button:hover {
        background-color: var(--primary-dark);
      }
    `;
    document.head.appendChild(style);
    
    // 完了メッセージを挿入
    const container = document.querySelector('.detail-form-container');
    container.appendChild(completionMessage);
    
    // トップページに戻るボタンのイベントリスナー
    const backToHomeButton = document.getElementById('backToHomeButton');
    backToHomeButton.addEventListener('click', () => {
      window.location.href = '/';
    });
    
    // スクロールして完了メッセージを表示
    completionMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
});

