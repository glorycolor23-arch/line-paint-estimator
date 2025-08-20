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

// 概算計算（修正：新しい質問項目に対応）
function calcRoughPrice(a){
  // 基本料金設定
  const BASE_PRICE = 600000; // 基本料金：60万円
  
  // 係数設定
  const COEFFICIENTS = {
    // 階数による係数
    floors: {
      '1階建て': 1.0,
      '2階建て': 1.15,
      '3階建て': 1.30,
      '4階建て以上': 1.45
    },
    
    // 間取りによる係数
    rooms: {
      '1K・1DK': 1.0,
      '1LDK・2K・2DK': 1.2,
      '2LDK・3K・3DK': 1.4,
      '3LDK・4K・4DK': 1.6,
      '4LDK以上': 1.8
    },
    
    // 築年数による係数
    age: {
      '5年未満': 1.0,
      '5-10年': 1.1,
      '11-15年': 1.2,
      '16-20年': 1.3,
      '21年以上': 1.4
    },
    
    // 工事内容による追加料金
    workType: {
      '外壁塗装のみ': 400000,
      '屋根塗装のみ': 300000,
      '外壁・屋根塗装': 650000,
      '外壁・屋根・付帯部塗装': 800000
    },
    
    // 外壁材による係数
    wallMaterial: {
      'モルタル': 1.0,
      'サイディング': 1.1,
      'タイル': 1.3,
      'ALC': 1.2
    },
    
    // 屋根材による係数
    roofMaterial: {
      '瓦': 1.2,
      'スレート': 1.0,
      'ガルバリウム': 1.1,
      'トタン': 0.9
    },
    
    // 塗料グレードによる係数
    paintGrade: {
      'スタンダード': 1.0,
      'ハイグレード': 1.3,
      'プレミアム': 1.6
    }
  };

  let price = BASE_PRICE;
  
  // 階数による調整
  if (a.q1_floors && COEFFICIENTS.floors[a.q1_floors]) {
    price *= COEFFICIENTS.floors[a.q1_floors];
  }
  
  // 間取りによる調整
  if (a.q2_rooms && COEFFICIENTS.rooms[a.q2_rooms]) {
    price *= COEFFICIENTS.rooms[a.q2_rooms];
  }
  
  // 築年数による調整
  if (a.q3_age && COEFFICIENTS.age[a.q3_age]) {
    price *= COEFFICIENTS.age[a.q3_age];
  }
  
  // 工事内容による追加
  if (a.q4_work_type && COEFFICIENTS.workType[a.q4_work_type]) {
    price += COEFFICIENTS.workType[a.q4_work_type];
  }
  
  // 外壁材による調整
  if (a.q7_wall_material && COEFFICIENTS.wallMaterial[a.q7_wall_material]) {
    price *= COEFFICIENTS.wallMaterial[a.q7_wall_material];
  }
  
  // 屋根材による調整
  if (a.q8_roof_material && COEFFICIENTS.roofMaterial[a.q8_roof_material]) {
    price *= COEFFICIENTS.roofMaterial[a.q8_roof_material];
  }
  
  // 塗料グレードによる調整
  if (a.q11_paint_grade && COEFFICIENTS.paintGrade[a.q11_paint_grade]) {
    price *= COEFFICIENTS.paintGrade[a.q11_paint_grade];
  }

  return Math.round(price / 10000) * 10000; // 万円単位で丸める
}

