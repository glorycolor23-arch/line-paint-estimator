const { Client, middleware } = require('@line/bot-sdk');
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/healthz', (req, res) => res.status(200).send('ok'));


// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'dummy_token',
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'dummy_secret',
};

// 環境変数チェック
const requiredEnvVars = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'LIFF_ID'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.warn('[WARN] 以下の環境変数が設定されていません:');
  missingEnvVars.forEach(varName => console.warn(`  - ${varName}`));
  console.warn('[WARN] LINE Bot機能は無効化されます。');
}

const client = new Client(config);

// LINE Middlewareの設定（環境変数が設定されている場合のみ）
let lineMiddleware;
if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET) {
  lineMiddleware = middleware(config);
} else {
  // ダミーミドルウェア（環境変数未設定時）
  lineMiddleware = (req, res, next) => {
    console.warn('[WARN] LINE Webhook呼び出しされましたが、環境変数が未設定です');
    res.status(200).end('OK');
  };
}

// Cloudinary設定（画像アップロード用）
const cloudinary = require('cloudinary').v2;

if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('[INFO] Cloudinary設定完了');
} else {
  console.warn('[WARN] Cloudinary環境変数が未設定です。画像アップロード機能は無効化されます。');
}

// Google Sheets設定
const sheets = google.sheets('v4');
let auth = null;

if (process.env.GOOGLE_PROJECT_ID && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
  auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  console.log('[INFO] Google Sheets設定完了');
} else {
  console.warn('[WARN] Google Sheets環境変数が未設定です。スプレッドシート機能は無効化されます。');
}

// メール送信設定
const nodemailer = require('nodemailer');
let transporter = null;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  console.log('[INFO] メール送信設定完了');
} else {
  console.warn('[WARN] メール送信環境変数が未設定です。メール機能は無効化されます。');
}

// 静的ファイル配信
app.use('/liff', express.static(path.join(__dirname, 'liff')));

// ヘルスチェック用エンドポイント（Render用）
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'LINE Paint Estimator Server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// LIFF環境変数注入
app.get('/liff/env.js', (req, res) => {
  const liffId = process.env.LIFF_ID;
  const addUrl = process.env.LINE_ADD_FRIEND_URL || '';
  const mailUrl = process.env.EMAIL_WEBAPP_URL || '';
  
  res.setHeader('Content-Type', 'application/javascript');
  res.send(
    `window.ENV={LIFF_ID:${JSON.stringify(liffId)},FRIEND_ADD_URL:${JSON.stringify(addUrl)},EMAIL_WEBAPP_URL:${JSON.stringify(mailUrl)}};`
  );
});

// ファイルアップロード設定（スマートフォン対応）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB（スマートフォンの高解像度写真に対応）
    files: 10
  },
  fileFilter: (req, file, cb) => {
    console.log(`[DEBUG] アップロードファイル: ${file.originalname}, MIME: ${file.mimetype}`);
    
    // 対応する画像形式（iPhone HEIC/HEIF含む）
    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      'image/tiff',
      'image/heic',     // iPhone HEIC
      'image/heif',     // iPhone HEIF
      'image/avif',     // 次世代フォーマット
      'application/octet-stream' // iPhoneで時々このMIMEタイプになる場合がある
    ];
    
    // ファイル拡張子でも判定（MIMEタイプが正しく設定されない場合の対策）
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.heic', '.heif', '.avif'];
    const fileExtension = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];
    
    if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      console.log(`[WARN] 非対応ファイル形式: ${file.originalname}, MIME: ${file.mimetype}`);
      cb(new Error(`対応していないファイル形式です。JPEG、PNG、HEIC等の画像ファイルをアップロードしてください。`), false);
    }
  }
});

// Multerエラーハンドリングミドルウェア（スマートフォン対応）
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('[ERROR] Multerエラー:', err.code, err.message);
    
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'ファイルサイズが大きすぎます。1ファイルあたり15MB以下にしてください。スマートフォンで撮影した写真であれば通常は問題ありません。' 
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ 
        error: 'ファイル数が多すぎます。最大10ファイルまでです。' 
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ 
        error: '予期しないファイルフィールドです。' 
      });
    }
    
    return res.status(400).json({ 
      error: `ファイルアップロードエラー: ${err.message}` 
    });
  }
  
  if (err.message.includes('対応していないファイル形式')) {
    return res.status(400).json({ error: err.message });
  }
  
  next(err);
};

