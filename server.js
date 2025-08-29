/**
 * 外壁塗装見積もりシステム サーバーサイド
 * 
 * 機能:
 * - Webフォームからのデータ受信
 * - LINE友達登録連携
 * - 概算見積もり計算
 * - LINE Messaging API連携
 * - 詳細見積もり依頼処理
 * - Google Sheets連携
 */

// 必要なモジュールのインポート
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const multer = require('multer');
const { google } = require('googleapis');
require('dotenv').config();

// Expressアプリケーションの初期化
const app = express();
const PORT = process.env.PORT || 3000;

// ミドルウェアの設定
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静的ファイル配信
app.use(express.static(path.join(__dirname, 'public')));

// 一時データストレージ（本番環境ではRedisやデータベースを使用）
const sessionData = new Map();

// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB制限
});

// LINE設定
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!LINE_CHANNEL_ACCESS_TOKEN) {
  console.warn('[WARN] LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
}

// Google Sheets設定
const GOOGLE_SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

if (!GOOGLE_SPREADSHEET_ID) {
  console.warn('[WARN] GOOGLE_SPREADSHEET_ID が設定されていません');
}

if (!GOOGLE_SERVICE_ACCOUNT_KEY) {
  console.warn('[WARN] GOOGLE_SERVICE_ACCOUNT_KEY が設定されていません');
}

/**
 * ルーティング設定
 */

// メインページ
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// フォームページ
app.get('/form', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'form.html'));
});

// LINE登録ページ
app.get('/line-register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'line-register.html'));
});

// 詳細見積もり依頼ページ
app.get('/detail-form', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'detail-form.html'));
});

// セッション作成API
app.post('/api/create-session', (req, res) => {
  try {
    const sessionId = crypto.randomUUID();
    sessionData.set(sessionId, {
      created: new Date(),
      data: {},
      status: 'created'
    });
    
    res.json({
      success: true,
      sessionId: sessionId
    });
  } catch (error) {
    console.error('[ERROR] セッション作成エラー:', error);
    res.status(500).json({
      success: false,
      message: 'セッション作成に失敗しました'
    });
  }
});

// フォームデータ保存API
app.post('/api/save-form-data', (req, res) => {
  try {
    const { sessionId, formData } = req.body;
    
    if (!sessionId || !sessionData.has(sessionId)) {
      return res.status(400).json({
        success: false,
        message: '無効なセッションIDです'
      });
    }
    
    const session = sessionData.get(sessionId);
    session.data = {
      ...session.data,
      ...formData
    };
    session.status = 'form_completed';
    
    // バックアップとしてJSONファイルに保存
    const backupDir = path.join(__dirname, 'data');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    fs.writeFileSync(
      path.join(backupDir, `${sessionId}.json`),
      JSON.stringify(session, null, 2)
    );
    
    res.json({
      success: true,
      message: 'データが保存されました',
      estimateResult: calculateEstimate(formData)
    });
  } catch (error) {
    console.error('[ERROR] フォームデータ保存エラー:', error);
    res.status(500).json({
      success: false,
      message: 'データの保存に失敗しました'
    });
  }
});

// セッションデータ取得API
app.get('/api/get-session-data/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId || !sessionData.has(sessionId)) {
      return res.status(400).json({
        success: false,
        message: '無効なセッションIDです'
      });
    }
    
    const session = sessionData.get(sessionId);
    
    res.json({
      success: true,
      data: session.data,
      status: session.status,
      estimateResult: calculateEstimate(session.data)
    });
  } catch (error) {
    console.error('[ERROR] セッションデータ取得エラー:', error);
    res.status(500).json({
      success: false,
      message: 'データの取得に失敗しました'
    });
  }
});

// LINE Webhook
app.post('/webhook', (req, res) => {
  if (!LINE_CHANNEL_SECRET || !LINE_CHANNEL_ACCESS_TOKEN) {
    return res.status(400).json({
      success: false,
      message: 'LINE設定が不足しています'
    });
  }
  
  try {
    // 署名検証
    const signature = req.headers['x-line-signature'];
    const body = JSON.stringify(req.body);
    const hash = crypto
      .createHmac('sha256', LINE_CHANNEL_SECRET)
      .update(body)
      .digest('base64');
    
    if (signature !== hash) {
      return res.status(401).json({
        success: false,
        message: '不正なリクエストです'
      });
    }
    
    // イベント処理
    const events = req.body.events;
    events.forEach(async (event) => {
      if (event.type === 'follow') {
        // 友達登録イベント
        await handleFollowEvent(event);
      } else if (event.type === 'message' && event.message.type === 'text') {
        // メッセージイベント
        await handleMessageEvent(event);
      }
    });
    
    res.status(200).end();
  } catch (error) {
    console.error('[ERROR] LINE Webhookエラー:', error);
    res.status(500).end();
  }
});

