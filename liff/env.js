// LIFF環境変数設定
window.ENV = {
    // 本番環境用のLIFF ID（.env.exampleのLIFF_IDと同じ値を設定してください）
    LIFF_ID: 'your_liff_id_here',
    
    // 環境判定
    IS_LOCAL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    
    // API エンドポイント設定
    API_BASE_URL: window.location.origin,
    
    // デバッグモード（本番環境では false に設定）
    DEBUG: true
};

// ローカル環境の場合はテストモードを有効化
if (window.ENV.IS_LOCAL) {
    window.ENV.LIFF_ID = 'dummy_liff_id';  // ローカルテスト用ダミーID
    console.log('ローカルテストモード: LIFF初期化をスキップします');
}

// 設定確認用ログ
if (window.ENV.DEBUG) {
    console.log('ENV設定:', window.ENV);
}