/* Webhook: 署名検証前に rawBody を確保 */
app.use('/webhook', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.post('/webhook', lineMiddleware, async (req, res) => {
  // 環境変数が未設定の場合は、ダミーミドルウェアで既にレスポンス済み
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_CHANNEL_SECRET) {
    return;
  }
  
  res.status(200).end('OK');
  try {
    for (const ev of (req.body.events || [])) await handleEvent(ev);
  } catch (e) {
    console.error('[webhook error]', e);
  }
});

// その他 API で使う JSON パーサ
app.use(express.json());

/* ===========================================================================
 * 簡素化されたLINEトーク処理（LIFF起動のみ）
 * ======================================================================== */
const sessions = new Map(); // {userId: {answers:{}, estimatedPrice:number, timestamp:number}}

// トリガー/コマンド
const TRIGGER_START = ['カンタン見積りを依頼', 'カンタン見積もりを依頼', '見積り', '見積もり'];
const CMD_RESET     = ['リセット','はじめからやり直す'];

// 概算計算（柔軟な計算式）
function calcRoughPrice(a){
  // 基本料金設定
  const BASE_PRICE = 1000000; // 基本料金：100万円
  
  // 係数設定（後で調整しやすいように分離）
  const COEFFICIENTS = {
    // 階数による係数
    floors: {
      '1階建て': 1.0,
      '2階建て': 1.15,  // +15%
      '3階建て': 1.30   // +30%
    },
    
    // 間取りによる係数
    layout: {
      '1K': 0.8, '1DK': 0.85, '1LDK': 0.9,
      '2K': 1.0, '2DK': 1.05, '2LDK': 1.1,
      '3K': 1.15, '3DK': 1.2, '4K': 1.25, '4DK': 1.3, '4LDK': 1.35
    },
    
    // 工事内容による追加料金
    work: {
      '外壁塗装': 220000,
      '屋根塗装': 180000,
      '外壁塗装+屋根塗装': 380000  // セット割引
    },
    
    // 外壁材による係数
    wallMaterial: {
      'モルタル': 1.0,
      'サイディング': 1.05,
      'タイル': 1.2,
      'ALC': 1.1
    },
    
    // 外壁塗料による係数
    wallPaint: {
      'コストが安い塗料（耐久性 低い）': 0.8,
      '一般的な塗料（コスト 一般的）': 1.0,
      '耐久性が高い塗料（コスト 高い）': 1.3,
      '遮熱性が高い（コスト 高い）': 1.4
    },
    
    // 屋根材による係数
    roofMaterial: {
      '瓦': 1.1,
      'スレート': 1.0,
      'ガルバリウム': 1.15,
      'トタン': 0.9
    },
    
    // 屋根塗料による係数
    roofPaint: {
      'コストが安い塗料（耐久性 低い）': 0.8,
      '一般的な塗料（コスト 一般的）': 1.0,
      '耐久性が高い塗料（コスト 高い）': 1.3,
      '遮熱性が高い（コスト 高い）': 1.4
    },
    
    // 築年数による係数
    age: {
      '新築': 0.8,
      '〜10年': 0.9,
      '〜20年': 1.0,
      '〜30年': 1.1,
      '〜40年': 1.2,
      '〜50年': 1.3,
      '51年以上': 1.4
    },
    
    // 雨漏りによる追加料金
    leak: {
      '雨の日に水滴が落ちる': 150000,
      '天井にシミがある': 100000,
      'ない': 0
    },
    
    // 隣家距離による係数（作業難易度）
    distance: {
      '30cm以下': 1.3,  // 作業困難
      '50cm以下': 1.2,
      '70cm以下': 1.1,
      '70cm以上': 1.0   // 標準
    }
  };

  let price = BASE_PRICE;
  
  // 階数による調整
  if (a.q1_floors && COEFFICIENTS.floors[a.q1_floors]) {
    price *= COEFFICIENTS.floors[a.q1_floors];
  }
  
  // 間取りによる調整
  if (a.q2_layout && COEFFICIENTS.layout[a.q2_layout]) {
    price *= COEFFICIENTS.layout[a.q2_layout];
  }
  
  // 築年数による調整
  if (a.q3_age && COEFFICIENTS.age[a.q3_age]) {
    price *= COEFFICIENTS.age[a.q3_age];
  }
  
  // 工事内容による追加
  if (a.q6_work && COEFFICIENTS.work[a.q6_work]) {
    price += COEFFICIENTS.work[a.q6_work];
  }
  
  // 外壁材による調整
  if (a.q7_wall && COEFFICIENTS.wallMaterial[a.q7_wall]) {
    price *= COEFFICIENTS.wallMaterial[a.q7_wall];
  }
  
  // 外壁塗料による調整
  if (a.q7_wall_paint && COEFFICIENTS.wallPaint[a.q7_wall_paint]) {
    price *= COEFFICIENTS.wallPaint[a.q7_wall_paint];
  }
  
  // 屋根材による調整
  if (a.q8_roof && COEFFICIENTS.roofMaterial[a.q8_roof]) {
    price *= COEFFICIENTS.roofMaterial[a.q8_roof];
  }
  
  // 屋根塗料による調整
  if (a.q8_roof_paint && COEFFICIENTS.roofPaint[a.q8_roof_paint]) {
    price *= COEFFICIENTS.roofPaint[a.q8_roof_paint];
  }
  
  // 雨漏りによる追加
  if (a.q9_leak && COEFFICIENTS.leak[a.q9_leak]) {
    price += COEFFICIENTS.leak[a.q9_leak];
  }
  
  // 隣家距離による調整
  if (a.q10_dist && COEFFICIENTS.distance[a.q10_dist]) {
    price *= COEFFICIENTS.distance[a.q10_dist];
  }

  return Math.round(price / 10000) * 10000; // 万円単位で丸める
}

