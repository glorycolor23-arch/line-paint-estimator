/*******************************************************
 * 外壁塗装オンライン相談 / サーバー完全版（LIFFで写真を集約）
 * - Render /health
 * - LIFF静的配信 /liff/*
 * - LIFF env.js /liff/env.js
 * - LINE Webhook /webhook
 * - メール（Apps Script）/ スプレッドシート記録
 * - 画像は LIFF から base64 で受け取り Apps Script に転送 → メール添付
 *******************************************************/

import 'dotenv/config';
import express from 'express';
// import cors from 'cors'; // 使わない（自前ミドルウェア）
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import * as line from '@line/bot-sdk';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== ENV ======
const {
  CHANNEL_SECRET,
  CHANNEL_ACCESS_TOKEN,
  LIFF_ID,

  // Google Sheets 記録用（任意）
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  GSHEET_SPREADSHEET_ID,
  GSHEET_SHEET_NAME,

  // Apps Script（メール送信）
  EMAIL_WEBAPP_URL,
  EMAIL_TO
} = process.env;

const PORT = process.env.PORT || 10000;

// ====== 基本チェック ======
if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
  console.error('[WARN] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です。');
}
if (!LIFF_ID) {
  console.error('[WARN] LIFF_ID が未設定です。/liff/env.js で null になります。');
}
if (!EMAIL_WEBAPP_URL || !EMAIL_TO) {
  console.error('[WARN] EMAIL_WEBAPP_URL / EMAIL_TO が未設定です。メール送信は失敗します。');
}

// ====== Google Sheets client（任意・未設定ならスキップ運用） ======
let sheetsClient = null;
if (GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY && GSHEET_SPREADSHEET_ID) {
  try {
    const jwt = new google.auth.JWT(
      GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    sheetsClient = google.sheets({ version: 'v4', auth: jwt });
    console.log('[OK] Google Sheets client ready');
  } catch (e) {
    console.error('[ERROR] Google Sheets client init failed:', e.message);
  }
}

// ====== LINE SDK ======
const lineConfig = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET
};
const lineClient = new line.Client(lineConfig);

// ====== Express ======
const app = express();

/** CORS（自前） */
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '30mb' })); // base64画像を受けるため拡張

/** 静的配信（LIFF） */
app.use('/liff', express.static(path.join(__dirname, 'liff')));

/** env.js（LIFF_ID を渡す） */
app.get('/liff/env.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  const id = LIFF_ID ? `'${LIFF_ID}'` : 'null';
  res.send(`window.__LIFF_ID__ = ${id};`);
});

/** Health */
app.get('/health', (_req, res) => res.status(200).send('ok'));

