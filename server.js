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
 * 質問フロー
 * ======================================================================== */
const sessions = new Map(); // {userId: {answers:{}, last:{q,v}, step:number, estimatedPrice:number}}

// トリガー/コマンド
const TRIGGER_START = ['カンタン見積りを依頼'];
const CMD_RESET     = ['リセット','はじめからやり直す'];
const CMD_RESULT    = ['見積り結果']; // 手動再配信

const QUESTIONS = [
  { id:'q1_floors',  title:'工事物件の階数は？', options:['1階建て','2階建て','3階建て'] },
  { id:'q2_layout',  title:'物件の間取りは？', options:['1K','1DK','1LDK','2K','2DK','2LDK','3K','3DK','4K','4DK','4LDK'] },
  { id:'q3_age',     title:'物件の築年数は？', options:['新築','〜10年','〜20年','〜30年','〜40年','〜50年','51年以上'] },
  { id:'q4_painted', title:'過去に塗装をした経歴は？', options:['ある','ない','わからない'] },
  { id:'q5_last',    title:'前回の塗装はいつ頃？', options:['〜5年','5〜10年','10〜20年','20〜30年','わからない'] },
  { id:'q6_work',    title:'ご希望の工事内容は？', options:['外壁塗装','屋根塗装','外壁塗装+屋根塗装'] },
  { id:'q7_wall',    title:'外壁の種類は？（外壁を選んだ場合）', options:['モルタル','サイディング','タイル','ALC'],
                      conditional:(a)=> (a.q6_work||'').includes('外壁') },
  { id:'q7_wall_paint', title:'外壁塗装で使いたい塗料は？', options:['一般的な塗料（コスト 一般的）','コストが安い塗料（耐久性 低い）','耐久性が高い塗料（コスト 高い）','遮熱性が高い（コスト 高い）'],
                      conditional:(a)=> (a.q6_work||'').includes('外壁') },
  { id:'q8_roof',    title:'屋根の種類は？（屋根を選んだ場合）', options:['瓦','スレート','ガルバリウム','トタン'],
                      conditional:(a)=> (a.q6_work||'').includes('屋根') },
  { id:'q8_roof_paint', title:'屋根塗装で使いたい塗料は？', options:['一般的な塗料（コスト 一般的）','コストが安い塗料（耐久性 低い）','耐久性が高い塗料（コスト 高い）','遮熱性が高い（コスト 高い）'],
                      conditional:(a)=> (a.q6_work||'').includes('屋根') },
  { id:'q9_leak',    title:'雨漏りや漏水の症状はありますか？', options:['雨の日に水滴が落ちる','天井にシミがある','ない'] },
  { id:'q10_dist',   title:'隣や裏の家との距離は？（周囲で一番近い距離）', options:['30cm以下','50cm以下','70cm以下','70cm以上'] },
];

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

// 現在の質問インデックス
function currentIndex(a){
  for (let i = 0; i < QUESTIONS.length; i++){
    const q = QUESTIONS[i];
    if (q.conditional && !q.conditional(a)) continue;
    if (!a[q.id]) return i;
  }
  return QUESTIONS.length; // 全て完了
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

// 画像カード形式のFlexメッセージ作成
function buildOptionsFlex(title, questionId, options) {
  // 選択肢を3つずつに分割してカルーセル作成
  const bubbles = [];
  
  for (let i = 0; i < options.length; i += 3) {
    const optionGroup = options.slice(i, i + 3);
    
    const bubble = {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: title,
            weight: 'bold',
            size: 'md',
            wrap: true,
            margin: 'none'
          },
          {
            type: 'separator',
            margin: 'md'
          }
        ]
      }
    };
    
    // 各選択肢の画像カード追加
    optionGroup.forEach(option => {
      bubble.body.contents.push({
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'filler'
                  }
                ],
                height: '80px',
                backgroundColor: '#F0F0F0',
                cornerRadius: '8px',
                margin: 'md',
                action: {
                  type: 'postback',
                  data: JSON.stringify({ t: 'answer', q: questionId, v: option }),
                  displayText: option
                }
              },
              {
                type: 'text',
                text: option,
                size: 'sm',
                weight: 'bold',
                align: 'center',
                margin: 'sm'
              }
            ]
          }
        ],
        paddingAll: '8px'
      });
    });
    
    bubbles.push(bubble);
  }
  
  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'carousel',
      contents: bubbles
    }
  };
}

