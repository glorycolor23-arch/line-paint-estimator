// LIFF環境変数設定
window.ENV = {
    // 本番環境用のLIFF ID（LINE Developers Consoleで取得）
    LIFF_ID: '2007914959-XP5Rpoay',
    
    // ローカルテスト用設定
    LOCAL_TEST: true,  // ローカルテスト時はtrue、本番時はfalse
    
    // API エンドポイント設定
    API_BASE_URL: window.location.origin,
    
    // デバッグモード
    DEBUG: true
};

// 環境判定
window.ENV.IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// ローカル環境の場合はテストモードを有効化
if (window.ENV.IS_LOCAL) {
    window.ENV.LOCAL_TEST = true;
    window.ENV.LIFF_ID = 'dummy_liff_id';  // ローカルテスト用ダミーID
}

console.log('ENV設定:', window.ENV);

