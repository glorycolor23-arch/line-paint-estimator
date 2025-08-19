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
  // Render環境変数からLIFF_IDを取得する
  const liffId = process.env.LIFF_ID;
  
  res.setHeader('Content-Type', 'application/javascript');
  // サーバーの環境変数を最優先でwindow.ENVに設定する
  res.send(`window.ENV = { LIFF_ID: ${JSON.stringify(liffId)} };`);
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
function calcRoughPrice(a) {
  // a (answers) オブジェクトが未定義の場合のフォールバック
  if (!a) return 0;

  let total = 0;
  const breakdown = {};

  const BASE_WALL = 600000;
  const BASE_ROOF = 300000;

  const wallMaterialMul = { 'モルタル': 1.0, 'サイディング': 1.1, 'タイル': 1.3, 'ALC': 1.2 };
  const roofMaterialMul = { '瓦': 1.2, 'スレート': 1.0, 'ガルバリウム': 1.1, 'トタン': 0.9 };
  const floorsMul = { '1階建て': 1.0, '2階建て': 1.15, '3階建て': 1.30, '4階建て以上': 1.45 };
  const roomsMul = { '1K・1DK': 1.0, '1LDK・2K・2DK': 1.2, '2LDK・3K・3DK': 1.4, '3LDK・4K・4DK': 1.6, '4LDK以上': 1.8 };
  const ageMul = { '5年未満': 1.0, '5-10年': 1.1, '11-15年': 1.2, '16-20年': 1.3, '21年以上': 1.4 };
  const paintMul = { 'スタンダード': 1.0, 'ハイグレード': 1.3, 'プレミアム': 1.6 };

  if (['外壁塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(a.q4_work_type)) {
    let wall = BASE_WALL;
    wall *= wallMaterialMul[a.q7_wall_material] || 1.0;
    breakdown.wall = Math.round(wall);
    total += breakdown.wall;
  }

  if (['屋根塗装のみ', '外壁・屋根塗装', '外壁・屋根・付帯部塗装'].includes(a.q4_work_type)) {
    let roof = BASE_ROOF;
    roof *= roofMaterialMul[a.q8_roof_material] || 1.0;
    breakdown.roof = Math.round(roof);
    total += breakdown.roof;
  }

  if (a.q4_work_type === '外壁・屋根・付帯部塗装') {
    breakdown.additional = 150000;
    total += breakdown.additional;
  }

  total *= paintMul[a.q11_paint_grade] || 1.0;
  total *= floorsMul[a.q1_floors] || 1.0;
  total *= roomsMul[a.q2_rooms] || 1.0;
  total *= ageMul[a.q3_age] || 1.0;

  return Math.round(total);
}

// 回答サマリー生成
function summarize(a) {
  // a (answers) オブジェクトが未定義の場合のフォールバック
  if (!a) return '';
  
  const items = [];
  if (a.q1_floors) items.push(`階数: ${a.q1_floors}`);
  if (a.q2_rooms) items.push(`間取り: ${a.q2_rooms}`);
  if (a.q4_work_type) items.push(`工事: ${a.q4_work_type}`);
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

    const estimate = data.estimate || { total: 0 }; // estimateオブジェクトを取得

    // 画像セクションの生成
    let imageSection = '';
    if (data.images && data.images.length > 0) {
      const labels = { facade: '外観正面', side: '外観側面', back: '外観背面', roof: '屋根全体', wall_detail: '外壁詳細', damage: '損傷箇所', floor_plan: '平面図', elevation: '立面図', other: 'その他' };
      
      imageSection = `
        <h3>添付写真 (${data.images.length}枚)</h3>
        <div style="display: flex; flex-wrap: wrap; gap: 15px;">
          ${data.images.map((image, index) => {
            const [type, ...nameParts] = image.filename.split('__');
            const originalName = nameParts.join('__');
            const typeLabel = labels[type] || 'その他';
            
            return `
            <div style="border: 1px solid #ddd; padding: 10px; border-radius: 8px; width: 200px; text-align: center;">
              <p style="margin: 0 0 10px 0; font-weight: bold; font-size: 14px;">${typeLabel}</p>
              <img src="${image.base64}" alt="${originalName}" style="max-width: 100%; height: auto; border-radius: 4px; margin-bottom: 5px;">
              <p style="margin: 0; font-size: 12px; color: #666; word-wrap: break-word;">${originalName}</p>
            </div>`;
          }).join('')}
        </div>`;
    }

    // 回答サマリーの生成
    const answerSummary = `
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <tr><td style="background-color: #f5f5f5; width: 120px;"><strong>階数</strong></td><td>${data.answers.q1_floors || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>間取り</strong></td><td>${data.answers.q2_rooms || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>築年数</strong></td><td>${data.answers.q3_age || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>工事内容</strong></td><td>${data.answers.q4_work_type || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>外壁材</strong></td><td>${data.answers.q7_wall_material || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>屋根材</strong></td><td>${data.answers.q8_roof_material || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>塗料グレード</strong></td><td>${data.answers.q11_paint_grade || '—'}</td></tr>
        <tr><td style="background-color: #f5f5f5;"><strong>希望時期</strong></td><td>${data.answers.q12_urgency || '—'}</td></tr>
      </table>`;

    const htmlContent = `
      <div style="font-family: sans-serif; line-height: 1.6;">
        <h2>【LIFFフォーム】新規お見積り依頼</h2>
        
        <h3>お客様情報</h3>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
          <tr><td style="background-color: #f5f5f5; width: 120px;"><strong>お名前</strong></td><td>${data.name} 様</td></tr>
          <tr><td style="background-color: #f5f5f5;"><strong>電話番号</strong></td><td>${data.phone}</td></tr>
          <tr><td style="background-color: #f5f5f5;"><strong>郵便番号</strong></td><td>〒${data.zipcode}</td></tr>
          <tr><td style="background-color: #f5f5f5;"><strong>住所</strong></td><td>${data.address1} ${data.address2}</td></tr>
        </table>
        
        <h3>ご回答内容</h3>
        ${answerSummary}
        
        <h3>概算見積り金額</h3>
        <p style="font-size: 24px; color: #00B900; font-weight: bold; margin: 10px 0;">¥${(estimate.total || 0).toLocaleString()}</p>
        
        ${imageSection}
        
        <hr style="margin-top: 20px;">
        <p><small>LINE User ID: ${data.userId}</small></p>
        <p><small>送信日時: ${new Date().toLocaleString('ja-JP')}</small></p>
      </div>
    `;

    const mailOptions = {
      from: `"LIFF見積りフォーム" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: `【新規見積り依頼】${data.name}様より`,
      html: htmlContent
    };

    await transporter.sendMail(mailOptions);
    console.log('[INFO] メール送信成功');
  } catch (error) {
    console.error('[ERROR] メール送信エラー:', error);
    // エラーを投げずに処理を継続させる
  }
}


/* ===========================================================================
 * LIFF API エンドポイント
 * ======================================================================== */

// LIFF フォーム送信処理
app.post('/api/submit', upload.array('photos', 10), handleMulterError, async (req, res) => {
  try {
    console.log('[INFO] LIFFフォーム送信受信');
    // FormDataからすべてのテキストフィールドとファイルを取得
    const { userId, name, phone, zipcode, address1, address2, answers, estimate } = req.body;
    const photos = req.files || [];

    // 必須項目チェック
    if (!userId || !name || !phone || !zipcode || !address1 || !answers || !estimate) {
      console.error('[ERROR] 必須項目が不足しています:', req.body);
      return res.status(400).json({ error: '必須項目が不足しています。' });
    }

    // 文字列で送られてきたanswersとestimateをJSONオブジェクトに変換
    const parsedAnswers = JSON.parse(answers);
    const parsedEstimate = JSON.parse(estimate);

    // 画像をBase64エンコード
    const images = photos.map(photo => ({
      filename: photo.originalname,
      size: photo.size,
      base64: `data:${photo.mimetype};base64,${photo.buffer.toString('base64')}`
    }));

    // スプレッドシートとメールに渡すためのデータオブジェクトを生成
    const submissionData = {
      userId, name, phone, zipcode, address1, address2,
      answers: parsedAnswers,
      estimate: parsedEstimate,
      photoCount: images.length,
      images: images
    };

    // スプレッドシートへの書き込みとメール送信を並行して実行
    await Promise.all([
      writeToSpreadsheet(submissionData),
      sendEmail(submissionData)
    ]);

    // ユーザーにLINEで完了通知を送信
    await safePush(userId, {
      type: 'text',
      text: 'お見積りのご依頼ありがとうございます。\n内容を確認し、1〜3営業日以内に担当者よりご連絡いたします。'
    });
    
    // セッションをクリア（Webhookからの起動時に作られたセッションを削除）
    sessions.delete(userId);

    // フロントエンドに成功応答を返す
    res.json({ success: true, message: '送信が完了しました' });

  } catch (error) {
    console.error('[ERROR] LIFFフォーム送信処理エラー:', error);
    res.status(500).json({ error: 'サーバーでエラーが発生しました。' });
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
  console.log(`[INFO] ヘルスチェック: http://localhost:${PORT}/health` );
  console.log(`listening on ${PORT}`);
});