// 回答サマリー生成（修正：新しい質問項目に対応）
function summarize(a){
  const items = [];
  if (a.q1_floors) items.push(`階数: ${a.q1_floors}`);
  if (a.q2_rooms) items.push(`間取り: ${a.q2_rooms}`);
  if (a.q3_age) items.push(`築年数: ${a.q3_age}`);
  if (a.q4_work_type) items.push(`工事内容: ${a.q4_work_type}`);
  if (a.q7_wall_material) items.push(`外壁材: ${a.q7_wall_material}`);
  if (a.q8_roof_material) items.push(`屋根材: ${a.q8_roof_material}`);
  if (a.q11_paint_grade) items.push(`塗料グレード: ${a.q11_paint_grade}`);
  if (a.q12_urgency) items.push(`希望時期: ${a.q12_urgency}`);
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
 * スプレッドシート書き込み関数（修正：新しい質問項目に対応）
 * ======================================================================== */

async function writeToSpreadsheet(data) {
  try {
    const spreadsheetId = process.env.GSHEET_SPREADSHEET_ID;
    if (!spreadsheetId || !auth) {
      console.log('[WARN] スプレッドシート機能が無効化されています');
      return;
    }

    const authClient = await auth.getClient();
    
    // 現在時刻（ISO形式）
    const timestamp = new Date().toISOString();
    
    // 概算金額の計算
    const estimatedPrice = data.estimatedPrice || calcRoughPrice(data.answers);
    
    // スプレッドシートに書き込むデータ（修正：正しいフィールド名を使用）
    const values = [[
      timestamp,                           // Timestamp (ISO)
      data.userId,                         // LINE_USER_ID
      data.name,                           // 氏名
      data.phone,                          // 電話番号
      data.zipcode,                        // 郵便番号
      data.address1,                       // 住所1
      data.address2,                       // 住所2
      data.answers.q1_floors || '',        // 階数
      data.answers.q2_rooms || '',         // 間取り
      data.answers.q3_age || '',           // 築年数
      data.answers.q4_work_type || '',     // 工事内容
      data.answers.q7_wall_material || '', // 外壁種類
      data.answers.q8_roof_material || '', // 屋根種類
      data.answers.q11_paint_grade || '',  // 塗料グレード
      data.answers.q12_urgency || '',      // 希望時期
      data.photoCount || 0,                // 受領写真枚数
      estimatedPrice                       // 概算金額
    ]];

    await sheets.spreadsheets.values.append({
      auth: authClient,
      spreadsheetId: spreadsheetId,
      range: `${process.env.GSHEET_SHEET_NAME || 'Entries'}!A:Q`, // A列からQ列まで（17列）
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });

    console.log('[INFO] スプレッドシート書き込み成功');
  } catch (error) {
    console.error('[ERROR] スプレッドシート書き込みエラー:', error);
    throw error;
  }
}

/* ===========================================================================
 * メール送信関数（修正：新しい質問項目に対応）
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
        <tr><td style="background-color: #f5f5f5;"><strong>間取り</strong></td><td>${data.answers.q2_rooms || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>築年数</strong></td><td>${data.answers.q3_age || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>工事内容</strong></td><td>${data.answers.q4_work_type || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>外壁種類</strong></td><td>${data.answers.q7_wall_material || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>屋根種類</strong></td><td>${data.answers.q8_roof_material || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>塗料グレード</strong></td><td>${data.answers.q11_paint_grade || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>希望時期</strong></td><td>${data.answers.q12_urgency || '—'}</td></tr>
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

// 新しいAPI：見積り送信処理（修正：正しいフィールド名で処理）
app.post('/api/submit-estimate', upload.array('photos', 10), handleMulterError, async (req, res) => {
  try {
    console.log('[INFO] 見積り送信受信:', req.body);
    console.log('[INFO] 受信ファイル数:', req.files?.length || 0);
    
    const { userId, displayName, name, phone, zipcode, address1, address2, answers, estimatedPrice } = req.body;
    const photos = req.files || [];
    
    // 入力値検証
    if (!name || !phone || !zipcode || !address1) {
      console.error('[ERROR] 必須項目が未入力:', { name, phone, zipcode, address1 });
      return res.status(400).json({ error: '必須項目が入力されていません' });
    }

    // 回答データの解析
    let parsedAnswers = {};
    if (answers) {
      try {
        parsedAnswers = typeof answers === 'string' ? JSON.parse(answers) : answers;
      } catch (error) {
        console.error('[ERROR] 回答データの解析エラー:', error);
        return res.status(400).json({ error: '回答データの形式が正しくありません' });
      }
    }

    console.log('[DEBUG] 解析された回答データ:', parsedAnswers);

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
        userId: userId || 'unknown',
        name,
        phone,
        zipcode,
        address1,
        address2,
        answers: parsedAnswers,
        photoCount: images.length,
        estimatedPrice: estimatedPrice || calcRoughPrice(parsedAnswers)
      });
      console.log('[INFO] スプレッドシート書き込み成功');
    } catch (error) {
      console.error('[ERROR] スプレッドシート書き込みエラー:', error);
      // スプレッドシートエラーは継続（メール送信は実行）
    }

    // メール送信（画像Base64埋め込み）
    try {
      await sendEmail({
        userId: userId || 'unknown',
        name,
        phone,
        zipcode,
        address1,
        address2,
        answers: parsedAnswers,
        images: images,
        estimatedPrice: estimatedPrice || calcRoughPrice(parsedAnswers)
      });
      console.log('[INFO] メール送信成功');
    } catch (error) {
      console.error('[ERROR] メール送信エラー:', error);
      // メール送信エラーは継続（LINE通知は実行）
    }

    // LINEに完了通知を送信
    if (userId) {
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
    }

    res.json({ success: true, message: '送信が完了しました' });

  } catch (error) {
    console.error('[ERROR] 見積り送信エラー:', error);
    console.error('[ERROR] エラースタック:', error.stack);
    res.status(500).json({ error: '送信処理中にエラーが発生しました。もう一度お試しください。' });
  }
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
