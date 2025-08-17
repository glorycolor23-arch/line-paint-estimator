// LIFF環境変数設定（安全版）
window.ENV = {
    // 環境に応じたLIFF ID設定
    LIFF_ID: (() => {
        const hostname = window.location.hostname;
        
        // ローカル環境
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'dummy_liff_id';
        }
        
        // 本番環境（実際のLIFF IDを設定）
        return '2007914959-XP5Rpoay';
    })(),
    
    // 環境判定
    IS_LOCAL: (() => {
        const hostname = window.location.hostname;
        return hostname === 'localhost' || hostname === '127.0.0.1';
    })(),
    
    // API エンドポイント設定
    API_BASE_URL: window.location.origin,
    
    // デバッグモード（ローカル環境でのみ有効）
    DEBUG: (() => {
        const hostname = window.location.hostname;
        return hostname === 'localhost' || hostname === '127.0.0.1';
    })()
};

// ローカルテスト設定
window.ENV.LOCAL_TEST = window.ENV.IS_LOCAL;

// 開発環境でのみログ出力
if (window.ENV.DEBUG) {
    console.log('ENV設定:', window.ENV);
}

// 本番環境では機密情報をコンソールに出力しない
if (!window.ENV.IS_LOCAL) {
    console.log('本番環境で動作中');
}