// 詳細見積もり依頼API
app.post('/api/submit-detail-request', upload.array('photos', 6), async (req, res) => {
  try {
    const { sessionId, customerData } = req.body;
    const files = req.files;
    
    // セッションデータの取得
    let sessionInfo = null;
    if (sessionId && sessionData.has(sessionId)) {
      sessionInfo = sessionData.get(sessionId);
    }
    
    // 詳細データの保存
    const detailData = {
      timestamp: new Date().toISOString(),
      customerInfo: JSON.parse(customerData),
      formData: sessionInfo ? sessionInfo.data : null,
      estimateResult: sessionInfo ? calculateEstimate(sessionInfo.data) : null,
      files: files.map(file => ({
        fieldname: file.fieldname,
        filename: file.filename,
        path: file.path
      }))
    };
    
    // バックアップとしてJSONファイルに保存
    const backupDir = path.join(__dirname, 'data', 'details');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const detailId = crypto.randomUUID();
    fs.writeFileSync(
      path.join(backupDir, `${detailId}.json`),
      JSON.stringify(detailData, null, 2)
    );
    
    // Google Sheetsに保存
    if (GOOGLE_SPREADSHEET_ID && GOOGLE_SERVICE_ACCOUNT_KEY) {
      await saveToGoogleSheets(detailData);
    }
    
    // LINE通知
    if (LINE_CHANNEL_ACCESS_TOKEN && detailData.customerInfo.lineId) {
      await sendLineNotification(
        detailData.customerInfo.lineId,
        '詳細見積もり依頼を受け付けました。担当者より連絡いたします。'
      );
    }
    
    res.json({
      success: true,
      message: '詳細見積もり依頼を受け付けました',
      detailId: detailId
    });
  } catch (error) {
    console.error('[ERROR] 詳細見積もり依頼エラー:', error);
    res.status(500).json({
      success: false,
      message: '詳細見積もり依頼の送信に失敗しました'
    });
  }
});

/**
 * ヘルパー関数
 */

