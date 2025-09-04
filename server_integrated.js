const { Client, middleware } = require('@line/bot-sdk');
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const { google } = require('googleapis');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'dummy_token',
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'dummy_secret',
};

// 環境変数チェック
const requiredEnvVars = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  // 他の必要な環境変数
];

// 環境変数の検証
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`警告: 環境変数 ${envVar} が設定されていません。`);
  }
}

// LINEクライアントの初期化
const client = new Client(config);

// ミドルウェアの設定
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静的ファイル配信の設定（新システム用）
app.use(express.static('public'));

// LIFFアプリ用の静的ファイル配信
app.use('/liff', express.static('liff'));

// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB制限
});

// セッション管理（新システム用）
const sessions = {};

// セッションIDの生成関数
function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// 概算見積もり計算関数
function calculateEstimate(formData) {
  // 基本情報の取得
  const floors = formData.floors;
  const layout = formData.layout;
  const buildingAge = formData.buildingAge;
  const paintHistory = formData.paintHistory;
  const paintAge = formData.paintAge;
  const workType = formData.workType;
  const wallMaterial = formData.wallMaterial;
  const roofMaterial = formData.roofMaterial;
  const leakage = formData.leakage;
  const neighborDistance = formData.neighborDistance;
  const paintGrade = formData.paintGrade;
  
  // 面積の計算（仮の計算式）
  let area = 0;
  
  // 階数による基本面積
  if (floors === '1階建て') {
    area = 120; // 1階建ての基本面積（m²）
  } else if (floors === '2階建て') {
    area = 180; // 2階建ての基本面積（m²）
  } else if (floors === '3階建て') {
    area = 240; // 3階建ての基本面積（m²）
  }
  
  // 間取りによる調整
  if (layout.includes('1')) {
    area *= 0.8; // 1Kなどの小さい間取り
  } else if (layout.includes('2')) {
    area *= 0.9; // 2Kなどの間取り
  } else if (layout.includes('3')) {
    area *= 1.0; // 3Kなどの間取り
  } else if (layout.includes('4')) {
    area *= 1.1; // 4Kなどの大きい間取り
  }
  
  // 単価の設定
  let unitPrice = 0;
  if (paintGrade === 'コストが安い塗料') {
    unitPrice = 2500; // 1m²あたり2,500円
  } else if (paintGrade === '一般的な塗料') {
    unitPrice = 3500; // 1m²あたり3,500円
  } else if (paintGrade === '耐久性が高い塗料') {
    unitPrice = 4500; // 1m²あたり4,500円
  } else if (paintGrade === '遮熱性が高い塗料') {
    unitPrice = 5000; // 1m²あたり5,000円
  }
  
  // 工事内容による調整
  let wallCost = 0;
  let roofCost = 0;
  
  if (workType === '外壁塗装のみ' || workType === '外壁・屋根塗装') {
    wallCost = area * unitPrice;
  }
  
  if (workType === '屋根塗装のみ' || workType === '外壁・屋根塗装') {
    // 屋根面積は外壁面積の約40%と仮定
    const roofArea = area * 0.4;
    roofCost = roofArea * unitPrice * 0.8; // 屋根は単価が少し安い
  }
  
  // 築年数による調整係数
  let ageFactor = 1.0;
  if (buildingAge === '新築') {
    ageFactor = 0.9; // 新築は比較的簡単
  } else if (buildingAge === '〜50年') {
    ageFactor = 1.2; // 古い建物は追加作業が必要
  }
  
  // 雨漏りによる追加コスト
  let leakageCost = 0;
  if (leakage === '雨の日に水滴が落ちる') {
    leakageCost = 100000; // 雨漏り修理の追加費用
  } else if (leakage === '天井にシミがある') {
    leakageCost = 50000; // 軽度の雨漏り修理
  }
  
  // 隣家との距離による作業難易度調整
  let distanceFactor = 1.0;
  if (neighborDistance === '30cm以下') {
    distanceFactor = 1.2; // 非常に狭い
  } else if (neighborDistance === '50cm以下') {
    distanceFactor = 1.1; // 狭い
  } else if (neighborDistance === '70cm以下') {
    distanceFactor = 1.05; // やや狭い
  }
  
  // 総コストの計算
  const baseCost = (wallCost + roofCost) * ageFactor * distanceFactor;
  const totalCost = Math.round((baseCost + leakageCost) / 10000) * 10000; // 1万円単位に丸める
  
  // 内訳の計算
  const details = {
    wallCost: Math.round(wallCost),
    roofCost: Math.round(roofCost),
    leakageCost: leakageCost,
    ageFactor: ageFactor,
    distanceFactor: distanceFactor,
    area: Math.round(area)
  };
  
  return {
    totalCost: totalCost,
    details: details
  };
}