// 元の見積り結果Flexメッセージ作成
function buildEstimateFlex(price, answers) {
  const summary = summarize(answers);
  
  return {
    type: 'flex',
    altText: `概算見積り: ¥${price.toLocaleString()}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '見積り金額',
            size: 'md',
            color: '#666666'
          },
          {
            type: 'text',
            text: `¥${price.toLocaleString()}`,
            size: 'xxl',
            weight: 'bold',
            color: '#00B900'
          },
          {
            type: 'text',
            text: '上記はご入力内容を元に算出した概算です。',
            size: 'xs',
            color: '#999999',
            margin: 'md'
          },
          {
            type: 'separator',
            margin: 'xl'
          },
          {
            type: 'text',
            text: '正式なお見積りが必要な方は続けてご入力ください。',
            size: 'sm',
            color: '#666666',
            margin: 'xl',
            wrap: true
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
              label: '現地調査なしで見積を依頼',
              uri: `https://liff.line.me/${process.env.LIFF_ID}`
            }
          }
        ]
      }
    }
  };
}

// 次の質問送信
async function sendNext(userId, replyToken = null) {
  const sess = sessions.get(userId);
  if (!sess) {
    console.error(`[ERROR] セッションが見つかりません: ${userId}`);
    return;
  }

  const idx = currentIndex(sess.answers);
  console.log(`[DEBUG] 現在の質問インデックス: ${idx}/${QUESTIONS.length}`);

  // ----- 完了 -----
  if (idx >= QUESTIONS.length) {
    console.log(`[DEBUG] 質問完了 - 概算見積り送信`);
    const price = calcRoughPrice(sess.answers);
    
    // セッションに概算価格を保存
    sess.estimatedPrice = price;
    sessions.set(userId, sess);
    
    console.log(`[DEBUG] 概算価格: ${price}, セッション更新完了`);
    
    // 回答確認メッセージ
    const confirmationText = buildConfirmationText(sess.answers);
    
    const messages = [
      { type: 'text', text: 'ありがとうございます。概算を作成しました。' },
      { type: 'text', text: confirmationText },
      buildEstimateFlex(price, sess.answers)
    ];

    let ok = false;
    if (replyToken) ok = await safeReply(replyToken, messages);
    else            ok = await safePush(userId,   messages);

    if (ok) {
      // セッションは削除せず、LIFF での使用のために保持
      console.log(`[INFO] 概算見積り送信完了: ${userId}, 価格: ${price}`);
    } else {
      // 失敗時はセッション保持。ユーザーから「見積り結果」で再送可能。
      console.error(`[ERROR] 概算見積り送信失敗: ${userId}`);
      await safePush(userId, { type:'text', text:'ネットワークの都合で送信に失敗しました。「見積り結果」と入力すると再送します。' });
    }
    return;
  }

  // ----- 途中 -----
  const q = QUESTIONS[idx];
  console.log(`[DEBUG] 質問送信: ${q.title}`);
  
  const messages = [
    { type:'text', text:q.title },
    buildOptionsFlex(q.title, q.id, q.options),
  ];

  if (replyToken) await safeReply(replyToken, messages);
  else            await safePush(userId,   messages);
}