// 概算見積もり計算関数
function calculateEstimate(formData) {
  if (!formData) return null;
  
  try {
    // 基本単価設定
    const basePricePerSqm = {
      'コストが安い塗料': 2500,
      '一般的な塗料': 3500,
      '耐久性が高い塗料': 4500,
      '遮熱性が高い塗料': 5000
    };
    
    // 建物サイズによる面積概算（m²）
    const sizeFactors = {
      '1階建て': {
        '1K': 40,
        '1DK': 45,
        '1LDK': 50,
        '2K': 55,
        '2DK': 60,
        '2LDK': 65,
        '3K': 70,
        '3DK': 75,
        '3LDK': 80,
        '4K': 85,
        '4DK': 90,
        '4LDK': 95
      },
      '2階建て': {
        '1K': 60,
        '1DK': 70,
        '1LDK': 80,
        '2K': 90,
        '2DK': 100,
        '2LDK': 110,
        '3K': 120,
        '3DK': 130,
        '3LDK': 140,
        '4K': 150,
        '4DK': 160,
        '4LDK': 170
      },
      '3階建て': {
        '1K': 90,
        '1DK': 100,
        '1LDK': 110,
        '2K': 120,
        '2DK': 130,
        '2LDK': 140,
        '3K': 150,
        '3DK': 160,
        '3LDK': 170,
        '4K': 180,
        '4DK': 190,
        '4LDK': 200
      }
    };
    
    // 築年数による係数
    const ageFactors = {
      '新築': 0.9,
      '〜10年': 1.0,
      '〜20年': 1.1,
      '〜30年': 1.2,
      '〜40年': 1.3,
      '〜50年': 1.4
    };
    
    // 雨漏りによる追加費用
    const leakageAddition = {
      '雨の日に水滴が落ちる': 100000,
      '天井にシミがある': 50000,
      'ない': 0
    };
    
    // 隣家との距離による係数
    const distanceFactors = {
      '30cm以下': 1.2,
      '50cm以下': 1.1,
      '70cm以下': 1.05,
      '70cm以上': 1.0
    };
    
    // 面積計算
    const floors = formData.floors || '2階建て';
    const layout = formData.layout || '3LDK';
    const estimatedArea = sizeFactors[floors][layout] || 100;
    
    // 単価計算
    const paintGrade = formData.paintGrade || '一般的な塗料';
    const pricePerSqm = basePricePerSqm[paintGrade] || 3500;
    
    // 工事内容による計算
    const workType = formData.workType || '外壁・屋根塗装';
    let wallArea = 0;
    let roofArea = 0;
    
    if (workType === '外壁塗装のみ' || workType === '外壁・屋根塗装') {
      wallArea = estimatedArea * 2.5; // 外壁面積の概算
    }
    
    if (workType === '屋根塗装のみ' || workType === '外壁・屋根塗装') {
      roofArea = estimatedArea * 0.8; // 屋根面積の概算
    }
    
    // 係数適用
    const age = formData.buildingAge || '〜20年';
    const ageFactor = ageFactors[age] || 1.0;
    
    const distance = formData.neighborDistance || '70cm以上';
    const distanceFactor = distanceFactors[distance] || 1.0;
    
    // 雨漏り追加費用
    const leakage = formData.leakage || 'ない';
    const leakageAdditionalCost = leakageAddition[leakage] || 0;
    
    // 合計金額計算
    const wallCost = wallArea * pricePerSqm * ageFactor * distanceFactor;
    const roofCost = roofArea * (pricePerSqm * 1.2) * ageFactor; // 屋根は1.2倍の単価
    
    const scaffoldingCost = wallArea * 800; // 足場代
    const waterproofingCost = estimatedArea * 500; // 防水工事
    const otherCost = 50000; // その他経費
    
    // 内訳
    const breakdown = {
      wallPainting: Math.round(wallCost),
      roofPainting: Math.round(roofCost),
      scaffolding: Math.round(scaffoldingCost),
      waterproofing: Math.round(waterproofingCost),
      leakageRepair: leakageAdditionalCost,
      otherCosts: otherCost
    };
    
    // 総額
    const totalCost = 
      (wallCost > 0 ? wallCost : 0) + 
      (roofCost > 0 ? roofCost : 0) + 
      scaffoldingCost + 
      waterproofingCost + 
      leakageAdditionalCost + 
      otherCost;
    
    return {
      estimatedArea: {
        wall: Math.round(wallArea),
        roof: Math.round(roofArea),
        total: Math.round(estimatedArea)
      },
      pricePerSqm: pricePerSqm,
      factors: {
        age: ageFactor,
        distance: distanceFactor
      },
      breakdown: breakdown,
      totalCost: Math.round(totalCost),
      formattedTotalCost: Math.round(totalCost).toLocaleString() + '円'
    };
  } catch (error) {
    console.error('[ERROR] 見積もり計算エラー:', error);
    return null;
  }
}

// LINE友達登録イベント処理
async function handleFollowEvent(event) {
  try {
    const userId = event.source.userId;
    
    // ウェルカムメッセージ送信
    await sendLineMessage(userId, [
      {
        type: 'text',
        text: '友達登録ありがとうございます！外壁塗装の概算見積もりをご案内します。'
      },
      {
        type: 'text',
        text: 'フォームで入力いただいた内容に基づいて、概算見積もりを表示します。'
      }
    ]);
    
    // TODO: ユーザーIDとセッションの紐付け処理
    
  } catch (error) {
    console.error('[ERROR] LINE友達登録イベント処理エラー:', error);
  }
}

// LINEメッセージイベント処理
async function handleMessageEvent(event) {
  try {
    const userId = event.source.userId;
    const message = event.message.text;
    
    // 簡易な自動応答
    if (message.includes('見積もり') || message.includes('見積り') || message.includes('見積')) {
      await sendLineMessage(userId, [
        {
          type: 'text',
          text: '概算見積もりは以下のURLから確認できます。\nhttps://example.com/estimate'
        }
      ]);
    } else if (message.includes('相談') || message.includes('質問')) {
      await sendLineMessage(userId, [
        {
          type: 'text',
          text: 'ご質問がございましたら、こちらでお答えします。\n具体的な内容をお知らせください。'
        }
      ]);
    } else {
      await sendLineMessage(userId, [
        {
          type: 'text',
          text: 'メッセージありがとうございます。\n担当者が確認後、回答いたします。'
        }
      ]);
    }
  } catch (error) {
    console.error('[ERROR] LINEメッセージイベント処理エラー:', error);
  }
}

