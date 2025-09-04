// 強制ローディング停止アプリ
console.log('[DEBUG] 強制停止アプリ開始');

function forceStopLoading() {
    console.log('[DEBUG] ローディング強制停止');
    
    // ローディング要素を強制非表示
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = 'none';
        console.log('[DEBUG] ローディング要素を非表示にしました');
    }
    
    // メインコンテンツに直接メッセージを表示
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; background: white;">
                <h2 style="color: #333; margin-bottom: 20px;">🔧 診断結果</h2>
                <div style="text-align: left; max-width: 400px; margin: 0 auto;">
                    <p><strong>JavaScript実行:</strong> ✅ 成功</p>
                    <p><strong>DOM操作:</strong> ✅ 成功</p>
                    <p><strong>env.js読み込み:</strong> ${window.ENV ? '✅ 成功' : '❌ 失敗'}</p>
                    <p><strong>LIFF SDK:</strong> ${typeof liff !== 'undefined' ? '✅ 読み込み済み' : '❌ 未読み込み'}</p>
                    <p><strong>LIFF ID:</strong> ${window.ENV?.LIFF_ID || '❌ 未設定'}</p>
                </div>
                <div style="margin-top: 30px;">
                    <button onclick="testLiff()" 
                            style="padding: 12px 24px; 
                                   background: #00B900; 
                                   color: white; 
                                   border: none; 
                                   border-radius: 8px; 
                                   margin: 5px;
                                   cursor: pointer;">
                        LIFF初期化テスト
                    </button>
                    <button onclick="location.reload()" 
                            style="padding: 12px 24px; 
                                   background: #666; 
                                   color: white; 
                                   border: none; 
                                   border-radius: 8px; 
                                   margin: 5px;
                                   cursor: pointer;">
                        再読み込み
                    </button>
                </div>
                <div id="test-result" style="margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 8px; display: none;">
                    <h3>テスト結果</h3>
                    <div id="test-message"></div>
                </div>
            </div>
        `;
        console.log('[DEBUG] メッセージを表示しました');
    } else {
        console.error('[ERROR] main-content要素が見つかりません');
        // bodyに直接追加
        document.body.innerHTML = `
            <div style="text-align: center; padding: 40px 20px;">
                <h2>❌ DOM要素エラー</h2>
                <p>main-content要素が見つかりません</p>
                <button onclick="location.reload()">再読み込み</button>
            </div>
        `;
    }
}

// LIFF初期化テスト関数
window.testLiff = async function() {
    const resultDiv = document.getElementById('test-result');
    const messageDiv = document.getElementById('test-message');
    
    if (resultDiv) resultDiv.style.display = 'block';
    if (messageDiv) messageDiv.innerHTML = '初期化中...';
    
    try {
        if (typeof liff === 'undefined') {
            throw new Error('LIFF SDKが読み込まれていません');
        }
        
        if (!window.ENV?.LIFF_ID) {
            throw new Error('LIFF IDが設定されていません');
        }
        
        console.log('[DEBUG] LIFF初期化開始:', window.ENV.LIFF_ID);
        
        // 5秒タイムアウト
        const initPromise = liff.init({ liffId: window.ENV.LIFF_ID });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('5秒でタイムアウト')), 5000);
        });
        
        await Promise.race([initPromise, timeoutPromise]);
        
        if (messageDiv) {
            messageDiv.innerHTML = `
                <p style="color: #00B900;">✅ LIFF初期化成功</p>
                <p>ログイン状態: ${liff.isLoggedIn() ? 'ログイン済み' : 'ログイン必要'}</p>
            `;
        }
        
        if (!liff.isLoggedIn()) {
            setTimeout(() => {
                liff.login();
            }, 2000);
        }
        
    } catch (error) {
        console.error('[ERROR] LIFF初期化エラー:', error);
        if (messageDiv) {
            messageDiv.innerHTML = `
                <p style="color: #ff4444;">❌ LIFF初期化失敗</p>
                <p>エラー: ${error.message}</p>
            `;
        }
    }
};

// 即座に実行
console.log('[DEBUG] 1秒後にローディング強制停止');
setTimeout(forceStopLoading, 1000);

