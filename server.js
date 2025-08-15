/* =========================================================
 * server.js  LIFF修正 + 画像カード改善版
 * ========================================================= */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client, middleware as lineMiddleware } from '@line/bot-sdk';
import multer from 'multer';
import axios from 'axios';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---- LINE 設定 -------------------------------------------------------------
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[FATAL] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です');
  process.exit(1);
}
const client = new Client(config);

// ---- Google Sheets 設定 ---------------------------------------------------
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
const GSHEET_SPREADSHEET_ID = process.env.GSHEET_SPREADSHEET_ID;
const GSHEET_SHEET_NAME = process.env.GSHEET_SHEET_NAME || 'Sheet1';

let sheetsAuth = null;
if (GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
  sheetsAuth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

// ---- Express ---------------------------------------------------------------
const app = express();

// CORS設定
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.get('/health', (_, res) => res.status(200).send('ok'));

// LIFF 静的配信
app.use('/liff', express.static(path.join(__dirname, 'liff'), { index: 'index.html' }));

// フロント用環境JS
app.get('/liff/env.js', (req, res) => {
  const liffId   = process.env.LIFF_ID || '';
  const addUrl   = process.env.FRIEND_ADD_URL || '';
  const mailUrl  = process.env.EMAIL_WEBAPP_URL || '';
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.status(200).send(
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
  verify: (req, res, buf) => { req.rawBody = buf.toString(); }
}));

/* LINE middleware（署名検証） */
app.post('/webhook', lineMiddleware(config), async (req, res) => {
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
const sessions = new Map(); // {userId: {answers:{}, last:{q,v}, step:number}}

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
  { id:'q8_roof',    title:'屋根の種類は？（屋根を選んだ場合）', options:['瓦','スレート','ガルバリウム','トタン'],
                      conditional:(a)=> (a.q6_work||'').includes('屋根') },
  { id:'q9_leak',    title:'雨漏りや漏水の症状はありますか？', options:['雨の日に水滴が落ちる','天井にシミがある','ない'] },
  { id:'q10_dist',   title:'隣や裏の家との距離は？（周囲で一番近い距離）', options:['30cm以下','50cm以下','70cm以下','70cm以上'] },
];

// 概算計算（ダミー）
function calcRoughPrice(a){
  let base = 1000000;
  if ((a.q1_floors||'').includes('2')) base += 150000;
  if ((a.q1_floors||'').includes('3')) base += 300000;
  if ((a.q6_work||'').includes('屋根')) base += 180000;
  if ((a.q6_work||'').includes('外壁')) base += 220000;
  if ((a.q7_wall||'').includes('タイル')) base += 120000;
  if ((a.q9_leak||'') !== 'ない') base += 90000;
  return Math.round(base/1000)*1000;
}

// 安全送信（結果: true/false）
async function safeReply(replyToken, messages){
  try{
    console.log('[DEBUG] safeReply 送信開始');
    await client.replyMessage(replyToken, Array.isArray(messages)?messages:[messages]);
    console.log('[DEBUG] safeReply 送信成功');
    return true;
  }catch(err){
    console.error('[safeReply error]', JSON.stringify(err?.response?.data || err?.message || err, null, 2));
    return false;
  }
}

async function safePush(to, messages){
  try{
    console.log('[DEBUG] safePush 送信開始:', to);
    await client.pushMessage(to, Array.isArray(messages)?messages:[messages]);
    console.log('[DEBUG] safePush 送信成功');
    return true;
  }catch(err){
    console.error('[safePush error]', JSON.stringify(err?.response?.data || err?.message || err, null, 2));
    return false;
  }
}

// 改善された画像カード（添付画像のような形式）
function buildOptionsFlex(title, qid, opts){
  // プレースホルダー画像URL（グレーの背景）
  const placeholderImg = 'https://via.placeholder.com/300x200/f0f0f0/666666?text=%E9%81%B8%E6%8A%9E%E8%82%A2';
  
  const bubbles = opts.map(option => ({
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'image',
          url: placeholderImg,
          size: 'full',
          aspectMode: 'cover',
          aspectRatio: '3:2',
          gravity: 'center'
        },
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: option,
              weight: 'bold',
              size: 'lg',
              color: '#333333',
              align: 'center',
              wrap: true
            }
          ],
          spacing: 'sm',
          paddingAll: '16px'
        }
      ],
      paddingAll: '0px'
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          height: 'md',
          color: '#00B900',
          action: {
            type: 'postback',
            label: '選ぶ',
            data: JSON.stringify({t:'answer', q:qid, v:option}),
            displayText: option
          }
        }
      ],
      paddingAll: '16px',
      paddingTop: '0px'
    }
  }));

  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'carousel',
      contents: bubbles
    }
  };
}