// LINE見積もり結果送信
async function sendEstimateResult(userId, estimateData, formData) {
  try {
    if (!userId || !estimateData) return;
    
    const messages = [
      {
        type: 'text',
        text: `【概算見積もり結果】\n\n総額: ${estimateData.formattedTotalCost}\n\n※こちらは概算金額です。正確な金額は現地調査後にご案内いたします。`
      },
      {
        type: 'text',
        text: `【内訳】\n・外壁塗装: ${estimateData.breakdown.wallPainting.toLocaleString()}円\n・屋根塗装: ${estimateData.breakdown.roofPainting.toLocaleString()}円\n・足場設置: ${estimateData.breakdown.scaffolding.toLocaleString()}円\n・防水工事: ${estimateData.breakdown.waterproofing.toLocaleString()}円\n・その他: ${(estimateData.breakdown.leakageRepair + estimateData.breakdown.otherCosts).toLocaleString()}円`
      },
      {
        type: 'template',
        altText: '詳細見積もりのご案内',
        template: {
          type: 'buttons',
          title: '詳細見積もりのご案内',
          text: '現地調査による詳細な見積もりをご希望の方は下記ボタンからお申し込みください。',
          actions: [
            {
              type: 'uri',
              label: '詳細見積もりを依頼する',
              uri: 'https://example.com/detail-form'
            }
          ]
        }
      }
    ];
    
    await sendLineMessage(userId, messages);
  } catch (error) {
    console.error('[ERROR] LINE見積もり結果送信エラー:', error);
  }
}

// LINEメッセージ送信
async function sendLineMessage(userId, messages) {
  try {
    if (!LINE_CHANNEL_ACCESS_TOKEN) return;
    
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: messages
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
  } catch (error) {
    console.error('[ERROR] LINEメッセージ送信エラー:', error);
  }
}

// LINE通知送信
async function sendLineNotification(userId, text) {
  try {
    await sendLineMessage(userId, [
      {
        type: 'text',
        text: text
      }
    ]);
  } catch (error) {
    console.error('[ERROR] LINE通知送信エラー:', error);
  }
}

// Google Sheetsへの保存
async function saveToGoogleSheets(data) {
  try {
    if (!GOOGLE_SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_KEY) return;
    
    // サービスアカウント認証
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    
    // データの整形
    const customerInfo = data.customerInfo;
    const formData = data.formData || {};
    const estimateResult = data.estimateResult || {};
    
    const rowData = [
      new Date().toISOString(), // タイムスタンプ
      customerInfo.name || '',
      customerInfo.furigana || '',
      customerInfo.email || '',
      customerInfo.phone || '',
      customerInfo.postalCode || '',
      customerInfo.address || '',
      customerInfo.preferredDate1 || '',
      customerInfo.preferredDate2 || '',
      customerInfo.message || '',
      formData.floors || '',
      formData.layout || '',
      formData.buildingAge || '',
      formData.paintHistory || '',
      formData.paintAge || '',
      formData.workType || '',
      formData.wallMaterial || '',
      formData.roofMaterial || '',
      formData.leakage || '',
      formData.neighborDistance || '',
      formData.paintGrade || '',
      formData.timeframe || '',
      estimateResult.totalCost ? estimateResult.totalCost.toString() : '',
      data.files ? data.files.length.toString() : '0'
    ];
    
    // スプレッドシートに追加
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SPREADSHEET_ID,
      range: 'Sheet1!A:X', // 適切なシート名とレンジに変更
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [rowData]
      }
    });
    
    return true;
  } catch (error) {
    console.error('[ERROR] Google Sheets保存エラー:', error);
    return false;
  }
}

// サーバー起動
app.listen(PORT, '0.0.0.0', () => {
  console.info(`[INFO] サーバーが起動しました: http://0.0.0.0:${PORT}`);
  console.info(`[INFO] 環境変数チェック:
  - NODE_ENV: ${process.env.NODE_ENV || 'development'}
  - PORT: ${PORT}`);
});

// エラーハンドリング
app.use((err, req, res, next) => {
  console.error('[ERROR] サーバーエラー:', err);
  res.status(500).json({
    success: false,
    message: 'サーバーエラーが発生しました'
  });
});

