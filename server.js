/**
 * LINE 外壁塗装 見積もりBot + LIFF連絡先フォーム
 * ------------------------------------------------------------
 * ・Q1〜Q9：画像付きクイックリプライ（カード風）
 * ・Q10：写真を1枚ずつ（正面→右→左→後ろ→損傷）
 * ・概算カード → 「現地調査なしで見積を依頼」(LIFF起動)
 * ・LIFF：進捗バー／戻る／郵便番号→住所自動補完／地図ピン／プレビュー／同意
 * ・送信時：IDトークン検証→スプレッドシート追記→管理者メール→完了カード
 * ・質問中の通知を抑制：pushは極力使わず reply で進行
 *
 * 必要な環境変数
 *  - CHANNEL_SECRET
 *  - CHANNEL_ACCESS_TOKEN
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - GOOGLE_SERVICE_ACCOUNT_EMAIL
 *  - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   ← \n を本コード側で置換するので、そのまま貼付OK
 *  - GSHEET_SPREADSHEET_ID
 *  - GSHEET_SHEET_NAME                    ← 例: Sheet1
 *  - EMAIL_TO                             ← 例: matsuo@graphity.co.jp
 *  - EMAIL_WEBAPP_URL                     ← Apps Script WebApp URL
 *  - LIFF_ID                              ← LIFFアプリのID（line://app/<これ>）
 *  - LIFF_CHANNEL_ID                      ← LIFFが紐づくチャネルのChannel ID
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import axios from 'axios';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ────────────────────────────────────────────────────────────
// LINE / Web サーバ
// ────────────────────────────────────────────────────────────
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です');
  process.exit(1);
}
const client = new line.Client(config);
const app = express();

// すでにある app = express() の下あたり
app.use('/liff', express.static('liff'));   // ← 追加


// Health
app.get('/health', (_, res) => res.status(200).send('healthy'));

// Webhook（署名検証のため bodyParser 不使用）
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).send('Error');
  }
});

// LIFF 静的ファイル
app.use('/liff', express.static('public/liff', { maxAge: '1h' }));

// LIFF → 提出API（JSON受け付け）
app.post('/liff/submit', express.json({ limit:'2mb' }), async (req, res) => {
  try {
    const { idToken, name, postal, addr1, addr2, lat, lng, consent } = req.body || {};
    if (!idToken || !consent) return res.status(400).json({ ok:false, error:'missing idToken/consent' });

    // IDトークン検証
    const verifyRes = await axios.post('https://api.line.me/oauth2/v2.1/verify', new URLSearchParams({
      id_token: idToken,
      client_id: process.env.LIFF_CHANNEL_ID
    }));
    const sub = verifyRes?.data?.sub; // LINE userId
    if (!sub) return res.status(401).json({ ok:false, error:'invalid id token' });

    // セッションへ保存
    const s = getSession(sub);
    s.contact = {
      name: name || '',
      postal: (postal || '').replace(/[^\d]/g, ''),
      addr1: addr1 || '',
      addr2: addr2 || '',
      lat: lat || null,
      lng: lng || null
    };

    await finalizeAndNotifyPush(sub);
    try { await client.pushMessage(sub, { type:'text', text:'受付ありがとうございました。1〜2営業日以内に詳細見積りをご連絡します。' }); } catch {}

    return res.json({ ok:true });
  } catch (e) {
    console.error('/liff/submit error:', e?.response?.data || e);
    return res.status(500).json({ ok:false, error:'server error' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LINE bot listening on ${PORT}`));

// ────────────────────────────────────────────────────────────
// 外部サービス（Supabase / Google Sheets / Email）
// ────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function appendToSheet(row) {
  const jwt = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await jwt.authorize();
  const sheets = google.sheets('v4');
  await sheets.spreadsheets.values.append({
    auth: jwt,
    spreadsheetId: process.env.GSHEET_SPREADSHEET_ID,
    range: `${process.env.GSHEET_SHEET_NAME || 'Sheet1'}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// Apps Script WebApp（写真URLを本文 or 添付化）
async function sendAdminEmail({ htmlBody, photoUrls = [] }) {
  const endpoint = process.env.EMAIL_WEBAPP_URL;
  const to = process.env.EMAIL_TO;
  if (!endpoint || !to) return;
  await axios.post(endpoint, {
    to,
    subject: '【外壁塗装】最終入力（概算＋回答＋写真）',
    htmlBody,
    photoUrls,
  }, { timeout: 15000 });
}

// ────────────────────────────────────────────────────────────
// セッション
// ────────────────────────────────────────────────────────────
const sessions = new Map(); // userId → { step, answers, photoIndex, expectingPhoto, photoUrls, needWall, needRoof, contact }

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 1,
      answers: {},
      photoIndex: 0,
      expectingPhoto: false,
      photoUrls: [],
      needWall: false,
      needRoof: false,
      contact: { name:'', postal:'', addr1:'', addr2:'', lat:null, lng:null },
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, {
    step: 1,
    answers: {},
    photoIndex: 0,
    expectingPhoto: false,
    photoUrls: [],
    needWall: false,
    needRoof: false,
    contact: { name:'', postal:'', addr1:'', addr2:'', lat:null, lng:null },
  });
}

// ────────────────────────────────────────────────────────────
// UI 素材
// ────────────────────────────────────────────────────────────
const ICONS = {
  floor: 'https://cdn-icons-png.flaticon.com/512/8911/8911331.png',
  layout: 'https://cdn-icons-png.flaticon.com/512/9193/9193091.png',
  paint: 'https://cdn-icons-png.flaticon.com/512/992/992703.png',
  yes: 'https://cdn-icons-png.flaticon.com/512/5610/5610944.png',
  no: 'https://cdn-icons-png.flaticon.com/512/5610/5610944.png',
  years: 'https://cdn-icons-png.flaticon.com/512/1827/1827370.png',
  wall: 'https://cdn-icons-png.flaticon.com/512/2992/2992653.png',
  roof: 'https://cdn-icons-png.flaticon.com/512/2933/2933922.png',
  leak: 'https://cdn-icons-png.flaticon.com/512/415/415734.png',
  distance: 'https://cdn-icons-png.flaticon.com/512/535/535285.png',
  camera: 'https://cdn-icons-png.flaticon.com/512/685/685655.png',
  card: 'https://images.unsplash.com/photo-1501183638710-841dd1904471?q=80&w=1280&auto=format&fit=crop'
};

// 写真ステップ
const PHOTO_STEPS = [
  { key: 'front', label: '外観写真：正面' },
  { key: 'right', label: '外観写真：右側' },
  { key: 'left', label: '外観写真：左側' },
  { key: 'back', label: '外観写真：後ろ側' },
  { key: 'damage', label: '損傷箇所（任意）' },
];

// ────────────────────────────────────────────────────────────
// イベントハンドラ
// ────────────────────────────────────────────────────────────
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n' +
      '外壁・屋根塗装の【かんたん概算見積もり】をご案内します。\n' +
      '「見積もり」または「スタート」と送ってください。'
    );
  }

  if (event.type === 'message') {
    const { message } = event;

    if (message.type === 'text') {
      const text = (message.text || '').trim();

      if (/^(最初から|リセット)$/i.test(text)) {
        resetSession(userId);
        return replyText(event.replyToken, '回答をリセットしました。\n「見積もり」または「スタート」と送ってください。');
      }

      if (/^(見積もり|スタート|start)$/i.test(text)) {
        resetSession(userId);
        return askQ1(event.replyToken, userId);
      }

      // 写真待ちのときのテキスト（スキップ/完了）
      const s = getSession(userId);
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(text)) {
          return askNextPhoto(event.replyToken, userId, { advance:true, notify:'スキップしました。' });
        }
        if (/^(完了|おわり|終了)$/i.test(text)) {
          s.photoIndex = PHOTO_STEPS.length;
          return askContact(event.replyToken, userId);
        }
        return replyText(event.replyToken, '画像を送信してください。スキップは「スキップ」と送ってください。');
      }

      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。');
    }

    if (message.type === 'image') {
      const s = getSession(userId);
      if (!s.expectingPhoto) {
        return replyText(event.replyToken, 'ありがとうございます。いま質問中です。ボタンから続きにお進みください。');
      }
      // 画像保存 → 次案内（replyでまとめて返す）
      try {
        const saved = await saveImageToSupabase(userId, message.id, s);
        const current = PHOTO_STEPS[s.photoIndex];
        const got = current ? `受け取りました：${current.label}` : '受け取りました。';
        return askNextPhoto(event.replyToken, userId, { advance:true, notify:got });
      } catch (e) {
        console.error('saveImage:', e);
        return askNextPhoto(event.replyToken, userId, { advance:false, notify:'画像の保存に失敗しました。もう一度お試しください。' });
      }
    }

    return;
  }

  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data);
    const s = getSession(userId);
    const q = Number(data.q);
    const v = data.v;
    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    s.answers[`q${q}`] = v;

    // Q3で分岐準備
    if (q === 3) {
      s.needWall = (v === '外壁塗装' || v === '外壁塗装＋屋根塗装');
      s.needRoof = (v === '屋根塗装'  || v === '外壁塗装＋屋根塗装');
    }

    // Q4：ない/わからない → Q5スキップ
    if (q === 4) {
      if (v === 'ない' || v === 'わからない') {
        s.answers.q5 = '該当なし';
        s.step = 6;
        return routeAfterQ5(event.replyToken, userId);
      }
    }

    s.step = q + 1;
    switch (s.step) {
      case 2: return askQ2(event.replyToken, userId);
      case 3: return askQ3(event.replyToken, userId);
      case 4: return askQ4(event.replyToken, userId);
      case 5: return askQ5(event.replyToken, userId);
      case 6: return routeAfterQ5(event.replyToken, userId);
      case 7: return routeAfterQ6(event.replyToken, userId);
      case 8: return askQ8(event.replyToken, userId);
      case 9: return askQ9(event.replyToken, userId);
      case 10: return askQ10_Begin(event.replyToken, userId);
      case 11: return askContact(event.replyToken, userId);
      default: return askContact(event.replyToken, userId);
    }
  }
}

async function routeAfterQ5(rt, userId){
  const s = getSession(userId);
  if (s.needWall) return askQ6(rt, userId);
  return routeAfterQ6(rt, userId);
}
async function routeAfterQ6(rt, userId){
  const s = getSession(userId);
  if (s.needRoof) return askQ7(rt, userId);
  return askQ8(rt, userId);
}

// ────────────────────────────────────────────────────────────
// 質問UI（画像付きクイックリプライ）
// ────────────────────────────────────────────────────────────
function quick(items){ return { items }; }
function pb(label, data, imageUrl) {
  return { type:'action', imageUrl, action:{ type:'postback', label, data, displayText:label } };
}

async function askQ1(rt, userId){
  const s = getSession(userId); s.step = 1;
  const items = [
    pb('1階建て', qs.stringify({q:1,v:'1階建て'}), ICONS.floor),
    pb('2階建て', qs.stringify({q:1,v:'2階建て'}), ICONS.floor),
    pb('3階建て', qs.stringify({q:1,v:'3階建て'}), ICONS.floor),
  ];
  return client.replyMessage(rt, { type:'text', text:'1/10 住宅の階数を選んでください', quickReply: quick(items) });
}
async function askQ2(rt){
  const L = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  return client.replyMessage(rt, { type:'text', text:'2/10 住宅の間取りを選んでください', quickReply: quick(L.map(v=>pb(v,qs.stringify({q:2,v}),ICONS.layout))) });
}
async function askQ3(rt){
  const A = [
    pb('外壁塗装', qs.stringify({q:3,v:'外壁塗装'}), ICONS.paint),
    pb('屋根塗装', qs.stringify({q:3,v:'屋根塗装'}), ICONS.paint),
    pb('外壁塗装＋屋根塗装', qs.stringify({q:3,v:'外壁塗装＋屋根塗装'}), ICONS.paint),
  ];
  return client.replyMessage(rt, { type:'text', text:'3/10 希望する工事内容を選んでください', quickReply: quick(A) });
}
async function askQ4(rt){
  const A = [
    pb('ある', qs.stringify({q:4,v:'ある'}), ICONS.yes),
    pb('ない', qs.stringify({q:4,v:'ない'}), ICONS.no),
    pb('わからない', qs.stringify({q:4,v:'わからない'}), ICONS.no),
  ];
  return client.replyMessage(rt, { type:'text', text:'4/10 これまで外壁塗装をしたことはありますか？', quickReply: quick(A) });
}
async function askQ5(rt){
  const L = ['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  return client.replyMessage(rt, { type:'text', text:'5/10 前回の外壁塗装からどれくらい経っていますか？', quickReply: quick(L.map(v=>pb(v,qs.stringify({q:5,v}),ICONS.years))) });
}
async function askQ6(rt){
  const L = ['モルタル','サイディング','タイル','ALC'];
  return client.replyMessage(rt, { type:'text', text:'6/10 外壁の種類を選んでください', quickReply: quick(L.map(v=>pb(v,qs.stringify({q:6,v}),ICONS.wall))) });
}
async function askQ7(rt){
  const L = ['瓦','スレート','ガルバリウム','トタン'];
  return client.replyMessage(rt, { type:'text', text:'7/10 屋根の種類を選んでください', quickReply: quick(L.map(v=>pb(v,qs.stringify({q:7,v}),ICONS.roof))) });
}
async function askQ8(rt){
  const L = ['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'];
  return client.replyMessage(rt, { type:'text', text:'8/10 雨漏りの状況を選んでください', quickReply: quick(L.map(v=>pb(v,qs.stringify({q:8,v}),ICONS.leak))) });
}
async function askQ9(rt){
  const L = ['30cm以下','50cm以下','70cm以下','70cm以上'];
  return client.replyMessage(rt, { type:'text', text:'9/10 周辺との最短距離（足場の目安）を選んでください', quickReply: quick(L.map(v=>pb(v,qs.stringify({q:9,v}),ICONS.distance))) });
}

// 写真開始
async function askQ10_Begin(rt, userId) {
  const s = getSession(userId);
  s.expectingPhoto = true;
  s.photoIndex = 0;
  return askNextPhoto(rt, userId, { advance:false, notify:null });
}

// 次の写真
async function askNextPhoto(rt, userId, { advance, notify } = { advance:false, notify:null }) {
  const s = getSession(userId);
  if (!s.expectingPhoto) s.expectingPhoto = true;
  if (advance) s.photoIndex += 1;

  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    return askContact(rt, userId);
  }

  const cur = PHOTO_STEPS[s.photoIndex];
  const items = [
    { type:'action', imageUrl: ICONS.camera, action:{ type:'camera', label:'カメラを起動' } },
    { type:'action', imageUrl: ICONS.camera, action:{ type:'cameraRoll', label:'アルバムから選択' } },
    { type:'action', imageUrl: ICONS.no, action:{ type:'message', label:'スキップ', text:'スキップ' } },
    { type:'action', imageUrl: ICONS.yes, action:{ type:'message', label:'完了', text:'完了' } },
  ];
  const text = notify
    ? `${notify}\n\n10/10 写真アップロード\n「${cur.label}」を送ってください。`
    : `10/10 写真アップロード\n「${cur.label}」を送ってください。`;

  return client.replyMessage(rt, { type:'text', text, quickReply:{ items } });
}

// 画像保存（Supabase Storage /photos）
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
async function saveImageToSupabase(userId, messageId, s) {
  const stream = await client.getMessageContent(messageId);
  const buf = await streamToBuffer(stream);
  const filename = `${PHOTO_STEPS[s.photoIndex]?.key || 'photo'}_${Date.now()}.jpg`;
  const filepath = `line/${userId}/${filename}`;

  const { error } = await supabase.storage.from('photos').upload(filepath, buf, {
    contentType: 'image/jpeg',
    upsert: true
  });
  if (error) throw error;

  const { data: pub } = supabase.storage.from('photos').getPublicUrl(filepath);
  const publicUrl = pub?.publicUrl;
  if (publicUrl) s.photoUrls.push(publicUrl);
  return publicUrl;
}

// 見積り
function estimateCost(a) {
  const base = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装＋屋根塗装': 900000 };
  const floor = { '1階建て': 1.0, '2階建て': 1.2, '3階建て': 1.4 };
  const layout = { '1DK':0.9,'1LDK':0.95,'2DK':1.0,'2LDK':1.05,'3DK':1.1,'3LDK':1.15,'4DK':1.2,'4LDK':1.25,'5DK':1.3,'5LDK':1.35 };
  const wall = { 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof = { '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak = { '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.1,'雨漏りはない':1.0 };
  const dist = { '30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.1,'70cm以上':1.0 };
  const years = { '1〜5年':0.95,'5〜10年':1.0,'10〜15年':1.05,'15〜20年':1.1,'20〜30年':1.15,'30〜40年':1.2,'40年以上':1.25,'0年（新築）':0.9 };

  let cost = base[a.q3] || 600000;
  cost *= floor[a.q1] || 1.0;
  cost *= layout[a.q2] || 1.0;
  if (a.q3 === '外壁塗装' || a.q3 === '外壁塗装＋屋根塗装') cost *= wall[a.q6] || 1.0;
  if (a.q3 === '屋根塗装'  || a.q3 === '外壁塗装＋屋根塗装') cost *= roof[a.q7] || 1.0;
  cost *= leak[a.q8] || 1.0;
  cost *= dist[a.q9] || 1.0;
  if (a.q4 === 'ある') cost *= years[a.q5] || 1.0;

  return Math.round(cost / 1000) * 1000;
}
function yen(n){ return n.toLocaleString('ja-JP',{ style:'currency', currency:'JPY', maximumFractionDigits:0 }); }
function summaryText(a, count){
  return [
    '【回答の確認】',
    `・階数: ${a.q1||'-'} / 間取り: ${a.q2||'-'} / 工事: ${a.q3||'-'}`,
    `・過去塗装: ${a.q4||'-'} / 前回から: ${a.q5||'該当なし'}`,
    `・外壁: ${a.q6||'-'} / 屋根: ${a.q7||'-'} / 雨漏り: ${a.q8||'-'}`,
    `・最短距離: ${a.q9||'-'} / 受領写真: ${count}枚`
  ].join('\n');
}

// 概算カード → LIFF 起動
async function askContact(rt, userId){
  const s = getSession(userId);
  const a = s.answers;
  const estimate = estimateCost(a);
  const count = s.photoUrls.length;

  await client.replyMessage(rt, [
    { type:'text', text: summaryText(a, count) },
    {
      type:'flex',
      altText:'詳しい見積りをご希望の方へ',
      contents:{
        type:'bubble',
        body:{
          type:'box',
          layout:'vertical',
          spacing:'md',
          contents:[
            { type:'text', text:'詳しい見積りをご希望の方へ', weight:'bold', size:'md' },
            { type:'text', text:'見積り金額', weight:'bold', size:'sm', color:'#666666' },
            { type:'text', text:`${yen(estimate)}`, weight:'bold', size:'xl' },
            { type:'text', text:'上記はご入力いただいた内容を元に算出した概算金額です。', wrap:true, size:'sm', color:'#666666' },
            { type:'text', text:'正式なお見積りが必要な方は続けてご入力をお願いします。', wrap:true, size:'sm' },
            { type:'text', text:'現地調査なしで、詳細な見積りをLINEでお知らせします。', wrap:true, size:'sm' }
          ]
        },
        footer:{
          type:'box',
          layout:'vertical',
          contents:[
            { type:'button', style:'primary', action:{ type:'uri', label:'現地調査なしで見積を依頼', uri:`line://app/${process.env.LIFF_ID}` } }
          ]
        }
      }
    }
  ]);
}

// 最終確定（LIFF送信後）
async function finalizeAndNotifyPush(userId) {
  const s = getSession(userId);
  const a = s.answers;
  const est = estimateCost(a);
  const now = new Date();

  // スプレッドシート
  const row = [
    now.toISOString(),
    userId,
    s.contact.name, s.contact.postal, s.contact.addr1, s.contact.addr2,
    a.q1||'', a.q2||'', a.q3||'', a.q4||'', a.q5||'',
    a.q6||'', a.q7||'', a.q8||'', a.q9||'',
    s.photoUrls.length, est,
    s.contact.lat || '', s.contact.lng || ''
  ];
  try { await appendToSheet(row); } catch(e){ console.error('appendToSheet', e?.response?.data || e); }

  // 管理者メール
  const html = `
  <div style="font-family:system-ui,Segoe UI,Helvetica,Arial">
    <h2>外壁塗装 — 最終入力</h2>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
      <tr><th align="left">LINEユーザーID</th><td>${esc(userId)}</td></tr>
      <tr><th align="left">お名前</th><td>${esc(s.contact.name)}</td></tr>
      <tr><th align="left">郵便番号</th><td>${esc(s.contact.postal)}</td></tr>
      <tr><th align="left">住所1</th><td>${esc(s.contact.addr1)}</td></tr>
      <tr><th align="left">住所2</th><td>${esc(s.contact.addr2)}</td></tr>
      <tr><th align="left">緯度/経度</th><td>${s.contact.lat||''} / ${s.contact.lng||''}</td></tr>
      <tr><th align="left">階数</th><td>${esc(a.q1||'')}</td></tr>
      <tr><th align="left">間取り</th><td>${esc(a.q2||'')}</td></tr>
      <tr><th align="left">工事内容</th><td>${esc(a.q3||'')}</td></tr>
      <tr><th align="left">過去塗装</th><td>${esc(a.q4||'')}</td></tr>
      <tr><th align="left">前回から</th><td>${esc(a.q5||'')}</td></tr>
      <tr><th align="left">外壁</th><td>${esc(a.q6||'')}</td></tr>
      <tr><th align="left">屋根</th><td>${esc(a.q7||'')}</td></tr>
      <tr><th align="left">雨漏り</th><td>${esc(a.q8||'')}</td></tr>
      <tr><th align="left">距離</th><td>${esc(a.q9||'')}</td></tr>
      <tr><th align="left">受領写真</th><td>${s.photoUrls.length} 枚</td></tr>
      <tr><th align="left">概算金額</th><td>${esc(yen(est))}</td></tr>
      <tr><th align="left">タイムスタンプ</th><td>${now.toLocaleString('ja-JP')}</td></tr>
    </table>
    ${s.photoUrls?.length ? `<p>写真リンク：</p><ol>${s.photoUrls.map(u=>`<li><a href="${u}">${u}</a></li>`).join('')}</ol>`:''}
  </div>`;
  try { await sendAdminEmail({ htmlBody: html, photoUrls: s.photoUrls }); } catch(e){ console.error('sendAdminEmail', e?.response?.data || e); }

  // 完了カード
  try {
    await client.pushMessage(userId, {
      type:'flex',
      altText:'お見積りのご依頼ありがとうございます',
      contents:{
        type:'bubble',
        hero:{ type:'image', url: ICONS.card, size:'full', aspectRatio:'16:9', aspectMode:'cover' },
        body:{ type:'box', layout:'vertical', spacing:'md', contents:[
          { type:'text', text:'お見積りのご依頼ありがとうございます', weight:'bold', wrap:true },
          { type:'text', text:'送信された内容を確認し、1〜2営業日程度で詳細なお見積りをLINEでご返信致します。', wrap:true }
        ]}
      }
    });
  } catch {}

  resetSession(userId);
}

function esc(s){ return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function replyText(rt, text){ return client.replyMessage(rt, { type:'text', text }); }


// 追加：フロントに LIFF_ID を渡すための動的JS
app.get('/liff/config.js', (_, res) => {
  res.type('application/javascript')
     .send(`window.__LIFF_ID__=${JSON.stringify(process.env.LIFF_ID || '')};`);
});