/** ---------- LIFFからの詳細見積もり送信 ---------- */
app.post('/api/detail-estimate', async (req, res) => {
  try {
    const payload = req.body || {};
    // { userId, name, phone, postal, address1, address2, lat, lng, images:[{label,name,mime,dataBase64}] }

    // 1) スプレッドシート記録（画像情報は除く）
    if (sheetsClient && GSHEET_SPREADSHEET_ID && GSHEET_SHEET_NAME) {
      try {
        const now = new Date().toISOString();
        await sheetsClient.spreadsheets.values.append({
          spreadsheetId: GSHEET_SPREADSHEET_ID,
          range: `${GSHEET_SHEET_NAME}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[
              now,
              payload.userId || '',
              payload.name || '',
              payload.phone || '',
              payload.postal || '',
              payload.address1 || '',
              payload.address2 || '',
              (payload.lat || ''),
              (payload.lng || ''),
              (payload.roughEstimate || ''), // LIFF側で概算を表示しているなら送っておく
              (payload.selectedSummary || '') // チャットで選んだ内容の要約
            ]]
          }
        });
      } catch (e) {
        console.error('[WARN] appendToSheet failed:', e.message);
      }
    }

    // 2) Apps Script WebApp 経由でメール送信
    if (EMAIL_WEBAPP_URL && EMAIL_TO) {
      try {
        const resp = await axios.post(EMAIL_WEBAPP_URL, {
          to: EMAIL_TO,
          subject: `[外壁塗装] 詳細見積りの依頼（LIFF）`,
          body: `
【お名前】${payload.name || ''}
【電話】${payload.phone || ''}
【郵便番号】${payload.postal || ''}
【住所】${payload.address1 || ''} ${payload.address2 || ''}
【緯度経度】${payload.lat || ''},${payload.lng || ''}
【LINEユーザーID】${payload.userId || ''}
【チャット回答要約】${payload.selectedSummary || ''}
【概算金額】${payload.roughEstimate || ''}

※画像は添付をご確認ください。
`,
          // 画像は base64 添付
          attachments: (payload.images || []).map(img => ({
            filename: img.name || `${img.label || 'photo'}.jpg`,
            mimeType: img.mime || 'image/jpeg',
            dataBase64: img.dataBase64 || ''
          }))
        }, { timeout: 30000 });
        console.log('[OK] email send:', resp.status);
      } catch (e) {
        console.error('[ERROR] email send:', e.message, e.response?.status, e.response?.data);
      }
    } else {
      console.error('[WARN] EMAIL_WEBAPP_URL / EMAIL_TO 未設定のためメール未送信');
    }

    // 3) LINEに完了通知（LIFF側でも通知するが、サーバ側からのバックアップ）
    try {
      if (payload.userId) {
        await lineClient.pushMessage(payload.userId, [{
          type: 'text',
          text: '詳細見積りのご依頼を受け付けました。1〜3営業日以内にLINEでお見積書をお送りします。'
        }]);
      }
    } catch (e) {
      console.error('[WARN] pushMessage failed:', e.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('/api/detail-estimate error:', err);
    res.status(500).json({ ok: false, error: 'internal' });
  }
});

/** ---------- Webhook（写真なしの質問フローのみ） ---------- */
const lineMiddleware = line.middleware(lineConfig);
app.post('/webhook', lineMiddleware, async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error('webhook error:', err);
    res.status(500).end();
  }
});

// セッション（簡易）
const S = new Map(); // userId -> {step, answers, flow}

// トリガー（リッチメニューからは "カンタン見積りを依頼"）
const TRIGGER = ['カンタン見積りを依頼', '見積もりスタート'];

// フロー定義（写真は無し）
const FLOW_ALL = [
  { key:'floor', q:'工事物件の階数は？', opts:['1階建て','2階建て','3階建て'] },
  { key:'layout', q:'物件の間取りは？', opts:['1K','1DK','1LDK','2K','2DK','2LDK','3K','3DK','4K','4DK','4LDK'] },
  { key:'age', q:'物件の築年数は？', opts:['新築','〜10年','〜20年','〜30年','〜40年','〜50年','51年以上'] },
  { key:'history', q:'過去に塗装をした経歴は？', opts:['ある','ない','わからない'] },
  { key:'last', q:'前回の塗装はいつ頃？', opts:['〜5年','5〜10年','10〜20年','20〜30年','わからない'] },
  { key:'work', q:'ご希望の工事内容は？', opts:['外壁塗装','屋根塗装','外壁塗装+屋根塗装'] },
  { key:'wall', q:'外壁の種類は？', opts:['モルタル','サイディング','タイル','ALC'],
    show:(a)=> a.work==='外壁塗装' || a.work==='外壁塗装+屋根塗装' },
  { key:'roof', q:'屋根の種類は？', opts:['瓦','スレート','ガルバリウム','トタン'],
    show:(a)=> a.work==='屋根塗装' || a.work==='外壁塗装+屋根塗装' },
  { key:'leak', q:'雨漏りや漏水の症状は？', opts:['雨の日に水滴が落ちる','天井にシミがある','ない'] },
  { key:'distance', q:'隣や裏の家との距離は？（周囲で一番近い距離）', opts:['30cm以下','50cm以下','70cm以下','70cm以上'] },
];

// 画像用にダミーを用意（カード見た目用）
const IMG_PLACE = 'https://dummyimage.com/600x400/eeeeee/333.png&text=%E9%81%B8%E3%81%B6';

async function handleEvent(ev){
  if (ev.type === 'message' && ev.message.type === 'text') {
    return onText(ev);
  }
  if (ev.type === 'postback') {
    return onPostback(ev);
  }
}

function newFlow(){
  return FLOW_ALL.slice(); // shallow copy
}

function visibleFlow(flow, answers){
  return flow.filter(s => !s.show || s.show(answers));
}

async function onText(ev){
  const userId = ev.source?.userId;
  const text = (ev.message.text || '').trim();

  if (text === 'リセット' || text === 'はじめからやり直す') {
    S.delete(userId);
    await replyText(ev.replyToken, '初期化しました。「カンタン見積りを依頼」で開始できます。');
    return;
  }

  if (TRIGGER.includes(text)) {
    S.set(userId, { step:0, answers:{}, flow:newFlow() });
    await replyText(ev.replyToken, '見積もりを開始します。以下の質問にお答えください。');
    await askNext(ev.replyToken, userId);
    return;
  }

  // セッション中に手入力された場合は、そのまま次へ（自由テキストは今回使わない）
  const st = S.get(userId);
  if (st) {
    await replyText(ev.replyToken, '選択肢をタップして回答してください。');
  }
}

async function onPostback(ev){
  const userId = ev.source?.userId;
  const data = ev.postback?.data || '';
  if (!data.startsWith('ans:')) return;

  const st = S.get(userId);
  if (!st) {
    await replyText(ev.replyToken, '「カンタン見積りを依頼」で見積もりを開始してください。');
    return;
  }

  const payload = data.substring(4); // key=value
  const [k, v] = payload.split('=');
  st.answers[k] = v;
  st.step++;
  await askNext(ev.replyToken, userId);
}

async function askNext(replyToken, userId){
  const st = S.get(userId);
  if (!st) return;
  const fl = visibleFlow(st.flow, st.answers);
  if (st.step >= fl.length) {
    // 完了：概算計算 + LIFFボタン
    const estimate = calcRough(st.answers);
    const summary = Object.entries(st.answers).map(([k,v])=>`・${k}: ${v}`).join('\n');
    const liffUrl = `https://liff.line.me/${LIFF_ID}`;
    const flex = {
      type:'flex',
      altText:'詳しい見積りをご希望の方へ',
      contents:{
        type:'bubble',
        body:{ type:'box', layout:'vertical', contents:[
          { type:'text', text:'詳しい見積もりをご希望の方へ', size:'lg', weight:'bold' },
          { type:'separator', margin:'md' },
          { type:'text', text:`見積り金額\n¥ ${estimate.toLocaleString()}`, margin:'md', weight:'bold', size:'lg' },
          { type:'text', text:'上記はご入力内容を元に算出した概算金額です。', wrap:true, size:'sm', color:'#666666', margin:'sm' },
          { type:'text', text:'正式なお見積りが必要な方は続けてご入力をお願いします。', wrap:true, size:'sm', color:'#666666', margin:'sm' }
        ]},
        footer:{ type:'box', layout:'vertical', contents:[
          { type:'button', style:'primary', color:'#00B900',
            action:{ type:'uri', label:'現地調査なしで見積を依頼', uri:liffUrl } }
        ] }
      }
    };
    await lineClient.replyMessage(replyToken, [
      { type:'text', text:`ありがとうございます。以下の内容を確認しました。\n${summary}` },
      flex
    ]);
    S.delete(userId);
  } else {
    const step = fl[st.step];
    await replyOptions(replyToken, step.q, step.key, step.opts);
  }
}

function calcRough(a){
  // 超簡易ロジック（自由に置換可）
  let base = 600000; // 基本
  if (a.floor === '2階建て') base += 200000;
  if (a.floor === '3階建て') base += 400000;
  if (a.work === '外壁塗装+屋根塗装') base += 250000;
  if (a.work === '屋根塗装') base += 150000;
  if (a.leak && a.leak !== 'ない') base += 80000;
  if (a.distance === '30cm以下') base += 50000;
  return base;
}

async function replyOptions(replyToken, question, key, opts){
  // カード風（テンプレート カルーセル）
  const cols = opts.map(txt => ({
    thumbnailImageUrl: IMG_PLACE,
    title: question.length > 39 ? question.slice(0,39) : question,
    text: txt,
    actions: [{ type:'postback', label:'選ぶ', data:`ans:${key}=${txt}`, displayText: txt }]
  }));
  const msg = { type:'template', altText:question, template:{ type:'carousel', columns: cols.slice(0,10) } };
  await lineClient.replyMessage(replyToken, msg);
}

async function replyText(replyToken, text){
  await lineClient.replyMessage(replyToken, { type:'text', text });
}

/** エラーハンドラ */
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('internal error');
});

app.listen(PORT, () => console.log(`listening on ${PORT}`));