// 回答サマリー生成
function summarize(a){
  const items = [];
  if (a.q1_floors) items.push(`階数: ${a.q1_floors}`);
  if (a.q2_layout) items.push(`間取り: ${a.q2_layout}`);
  if (a.q6_work) items.push(`工事: ${a.q6_work}`);
  return items.join(', ');
}

// 安全なメッセージ送信
async function safeReply(replyToken, messages) {
  if (!Array.isArray(messages)) messages = [messages];
  try {
    await client.replyMessage(replyToken, messages);
    return true;
  } catch (e) {
    console.error('[safeReply error]', e);
    return false;
  }
}

async function safePush(userId, messages) {
  if (!Array.isArray(messages)) messages = [messages];
  try {
    await client.pushMessage(userId, messages);
    return true;
  } catch (e) {
    console.error('[safePush error]', e);
    return false;
  }
}

// LIFF起動ボタンメッセージ作成
function buildLiffStartMessage() {
  return {
    type: 'flex',
    altText: 'カンタン見積もりはこちらから',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '外壁塗装の見積もり',
            size: 'xl',
            weight: 'bold',
            color: '#333333',
            align: 'center'
          },
          {
            type: 'text',
            text: '簡単な質問にお答えいただくだけで、概算見積もりをお出しします。',
            size: 'sm',
            color: '#666666',
            margin: 'md',
            wrap: true,
            align: 'center'
          },
          {
            type: 'separator',
            margin: 'xl'
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '📋 所要時間：約3分',
                size: 'sm',
                color: '#666666'
              },
              {
                type: 'text',
                text: '📱 スマホで簡単入力',
                size: 'sm',
                color: '#666666',
                margin: 'sm'
              },
              {
                type: 'text',
                text: '💰 概算見積もり即時表示',
                size: 'sm',
                color: '#666666',
                margin: 'sm'
              }
            ],
            margin: 'xl'
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#00B900',
            action: {
              type: 'uri',
              label: '見積もり開始',
              uri: `https://liff.line.me/${process.env.LIFF_ID}`
            }
          }
        ]
      }
    }
  };
}

// イベント処理（大幅簡素化）
async function handleEvent(ev){
  const userId = ev.source?.userId;
  if (!userId) return;

  console.log(`[DEBUG] イベント受信: ${ev.type}, ユーザー: ${userId}`);

  // text
  if (ev.type === 'message' && ev.message.type === 'text'){
    const text = (ev.message.text||'').trim();
    console.log(`[DEBUG] テキストメッセージ: ${text}`);

    // リセット
    if (CMD_RESET.includes(text)){
      sessions.delete(userId);
      console.log(`[DEBUG] セッションリセット: ${userId}`);
      await safeReply(ev.replyToken, { 
        type:'text', 
        text:'見積りをリセットしました。\n「カンタン見積りを依頼」と入力すると新しい見積りを開始できます。' 
      });
      return;
    }

    // 見積り開始
    if (TRIGGER_START.includes(text)){
      console.log(`[DEBUG] 見積り開始 - LIFF起動`);
      
      // 新しいセッションを作成（LIFF用）
      sessions.set(userId, {
        answers: {},
        estimatedPrice: 0,
        timestamp: Date.now()
      });
      
      await safeReply(ev.replyToken, buildLiffStartMessage());
      return;
    }

    // その他のメッセージには反応しない（普通のトーク）
    console.log(`[DEBUG] 通常メッセージ - 無反応`);
  }
}

