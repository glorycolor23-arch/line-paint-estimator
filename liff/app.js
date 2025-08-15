// デバッグ用シンプルLIFFアプリ
class SimpleLiffApp {
    constructor() {
        this.liffId = window.ENV?.LIFF_ID;
        this.userId = null;
        this.init();
    }

    async init() {
        console.log('[DEBUG] シンプルアプリ初期化開始');
        
        try {
            // ローディング表示
            this.showLoading();
            
            // LIFF初期化
            if (!this.liffId) {
                throw new Error('LIFF IDが設定されていません');
            }

            console.log('[DEBUG] LIFF初期化:', this.liffId);
            await liff.init({ liffId: this.liffId });
            
            if (!liff.isLoggedIn()) {
                console.log('[DEBUG] ログインが必要');
                liff.login();
                return;
            }

            const profile = await liff.getProfile();
            this.userId = profile.userId;
            console.log('[DEBUG] ユーザーID:', this.userId);
            
            // 成功表示
            this.showSuccess();
            
        } catch (error) {
            console.error('[ERROR] 初期化エラー:', error);
            this.showError(error.message);
        }
    }
    
    showLoading() {
        const loading = document.getElementById('loading');
        const mainContent = document.getElementById('main-content');
        
        if (loading) loading.style.display = 'block';
        if (mainContent) {
            // 他の要素を非表示
            const children = mainContent.children;
            for (let child of children) {
                if (child.id !== 'loading') {
                    child.style.display = 'none';
                }
            }
        }
    }
    
    showSuccess() {
        const loading = document.getElementById('loading');
        const mainContent = document.getElementById('main-content');
        
        if (loading) loading.style.display = 'none';
        
        // 成功メッセージを表示
        if (mainContent) {
            mainContent.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <h2>✅ LIFF初期化成功</h2>
                    <p>ユーザーID: ${this.userId}</p>
                    <p>LIFF ID: ${this.liffId}</p>
                    <button onclick="location.reload()" style="padding: 10px 20px; background: #00B900; color: white; border: none; border-radius: 5px;">再読み込み</button>
                </div>
            `;
        }
    }
    
    showError(message) {
        const loading = document.getElementById('loading');
        const mainContent = document.getElementById('main-content');
        
        if (loading) loading.style.display = 'none';
        
        if (mainContent) {
            mainContent.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <h2>❌ エラー</h2>
                    <p>${message}</p>
                    <button onclick="location.reload()" style="padding: 10px 20px; background: #ff4444; color: white; border: none; border-radius: 5px;">再読み込み</button>
                </div>
            `;
        }
    }
}

// DOM読み込み完了後に初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOM読み込み完了 - シンプルアプリ');
    window.app = new SimpleLiffApp();
});

