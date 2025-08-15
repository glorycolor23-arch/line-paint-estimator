/* =========================================================
 * server.js  最終版（画像カード選択式 + ステップ形式LIFF）
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

// ファイルアップロード設定
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10
  }
});

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

// シンプルな画像URL（確実に表示されるもの）
const DEFAULT_IMG = 'https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_1_cafe.png';

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

// 最適化されたFlexメッセージ（画像カード選択式）
function buildOptionsFlex(title, qid, opts){
  // 選択肢を3つずつに分割してカルーセル作成
  const chunks = [];
  for (let i = 0; i < opts.length; i += 3) {
    chunks.push(opts.slice(i, i + 3));
  }

  const bubbles = chunks.map(chunk => ({
    type: 'bubble',
    size: 'micro',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: title,
          weight: 'bold',
          size: 'sm',
          wrap: true
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: chunk.map(v => ({
        type: 'button',
        style: 'secondary',
        height: 'sm',
        action: {
          type: 'postback',
          label: v.length > 15 ? v.substring(0, 12) + '...' : v,
          data: JSON.stringify({t:'answer', q:qid, v}),
          displayText: v
        }
      }))
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

// イベント処理
async function handleEvent(ev){
  const userId = ev.source?.userId;
  if (!userId) return;

  console.log(`[DEBUG] イベント受信: ${ev.type}, ユーザー: ${userId}`);

  if (!sessions.has(userId)) sessions.set(userId, {answers:{}, last:{}, step:0});
  const sess = sessions.get(userId);

  // postback
  if (ev.type === 'postback'){
    let data = {};
    try{ data = JSON.parse(ev.postback.data||'{}'); }catch{}
    console.log(`[DEBUG] postback データ:`, data);
    
    if (data.t === 'answer'){
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

    // 手動再配信
    if (CMD_RESULT.includes(text)){
      console.log(`[DEBUG] 見積り結果の再送要求`);
      if (currentIndex(sess.answers) >= QUESTIONS.length){
        await sendNext(userId, ev.replyToken); // push で再送される
      }else{
        await safeReply(ev.replyToken, { type:'text', text:'まだ最後の設問まで完了していません。' });
      }
      return;
    }

    // リセット
    if (CMD_RESET.includes(text)){
      sessions.delete(userId);
      await safeReply(ev.replyToken, { type:'text', text:'初期化しました。もう一度「カンタン見積りを依頼」と入力してください。' });
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

    // 見積り途中に自由入力が来た場合
    if (currentIndex(sess.answers) < QUESTIONS.length){
      await safeReply(ev.replyToken, { type:'text', text:'ボタンからお選びください。選択肢を再表示します。' });
      await confirmStop(userId);
      return;
    }

    // 待受
    await safeReply(ev.replyToken, { type:'text', text:'「カンタン見積りを依頼」と入力すると見積もりを開始します。' });
  }
}

/* ===========================================================================
 * LIFF API エンドポイント
 * ======================================================================== */

// LIFF フォーム送信処理
app.post('/api/submit', upload.array('photos', 10), async (req, res) => {
  try {
    console.log('[INFO] LIFF フォーム送信受信:', req.body);
    
    const { userId, name, phone, zipcode, address1, address2 } = req.body;
    const photos = req.files || [];
    
    if (!userId) {
      return res.status(400).json({ error: 'ユーザーIDが必要です' });
    }

    // セッションから質問回答データを取得
    const sess = sessions.get(userId);
    if (!sess || !sess.answers) {
      return res.status(400).json({ error: '質問回答データが見つかりません' });
    }

    // 写真をアップロード（実際の実装では適切なストレージサービスを使用）
    const photoUrls = [];
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      // ここでは仮のURLを生成（実際にはS3やCloudinaryなどにアップロード）
      const photoUrl = `https://example.com/photos/${userId}_${Date.now()}_${i}.jpg`;
      photoUrls.push(photoUrl);
    }

    // スプレッドシートに記録
    await writeToSpreadsheet({
      userId,
      name,
      phone,
      zipcode,
      address1,
      address2,
      answers: sess.answers,
      photoCount: photos.length,
      estimatedPrice: sess.estimatedPrice || 0
    });

    // メール送信
    await sendEmail({
      userId,
      name,
      phone,
      zipcode,
      address1,
      address2,
      answers: sess.answers,
      photoUrls,
      estimatedPrice: sess.estimatedPrice || 0
    });

    // LINEに完了通知を送信
    await safePush(userId, {
      type: 'text',
      text: 'お見積りのご依頼ありがとうございます。\n1〜3営業日程度でLINEにお送りいたします。'
    });

    // セッションをクリア
    sessions.delete(userId);

    res.json({ success: true, message: '送信が完了しました' });

  } catch (error) {
    console.error('[ERROR] LIFF フォーム送信エラー:', error);
    res.status(500).json({ error: '送信に失敗しました' });
  }
});

// ユーザーセッション情報取得API
app.get('/api/user/:userId', (req, res) => {
  const { userId } = req.params;
  const sess = sessions.get(userId);
  
  if (!sess) {
    return res.status(404).json({ error: 'セッションが見つかりません' });
  }

  res.json({
    answers: sess.answers,
    estimatedPrice: sess.estimatedPrice || 0,
    summary: summarize(sess.answers)
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
 * メール送信
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
    const htmlBody = `
      <h2>LINE見積り依頼</h2>
      <h3>お客様情報</h3>
      <ul>
        <li>お名前: ${data.name}</li>
        <li>電話番号: ${data.phone}</li>
        <li>郵便番号: ${data.zipcode}</li>
        <li>住所: ${data.address1} ${data.address2}</li>
      </ul>
      
      <h3>質問回答</h3>
      <pre>${summarize(data.answers)}</pre>
      
      <h3>概算見積り</h3>
      <p>￥${data.estimatedPrice.toLocaleString()}</p>
      
      <h3>添付写真</h3>
      <p>写真枚数: ${data.photoUrls.length}枚</p>
      ${data.photoUrls.map((url, i) => `<p>写真${i+1}: <a href="${url}">${url}</a></p>`).join('')}
    `;

    await axios.post(emailWebappUrl, {
      to: emailTo,
      subject,
      htmlBody,
      photoUrls: data.photoUrls
    });

    console.log('[INFO] メール送信完了');
  } catch (error) {
    console.error('[ERROR] メール送信エラー:', error);
  }
}

// ---- 起動 ------------------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`listening on ${PORT}`));

