// 最小限のLIFFアプリ（タイムアウト対応）
console.log('[DEBUG] 最小限アプリ開始');

// タイムアウト設定
const INIT_TIMEOUT = 10000; // 10秒

function showMessage(message, isError = false) {
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.innerHTML = `
            <div style="text-align: center; padding: 40px 20px;">
                <div style="font-size: 48px; margin-bottom: 20px;">
                    ${isError ? '❌' : '✅'}
                </div>
                <h2 style="color: ${isError ? '#ff4444' : '#00B900'}; margin-bottom: 20px;">
                    ${isError ? 'エラー' : '成功'}
                </h2>
                <p style="margin-bottom: 30px; line-height: 1.6;">
                    ${message}
                </p>
                <button onclick="location.reload()" 
                        style="padding: 12px 24px; 
                               background: ${isError ? '#ff4444' : '#00B900'}; 
                               color: white; 
                               border: none; 
                               border-radius: 8px; 
                               font-size: 16px;
                               cursor: pointer;">
                    再読み込み
                </button>
            </div>
        `;
    }
}

async function initApp() {
    console.log('[DEBUG] アプリ初期化開始');
    
    try {
        // 環境変数チェック
        if (!window.ENV || !window.ENV.LIFF_ID) {
            throw new Error('LIFF IDが設定されていません。env.jsファイルを確認してください。');
        }
        
        const liffId = window.ENV.LIFF_ID;
        console.log('[DEBUG] LIFF ID:', liffId);
        
        // LIFF SDKの存在確認
        if (typeof liff === 'undefined') {
            throw new Error('LIFF SDKが読み込まれていません。');
        }
        
        console.log('[DEBUG] LIFF SDK確認完了');
        
        // タイムアウト付きLIFF初期化
        const initPromise = liff.init({ liffId: liffId });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('LIFF初期化がタイムアウトしました（10秒）'));
            }, INIT_TIMEOUT);
        });
        
        console.log('[DEBUG] LIFF初期化実行中...');
        await Promise.race([initPromise, timeoutPromise]);
        console.log('[DEBUG] LIFF初期化完了');
        
        // ログイン状態確認
        if (!liff.isLoggedIn()) {
            console.log('[DEBUG] ログインが必要です');
            showMessage('LINEログインが必要です。ログイン画面に移動します...', false);
            setTimeout(() => {
                liff.login();
            }, 2000);
            return;
        }
        
        console.log('[DEBUG] ログイン済み');
        
        // ユーザー情報取得
        const profile = await liff.getProfile();
        const userId = profile.userId;
        const displayName = profile.displayName;
        
        console.log('[DEBUG] ユーザー情報取得成功:', { userId, displayName });
        
        // 成功メッセージ表示
        showMessage(`
            LIFF初期化が正常に完了しました！<br><br>
            <strong>ユーザー名:</strong> ${displayName}<br>
            <strong>ユーザーID:</strong> ${userId.substring(0, 8)}...<br>
            <strong>LIFF ID:</strong> ${liffId}
        `, false);
        
    } catch (error) {
        console.error('[ERROR] 初期化エラー:', error);
        showMessage(`
            初期化に失敗しました。<br><br>
            <strong>エラー内容:</strong><br>
            ${error.message}<br><br>
            LINEアプリから再度お試しください。
        `, true);
    }
}

// DOM読み込み完了後に初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOM読み込み完了');
    
    // 少し待ってから初期化（LIFF SDKの読み込み完了を待つ）
    setTimeout(() => {
        initApp();
    }, 1000);
});