function summarize(a){
  return [
    `・階数: ${a.q1_floors||'—'} / 間取り: ${a.q2_layout||'—'} / 築年数: ${a.q3_age||'—'}`,
    `・過去塗装: ${a.q4_painted||'—'} / 前回から: ${a.q5_last||'—'}`,
    `・工事内容: ${a.q6_work||'—'} / 外壁: ${a.q7_wall||'—'} / 屋根: ${a.q8_roof||'—'}`,
    `・雨漏り: ${a.q9_leak||'—'} / 距離: ${a.q10_dist||'—'}`
  ].join('\n');
}

// 見積り表示（シンプルなFlexメッセージ）
function buildEstimateFlex(price){
  const liffUrl = process.env.LIFF_URL || 'https://line-paint.onrender.com/liff/index.html';
  
  return {
    type: 'flex',
    altText: '概算見積り',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '見積り金額',
            weight: 'bold',
            size: 'md'
          },
          {
            type: 'text',
            text: `￥${price.toLocaleString()}`,
            weight: 'bold',
            size: 'xl',
            color: '#00B900'
          },
          {
            type: 'text',
            text: '上記はご入力内容を元に算出した概算です。',
            size: 'sm',
            color: '#666666',
            wrap: true
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '正式なお見積りが必要な方は続けてご入力ください。',
            size: 'sm',
            wrap: true
          },
          {
            type: 'button',
            style: 'primary',
            action: {
              type: 'uri',
              label: '現地調査なしで見積を依頼',
              uri: liffUrl
            }
          }
        ]
      }
    }
  };
}

// 今の出題 index
function currentIndex(ans){
  let idx=0;
  for(let i=0;i<QUESTIONS.length;i++){
    const q = QUESTIONS[i];
    if (q.conditional && !q.conditional(ans)) continue;
    if (!ans[q.id]) return i;
    idx = i+1;
  }
  return idx;
}