// 回答確認テキスト作成
function buildConfirmationText(answers) {
  const items = [];
  
  items.push('【回答の確認】');
  if (answers.q1_floors) items.push(`• 階数: ${answers.q1_floors}`);
  if (answers.q2_layout) items.push(`• 間取り: ${answers.q2_layout}`);
  if (answers.q3_age) items.push(`• 築年数: ${answers.q3_age}`);
  if (answers.q4_painted) items.push(`• 過去塗装: ${answers.q4_painted}`);
  if (answers.q5_last) items.push(`• 前回から: ${answers.q5_last}`);
  if (answers.q6_work) items.push(`• 工事内容: ${answers.q6_work}`);
  if (answers.q7_wall) items.push(`• 外壁: ${answers.q7_wall}`);
  if (answers.q7_wall_paint) items.push(`• 外壁塗料: ${answers.q7_wall_paint}`);
  if (answers.q8_roof) items.push(`• 屋根: ${answers.q8_roof}`);
  if (answers.q8_roof_paint) items.push(`• 屋根塗料: ${answers.q8_roof_paint}`);
  if (answers.q9_leak) items.push(`• 雨漏り: ${answers.q9_leak}`);
  if (answers.q10_dist) items.push(`• 距離: ${answers.q10_dist}`);
  
  return items.join('\n');
}

// 停止確認
async function confirmStop(userId){
  const t = {
    type:'template',
    altText:'見積りを停止しますか？',
    template:{
      type:'confirm', text:'見積りを停止しますか？',
      actions:[
        { type:'postback', label:'はい',   data:JSON.stringify({t:'stop',v:'yes'}), displayText:'はい' },
        { type:'postback', label:'いいえ', data:JSON.stringify({t:'stop',v:'no'}),  displayText:'いいえ' }
      ]
    }
  };
  await safePush(userId, t);
}

// 見積りフロー中かどうかを判定
function isInEstimateFlow(sess) {
  // セッションが存在し、回答が1つ以上あるか、まだ完了していない場合
  return sess && (Object.keys(sess.answers || {}).length > 0 || sess.step > 0) && currentIndex(sess.answers) < QUESTIONS.length;
}