/* ===========================================================================
 * 画像アップロード関数
 * ======================================================================== */

// 画像をBase64エンコードしてメールHTMLに埋め込み
function encodeImageToBase64(buffer, mimeType) {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/* ===========================================================================
 * スプレッドシート書き込み関数
 * ======================================================================== */

// 差し替え対象: writeToSpreadsheet 関数

async function writeToSpreadsheet(data) {
  try {
    const spreadsheetId = process.env.GSHEET_SPREADSHEET_ID;
    if (!spreadsheetId || !auth) {
      console.log('[WARN] スプレッドシート機能が無効化されています');
      return;
    }

    const authClient = await auth.getClient();
    const timestamp = new Date().toISOString();
    const estimate = data.estimate || { total: 0 }; // estimateオブジェクトを取得

    // スプレッドシートに書き込むデータ配列
    const values = [[
      timestamp,                         // A: Timestamp
      data.userId,                         // B: LINE_USER_ID
      data.name,                           // C: 氏名
      data.phone,                          // D: 電話番号
      data.zipcode,                        // E: 郵便番号
      `${data.address1} ${data.address2}`, // F: 住所（結合）
      data.answers.q1_floors || '',        // G: 階数
      data.answers.q2_rooms || '',         // H: 間取り
      data.answers.q3_age || '',           // I: 築年数
      data.answers.q4_work_type || '',     // J: 工事内容
      data.answers.q7_wall_material || '', // K: 外壁材
      data.answers.q8_roof_material || '', // L: 屋根材
      data.answers.q11_paint_grade || '',  // M: 塗料グレード
      data.answers.q12_urgency || '',      // N: 希望時期
      data.photoCount || 0,                // O: 受領写真枚数
      estimate.total || 0                  // P: 概算金額
    ]];

    await sheets.spreadsheets.values.append({
      auth: authClient,
      spreadsheetId: spreadsheetId,
      range: `${process.env.GSHEET_SHEET_NAME || 'Entries'}!A:P`, // A列からP列まで
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });

    console.log('[INFO] スプレッドシート書き込み成功');
  } catch (error) {
    console.error('[ERROR] スプレッドシート書き込みエラー:', error);
    // エラーを投げずに処理を継続させる
  }
}

/* ===========================================================================
 * メール送信関数
 * ======================================================================== */

async function sendEmail(data) {
  try {
    const toEmail = process.env.EMAIL_TO;
    if (!toEmail || !transporter) {
      console.log('[WARN] メール送信機能が無効化されています');
      return;
    }

    // 概算金額の計算
    const estimatedPrice = data.estimatedPrice || calcRoughPrice(data.answers);
    
    // 画像をBase64エンコードしてHTML埋め込み
    let imageSection = '';
    if (data.images && data.images.length > 0) {
      imageSection = `
        <h3>添付画像・図面</h3>
        <div style="display: flex; flex-wrap: wrap; gap: 10px;">
          ${data.images.map((image, index) => `
            <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px; max-width: 300px;">
              <img src="${image.base64}" alt="画像${index + 1}" style="max-width: 100%; height: auto; border-radius: 4px;">
              <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">
                ${image.filename} (${(image.size / 1024 / 1024).toFixed(2)}MB)
              </p>
            </div>
          `).join('')}
        </div>
      `;
    }

    const htmlContent = `
      <h2>見積り依頼フォーム送信</h2>
      
      <h3>お客様情報</h3>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
        <tr><td style="background-color: #f5f5f5;"><strong>お名前</strong></td><td>${data.name}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>電話番号</strong></td><td>${data.phone}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>郵便番号</strong></td><td>${data.zipcode}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>住所</strong></td><td>${data.address1} ${data.address2}</td></tr>
      </table>
      
      <h3>質問回答</h3>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
        <tr><td style="background-color: #f5f5f5;"><strong>階数</strong></td><td>${data.answers.q1_floors || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>間取り</strong></td><td>${data.answers.q2_layout || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>築年数</strong></td><td>${data.answers.q3_age || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>過去塗装</strong></td><td>${data.answers.q4_painted || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>前回塗装</strong></td><td>${data.answers.q5_last || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>工事内容</strong></td><td>${data.answers.q6_work || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>外壁種類</strong></td><td>${data.answers.q7_wall || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>外壁塗料</strong></td><td>${data.answers.q7_wall_paint || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>屋根種類</strong></td><td>${data.answers.q8_roof || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>屋根塗料</strong></td><td>${data.answers.q8_roof_paint || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>雨漏り</strong></td><td>${data.answers.q9_leak || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>隣家距離</strong></td><td>${data.answers.q10_dist || '—'}</td></tr>
      </table>
      
      <h3>概算見積り</h3>
      <p style="font-size: 24px; color: #00B900; font-weight: bold;">¥${estimatedPrice.toLocaleString()}</p>
      
      ${imageSection}
      
      <hr>
      <p><small>送信日時: ${new Date().toLocaleString('ja-JP')}</small></p>
    `;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: toEmail,
      subject: `【見積り依頼】${data.name}様より`,
      html: htmlContent
    };

    await transporter.sendMail(mailOptions);
    console.log('[INFO] メール送信成功');
  } catch (error) {
    console.error('[ERROR] メール送信エラー:', error);
    throw error;
  }
}