// 次の質問 or 最終結果
async function sendNext(userId, replyToken=null){
  const sess = sessions.get(userId) || {answers:{}, step:0};
  const idx = currentIndex(sess.answers);

  console.log(`[DEBUG] sendNext: userId=${userId}, idx=${idx}, totalQuestions=${QUESTIONS.length}`);

  // ----- 最終 -----
  if (idx >= QUESTIONS.length){
    // まず即時に「作成中」返信（replyToken 可用なら）
    if (replyToken) {
      const success = await safeReply(replyToken, { type:'text', text:'概算を作成中です。数秒お待ちください。' });
      if (!success) {
        console.error('[ERROR] 作成中メッセージの送信に失敗');
        return;
      }
    }

    const price = calcRoughPrice(sess.answers);
    
    // セッションに概算価格を保存（LIFF で使用するため）
    sess.estimatedPrice = price;
    sessions.set(userId, sess);
    
    console.log(`[DEBUG] 概算見積り: ${price}, ユーザー: ${userId}`);
    
    const msgs = [
      { type:'text', text:'ありがとうございます。概算を作成しました。' },
      { type:'text', text:`【回答の確認】\n${summarize(sess.answers)}` },
      buildEstimateFlex(price)
    ];

    console.log(`[DEBUG] 送信するメッセージ数: ${msgs.length}`);

    const ok = await safePush(userId, msgs);
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
        sess = {answers:{}, last:{}, step:0};
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

    // リセット（見積りフロー中のみ）
    if (CMD_RESET.includes(text)){
      if (sess && isInEstimateFlow(sess)) {
        sessions.delete(userId);
        await safeReply(ev.replyToken, { type:'text', text:'見積りを初期化しました。もう一度「カンタン見積りを依頼」と入力してください。' });
      } else {
        // 見積りフロー外では普通のトーク
        console.log(`[DEBUG] 見積りフロー外での「リセット」発言 - 無反応`);
      }
      return;
    }

    // 開始
    if (TRIGGER_START.includes(text)){
      console.log(`[DEBUG] 見積り開始`);
      sessions.set(userId, {answers:{}, last:{}, step:0});
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

    // 画像をBase64エンコード（スマートフォン対応）
    const imageData = [];
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
        
        // HEIC/HEIF形式の検出
        const isHEIC = photo.mimetype === 'image/heic' || photo.mimetype === 'image/heif' || 
                       photo.originalname.toLowerCase().endsWith('.heic') || 
                       photo.originalname.toLowerCase().endsWith('.heif');
        
        if (isHEIC) {
          console.log(`[INFO] HEIC/HEIF形式を検出: ${photo.originalname}`);
          // HEIC/HEIFの場合、MIMEタイプをJPEGとして扱う（メール送信時の互換性のため）
        }
        
        const base64 = photo.buffer.toString('base64');
        let mimeType = photo.mimetype;
        
        // MIMEタイプの正規化
        if (mimeType === 'application/octet-stream') {
          // 拡張子から推測
          const ext = photo.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];
          if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
          else if (ext === '.png') mimeType = 'image/png';
          else if (ext === '.heic' || ext === '.heif') mimeType = 'image/heic';
          else mimeType = 'image/jpeg'; // デフォルト
        }
        
        // Base64サイズチェック（メール送信制限考慮）
        const base64SizeMB = base64.length / (1024 * 1024);
        if (base64SizeMB > 8) { // 約6MB相当
          console.warn(`[WARN] Base64サイズが大きい: ${photo.originalname}, Base64サイズ: ${base64SizeMB.toFixed(2)}MB`);
        }
        
        imageData.push({
          filename: photo.originalname || `image_${i + 1}.jpg`,
          base64: base64,
          mimeType: mimeType,
          size: photo.size,
          isHEIC: isHEIC
        });
        
        console.log(`[INFO] 画像処理完了: ${photo.originalname}, サイズ: ${(photo.size / 1024 / 1024).toFixed(2)}MB, MIME: ${mimeType}`);
      } catch (error) {
        console.error(`[ERROR] 画像処理エラー: ${photo.originalname}`, error);
        // 画像処理エラーは継続（他の画像は処理する）
      }
    }

    console.log(`[INFO] 処理完了画像数: ${imageData.length}/${photos.length}`);

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
        photoCount: imageData.length,
        estimatedPrice: sess.estimatedPrice || 0
      });
      console.log('[INFO] スプレッドシート書き込み成功');
    } catch (error) {
      console.error('[ERROR] スプレッドシート書き込みエラー:', error);
      // スプレッドシートエラーは継続（メール送信は実行）
    }

    // メール送信（Base64画像付き）
    try {
      await sendEmail({
        userId,
        name,
        phone,
        zipcode,
        address1,
        address2,
        answers: sess.answers,
        imageData: imageData,
        estimatedPrice: sess.estimatedPrice || 0
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

// ユーザーセッション情報取得API（デバッグ情報追加）
app.get('/api/user/:userId', (req, res) => {
  const { userId } = req.params;
  console.log(`[DEBUG] ユーザーセッション取得要求: ${userId}`);
  
  const sess = sessions.get(userId);
  
  if (!sess) {
    console.log(`[DEBUG] セッションが見つかりません: ${userId}`);
    console.log(`[DEBUG] 現在のセッション一覧:`, Array.from(sessions.keys()));
    return res.status(404).json({ error: 'セッションが見つかりません' });
  }

  console.log(`[DEBUG] セッションデータ:`, sess);
  
  res.json({
    answers: sess.answers,
    estimatedPrice: sess.estimatedPrice || 0,
    summary: summarize(sess.answers)
  });
});

// デバッグ用エンドポイント
app.get('/api/debug/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([userId, data]) => ({
    userId,
    answersCount: Object.keys(data.answers || {}).length,
    estimatedPrice: data.estimatedPrice || 0,
    lastActivity: data.lastActivity || 'unknown'
  }));
  
  res.json({
    totalSessions: sessions.size,
    sessions: sessionList
  });
});

/* ===========================================================================
 * Google Sheets 連携
 * ======================================================================== */