// イベント処理
async function handleEvent(ev){
  const userId = ev.source?.userId;
  if (!userId) return;

  console.log(`[DEBUG] イベント受信: ${ev.type}, ユーザー: ${userId}`);

  // セッション初期化は見積り開始時のみ行う
  let sess = sessions.get(userId);

  // postback
  if (ev.type === 'postback'){
    let data = {};
    try{ data = JSON.parse(ev.postback.data||'{}'); }catch{}
    console.log(`[DEBUG] postback データ:`, data);
    
    if (data.t === 'answer'){
      // セッションが存在しない場合は作成
      if (!sess) {
        sess = {answers:{}, last:{}, step:0, estimatedPrice: 0};
        sessions.set(userId, sess);
      }
      
      // 重複防止：同じ質問に同じ値を連打されたら無視して次へ
      if (sess.last?.q === data.q && sess.last?.v === data.v){
        console.log(`[DEBUG] 重複回答を検出、次の質問へ`);
        await sendNext(userId, ev.replyToken);
        return;
      }
      sess.answers[data.q] = data.v;
      sess.last = { q:data.q, v:data.v };
      console.log(`[DEBUG] 回答記録: ${data.q} = ${data.v}`);
      await sendNext(userId, ev.replyToken);
      return;
    }
    if (data.t === 'stop'){
      if (data.v === 'yes'){
        sessions.delete(userId);
        await safeReply(ev.replyToken, { type:'text', text:'見積りを停止しました。通常のトークができます。' });
      }else{
        await safeReply(ev.replyToken, { type:'text', text:'見積りを継続します。' });
        await sendNext(userId);
      }
      return;
    }
  }

  // text
  if (ev.type === 'message' && ev.message.type === 'text'){
    const text = (ev.message.text||'').trim();
    console.log(`[DEBUG] テキストメッセージ: ${text}`);

    // 手動再配信（見積りフロー中のみ）
    if (CMD_RESULT.includes(text)){
      if (sess && currentIndex(sess.answers) >= QUESTIONS.length){
        console.log(`[DEBUG] 見積り結果の再送要求`);
        await sendNext(userId, ev.replyToken); // push で再送される
      } else {
        // 見積りフロー外では普通のトーク
        console.log(`[DEBUG] 見積りフロー外での「見積り結果」発言 - 無反応`);
      }
      return;
    }

    // リセット（常に有効）
    if (CMD_RESET.includes(text)){
      sessions.delete(userId);
      console.log(`[DEBUG] セッションリセット: ${userId}`);
      await safeReply(ev.replyToken, { type:'text', text:'見積りをリセットしました。\n「カンタン見積りを依頼」と入力すると新しい見積りを開始できます。' });
      return;
    }

    // 開始
    if (TRIGGER_START.includes(text)){
      console.log(`[DEBUG] 見積り開始`);
      sessions.set(userId, {answers:{}, last:{}, step:0, estimatedPrice: 0});
      await safeReply(ev.replyToken, { type:'text', text:'見積もりを開始します。以下の質問にお答えください。' });
      await sendNext(userId);
      return;
    }

    // 見積りフロー中の自由入力 → 停止確認
    if (sess && isInEstimateFlow(sess)){
      console.log(`[DEBUG] 見積りフロー中の自由入力 - 停止確認`);
      await safeReply(ev.replyToken, { type:'text', text:'ボタンからお選びください。' });
      await confirmStop(userId);
      return;
    }

    // 見積りフロー外 → 普通のトーク（無反応）
    console.log(`[DEBUG] 見積りフロー外での自由発言 - 無反応`);
    // 何も返信しない（普通のトーク）
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
    
    // スプレッドシートに書き込むデータ
    const values = [[
      timestamp,                           // Timestamp (ISO)
      data.userId,                         // LINE_USER_ID
      data.name,                           // 氏名
      data.zipcode,                        // 郵便番号
      data.address1,                       // 住所1
      data.address2,                       // 住所2
      data.answers.q1_floors || '',        // Q1 階数
      data.answers.q2_layout || '',        // Q2 間取り
      data.answers.q6_work || '',          // Q3 工事
      data.answers.q4_painted || '',       // Q4 過去塗装
      data.answers.q5_last || '',          // Q5 前回から
      data.answers.q7_wall || '',          // Q6 外壁
      data.answers.q8_roof || '',          // Q7 屋根
      data.answers.q9_leak || '',          // Q8 雨漏り
      data.answers.q10_dist || '',         // Q9 距離
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
      return res.status(400).json({ error: '質問回答データが見つかりません。先にLINEで見積りを完了してください。' });
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
  const estimatedPrice = sess.estimatedPrice || calcRoughPrice(sess.answers);
  
  // 回答サマリー作成
  const summary = summarize(sess.answers);
  
  const response = {
    userId: userId,
    answers: sess.answers,
    estimate: estimatedPrice,  // LIFFのapp.jsで期待されているフィールド名
    summary: summary,
    step: sess.step || 0
  };
  
  console.log('[DEBUG] セッションデータ返却:', response);
  res.json(response);
});

// 旧エンドポイント（互換性のため残す）
app.get('/api/user/:userId', (req, res) => {
  const userId = req.params.userId;
  console.log('[DEBUG] ユーザーセッション取得要求（旧エンドポイント）:', userId);
  
  const sess = sessions.get(userId);
  if (!sess) {
    console.log('[DEBUG] セッションが見つかりません:', userId);
    return res.status(404).json({ error: 'セッションが見つかりません' });
  }

  // 概算価格の計算
  const estimatedPrice = sess.estimatedPrice || calcRoughPrice(sess.answers);
  
  const response = {
    userId: userId,
    answers: sess.answers,
    estimatedPrice: estimatedPrice,
    summary: summarize(sess.answers),
    step: sess.step || 0
  };
  
  console.log('[DEBUG] セッションデータ:', response);
  res.json(response);
});

// デバッグ用：現在のセッション一覧
app.get('/api/debug/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([userId, sess]) => ({
    userId,
    answersCount: Object.keys(sess.answers || {}).length,
    estimatedPrice: sess.estimatedPrice,
    step: sess.step
  }));
  
  res.json({
    totalSessions: sessions.size,
    sessions: sessionList
  });
});

// サーバー起動
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[INFO] サーバーが起動しました`);
  console.log(`[INFO] ポート: ${PORT}`);
  console.log(`[INFO] 環境: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[INFO] ヘルスチェック: http://localhost:${PORT}/health`);
  console.log(`listening on ${PORT}`);
});