/* ===========================================================================
 * LIFF API エンドポイント
 * ======================================================================== */

// 質問回答保存API（LIFF用）
app.post('/api/answers', express.json(), async (req, res) => {
  try {
    const { userId, answers } = req.body;
    
    if (!userId || !answers) {
      return res.status(400).json({ error: 'ユーザーIDと回答データが必要です' });
    }
    
    console.log('[DEBUG] 質問回答保存:', userId, answers);
    
    // 概算価格を計算
    const estimatedPrice = calcRoughPrice(answers);
    
    // セッションに保存
    sessions.set(userId, {
      answers: answers,
      estimatedPrice: estimatedPrice,
      timestamp: Date.now()
    });
    
    console.log('[DEBUG] セッション保存完了:', { userId, estimatedPrice });
    
    res.json({ 
      success: true, 
      estimatedPrice: estimatedPrice,
      summary: summarize(answers)
    });
    
  } catch (error) {
    console.error('[ERROR] 質問回答保存エラー:', error);
    res.status(500).json({ error: '回答の保存に失敗しました' });
  }
});

// LIFF フォーム送信処理
app.post('/api/submit', upload.array('photos', 10), handleMulterError, async (req, res) => {
  try {
    console.log('[INFO] LIFF フォーム送信受信:', req.body);
    console.log('[INFO] 受信ファイル数:', req.files?.length || 0);
    
    const { userId, name, phone, zipcode, address1, address2 } = req.body;
    const photos = req.files || [];
    
    // 入力値検証
    if (!userId) {
      console.error('[ERROR] ユーザーIDが未設定');
      return res.status(400).json({ error: 'ユーザーIDが必要です' });
    }

    if (!name || !phone || !zipcode || !address1) {
      console.error('[ERROR] 必須項目が未入力:', { name, phone, zipcode, address1 });
      return res.status(400).json({ error: '必須項目が入力されていません' });
    }

    // セッションから質問回答データを取得
    const sess = sessions.get(userId);
    console.log('[DEBUG] セッション確認:', sess ? 'あり' : 'なし');
    
    if (!sess || !sess.answers) {
      console.error('[ERROR] セッションデータが見つかりません:', userId);
      console.log('[DEBUG] 現在のセッション一覧:', Array.from(sessions.keys()));
      return res.status(400).json({ error: '質問回答データが見つかりません。先に質問にお答えください。' });
    }

    // 画像をBase64エンコード（メール埋め込み用）
    const images = [];
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      try {
        if (!photo.buffer) {
          console.error(`[ERROR] 画像バッファが空: ${photo.originalname}`);
          continue;
        }
        
        // ファイルサイズチェック（15MB制限）
        if (photo.size > 15 * 1024 * 1024) {
          console.error(`[ERROR] ファイルサイズ超過: ${photo.originalname}, サイズ: ${photo.size}bytes`);
          continue;
        }
        
        console.log(`[INFO] 画像処理開始: ${photo.originalname}, サイズ: ${(photo.size / 1024 / 1024).toFixed(2)}MB`);
        
        // Base64エンコード
        const base64Image = encodeImageToBase64(photo.buffer, photo.mimetype);
        images.push({
          filename: photo.originalname,
          size: photo.size,
          base64: base64Image
        });
        
        console.log(`[INFO] 画像処理完了: ${photo.originalname}`);
      } catch (error) {
        console.error(`[ERROR] 画像処理エラー: ${photo.originalname}`, error);
        // 画像処理エラーは継続（他の画像は処理する）
      }
    }

    console.log(`[INFO] 処理完了画像数: ${images.length}/${photos.length}`);

    // スプレッドシートに記録
    try {
      await writeToSpreadsheet({
        userId,
        name,
        phone,
        zipcode,
        address1,
        address2,
        answers: sess.answers,
        photoCount: images.length,
        estimatedPrice: sess.estimatedPrice || calcRoughPrice(sess.answers)
      });
      console.log('[INFO] スプレッドシート書き込み成功');
    } catch (error) {
      console.error('[ERROR] スプレッドシート書き込みエラー:', error);
      // スプレッドシートエラーは継続（メール送信は実行）
    }

    // メール送信（画像Base64埋め込み）
    try {
      await sendEmail({
        userId,
        name,
        phone,
        zipcode,
        address1,
        address2,
        answers: sess.answers,
        images: images,
        estimatedPrice: sess.estimatedPrice || calcRoughPrice(sess.answers)
      });
      console.log('[INFO] メール送信成功');
    } catch (error) {
      console.error('[ERROR] メール送信エラー:', error);
      // メール送信エラーは継続（LINE通知は実行）
    }

    // LINEに完了通知を送信
    try {
      await safePush(userId, {
        type: 'text',
        text: 'お見積りのご依頼ありがとうございます。\n1〜3営業日程度でLINEにお送りいたします。'
      });
      console.log('[INFO] LINE通知送信成功');
    } catch (error) {
      console.error('[ERROR] LINE通知送信エラー:', error);
      // LINE通知エラーでも成功扱い
    }

    // セッションをクリア
    sessions.delete(userId);
    console.log('[INFO] セッションクリア完了');

    res.json({ success: true, message: '送信が完了しました' });

  } catch (error) {
    console.error('[ERROR] LIFF フォーム送信エラー:', error);
    console.error('[ERROR] エラースタック:', error.stack);
    res.status(500).json({ error: '送信処理中にエラーが発生しました。もう一度お試しください。' });
  }
});