async function writeToSpreadsheet(data) {
  if (!sheetsAuth || !GSHEET_SPREADSHEET_ID) {
    console.log('[WARN] Google Sheets 設定が不完全です');
    return;
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });
    
    const row = [
      new Date().toISOString(), // Timestamp (ISO)
      data.userId, // LINE_USER_ID
      data.name, // 氏名
      data.zipcode, // 郵便番号
      data.address1, // 住所1
      data.address2, // 住所2
      data.answers.q1_floors || '', // Q1 階数
      data.answers.q2_layout || '', // Q2 間取り
      data.answers.q6_work || '', // Q3 工事
      data.answers.q4_painted || '', // Q4 過去塗装
      data.answers.q5_last || '', // Q5 前回から
      data.answers.q7_wall || '', // Q6 外壁
      data.answers.q8_roof || '', // Q7 屋根
      data.answers.q9_leak || '', // Q8 雨漏り
      data.answers.q10_dist || '', // Q9 距離
      data.photoCount, // 受領写真枚数
      data.estimatedPrice // 概算金額
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: GSHEET_SPREADSHEET_ID,
      range: `${GSHEET_SHEET_NAME}!A:Q`,
      valueInputOption: 'RAW',
      resource: {
        values: [row]
      }
    });

    console.log('[INFO] スプレッドシート書き込み完了');
  } catch (error) {
    console.error('[ERROR] スプレッドシート書き込みエラー:', error);
  }
}

/* ===========================================================================
 * メール送信（Base64画像埋め込み）
 * ======================================================================== */
async function sendEmail(data) {
  const emailWebappUrl = process.env.EMAIL_WEBAPP_URL;
  const emailTo = process.env.EMAIL_TO;
  
  if (!emailWebappUrl || !emailTo) {
    console.log('[WARN] メール送信設定が不完全です');
    return;
  }

  try {
    const subject = `【LINE見積り依頼】${data.name}様`;
    
    // 画像をHTMLに埋め込み
    let imagesHtml = '';
    if (data.imageData && data.imageData.length > 0) {
      imagesHtml = '<h3>添付写真・図面</h3>';
      data.imageData.forEach((img, index) => {
        const sizeKB = Math.round(img.size / 1024);
        imagesHtml += `
          <div style="margin-bottom: 20px; border: 1px solid #ddd; padding: 10px;">
            <h4>写真${index + 1}: ${img.filename} (${sizeKB}KB)</h4>
            <img src="data:${img.mimeType};base64,${img.base64}" 
                 style="max-width: 500px; max-height: 400px; border: 1px solid #ccc;" 
                 alt="${img.filename}">
          </div>
        `;
      });
    } else {
      imagesHtml = '<h3>添付写真・図面</h3><p>写真の添付はありませんでした。</p>';
    }

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h2 style="color: #00B900;">LINE見積り依頼</h2>
        
        <h3>お客様情報</h3>
        <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
          <tr style="background-color: #f5f5f5;">
            <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold;">お名前</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${data.name}</td>
          </tr>
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold;">電話番号</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${data.phone}</td>
          </tr>
          <tr style="background-color: #f5f5f5;">
            <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold;">郵便番号</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${data.zipcode}</td>
          </tr>
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px; font-weight: bold;">住所</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${data.address1} ${data.address2}</td>
          </tr>
        </table>
        
        <h3>質問回答</h3>
        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <pre style="white-space: pre-wrap; font-family: inherit;">${summarize(data.answers)}</pre>
        </div>
        
        <h3>概算見積り</h3>
        <div style="background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <p style="font-size: 24px; font-weight: bold; color: #00B900; margin: 0;">￥${data.estimatedPrice.toLocaleString()}</p>
          <p style="margin: 5px 0 0 0; color: #666;">※概算金額</p>
        </div>
        
        ${imagesHtml}
        
        <hr style="margin: 30px 0;">
        <p style="color: #666; font-size: 12px;">
          このメールはLINE自動見積りシステムから自動送信されました。<br>
          送信日時: ${new Date().toLocaleString('ja-JP')}
        </p>
      </div>
    `;

    // Google Apps Scriptに送信（Base64データも含む）
    await axios.post(emailWebappUrl, {
      to: emailTo,
      subject,
      htmlBody,
      // 従来のphotoUrlsは空配列（互換性のため）
      photoUrls: []
    });

    console.log(`[INFO] メール送信完了: 画像${data.imageData.length}枚を埋め込み`);
  } catch (error) {
    console.error('[ERROR] メール送信エラー:', error);
  }
}

// ---- 起動 ------------------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`listening on ${PORT}`));