// ===== 新システム用APIエンドポイント =====

// セッション作成API
app.post('/api/create-session', (req, res) => {
  const sessionId = generateSessionId();
  sessions[sessionId] = { createdAt: new Date() };
  res.json({ success: true, sessionId });
});

// フォームデータ保存API
app.post('/api/save-form-data', (req, res) => {
  const { sessionId, formData } = req.body;
  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({ success: false, message: 'セッションが無効です' });
  }
  
  sessions[sessionId].formData = formData;
  
  // 概算見積もり計算
  const estimateResult = calculateEstimate(formData);
  sessions[sessionId].estimateResult = estimateResult;
  
  res.json({ success: true, estimateResult });
});

// セッションデータ取得API
app.get('/api/get-session-data/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({ success: false, message: 'セッションが無効です' });
  }
  
  res.json({ 
    success: true, 
    data: sessions[sessionId].formData,
    estimateResult: sessions[sessionId].estimateResult
  });
});

// LINE連携API
app.post('/api/link-session-to-line', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({ success: false, message: 'セッションが無効です' });
  }
  
  // セッションにLINE連携フラグを設定
  sessions[sessionId].lineLinked = true;
  
  res.json({ success: true });
});

// 詳細見積もり依頼API
app.post('/api/submit-detail-request', upload.fields([
  { name: 'photoFront', maxCount: 1 },
  { name: 'photoBack', maxCount: 1 },
  { name: 'photoLeft', maxCount: 1 },
  { name: 'photoRight', maxCount: 1 },
  { name: 'photoRoof', maxCount: 1 },
  { name: 'photoDamage', maxCount: 1 }
]), async (req, res) => {
  try {
    const { customerData } = req.body;
    const parsedCustomerData = JSON.parse(customerData);
    const sessionId = parsedCustomerData.sessionId || req.body.sessionId;
    
    // ファイルの保存処理
    const uploadedFiles = req.files;
    const fileUrls = {};
    
    // ファイルパスの記録
    for (const [fieldName, files] of Object.entries(uploadedFiles)) {
      if (files && files.length > 0) {
        fileUrls[fieldName] = files[0].path;
      }
    }
    
    // セッションデータの取得
    const sessionData = sessionId && sessions[sessionId] ? sessions[sessionId] : null;
    
    // Google Sheetsにデータを保存（既存コードを活用）
    // ...
    
    // LINE通知を送信（既存コードを活用）
    if (parsedCustomerData.lineId) {
      await client.pushMessage(parsedCustomerData.lineId, {
        type: 'text',
        text: `詳細見積もり依頼を受け付けました。担当者より2営業日以内にご連絡いたします。`
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('詳細見積もり依頼エラー:', error);
    res.status(500).json({ success: false, message: 'サーバーエラーが発生しました' });
  }
});

// ===== 既存のLINE Webhook =====

// LINE Webhook
app.post('/webhook', middleware(config), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(async (event) => {
      // 友達登録イベント
      if (event.type === 'follow') {
        const userId = event.source.userId;
        
        // ウェルカムメッセージを送信
        await client.pushMessage(userId, {
          type: 'text',
          text: `友達登録ありがとうございます！外壁塗装の概算見積もりを確認できます。`
        });
        
        // 新システムとの連携（必要に応じて）
        // ...
      }
      
      // メッセージイベント
      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        const messageText = event.message.text;
        
        // メッセージに応じた処理
        if (messageText.includes('見積もり') || messageText.includes('相談')) {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `外壁塗装の見積もりをご希望ですね。以下のURLから質問に答えて、概算見積もりを確認できます。\n\nhttps://your-domain.com/`
          });
        } else {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `メッセージありがとうございます。外壁塗装に関するご質問があればお気軽にどうぞ。`
          });
        }
      }
    }));
    
    res.status(200).end();
  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).end();
  }
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