// セッション情報取得API（LIFF用）
app.get('/api/session/:userId', (req, res) => {
  const userId = req.params.userId;
  console.log('[DEBUG] セッション取得要求:', userId);
  
  const sess = sessions.get(userId);
  if (!sess) {
    console.log('[DEBUG] セッションが見つかりません:', userId);
    console.log('[DEBUG] 現在のセッション一覧:', Array.from(sessions.keys()));
    return res.status(404).json({ error: 'セッションが見つかりません' });
  }

  // 概算価格の計算（セッションに保存されていない場合）
  const estimatedPrice = sess.estimatedPrice || calcRoughPrice(sess.answers || {});
  
  // 回答サマリー作成
  const summary = summarize(sess.answers || {});
  
  const response = {
    userId: userId,
    answers: sess.answers || {},
    estimate: estimatedPrice,  // LIFFのapp.jsで期待されているフィールド名
    summary: summary,
    timestamp: sess.timestamp || Date.now()
  };
  
  console.log('[DEBUG] セッションデータ返却:', response);
  res.json(response);
});

// デバッグ用：現在のセッション一覧
app.get('/api/debug/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([userId, sess]) => ({
    userId,
    answersCount: Object.keys(sess.answers || {}).length,
    estimatedPrice: sess.estimatedPrice,
    timestamp: sess.timestamp
  }));
  
  res.json({
    totalSessions: sessions.size,
    sessions: sessionList
  });
});

// 静的ファイル配信（LIFF用）
app.use('/liff', express.static(path.join(__dirname, 'liff')));

// サーバー起動
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[INFO] サーバーが起動しました`);
  console.log(`[INFO] ポート: ${PORT}`);
  console.log(`[INFO] 環境: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[INFO] ヘルスチェック: http://localhost:${PORT}/health`);
  console.log(`listening on ${PORT}`);
});

