/**
 * 外壁塗装 見積もりBot（完全版）
 * - QAはクイックリプライ（必要な所は画像アイコン付き）
 * - 写真は Supabase Storage（photos バケット）
 * - 最終確定のみ Googleスプレッドシートへ追記 & Apps Script経由でメール送信（写真は添付）
 * - 連絡先ボタンは POSTBACK（「詳しい見積もりを依頼する」テキストが“名前”に入らない）
 * - 郵便番号→住所は zipcloud で自動補完
 *
 * 必要な環境変数
 *  CHANNEL_SECRET
 *  CHANNEL_ACCESS_TOKEN
 *  SUPABASE_URL
 *  SUPABASE_SERVICE_ROLE_KEY
 *  GOOGLE_SERVICE_ACCOUNT_EMAIL
 *  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  // 改行は \\n -> \n に変換して使用
 *  GSHEET_SPREADSHEET_ID
 *  GSHEET_SHEET_NAME                  // 例: 'Sheet1'
 *  EMAIL_TO                           // 例: 'matsuo@graphity.co.jp'
 *  EMAIL_WEBAPP_URL                   // Apps Script WebアプリURL（下記サンプル）
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import axios from 'axios';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ────────────────────────────────────────────────────────────
// LINE
// ────────────────────────────────────────────────────────────
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定');
  process.exit(1);
}
const client = new line.Client(config);
const app = express(); // ※ express.json() は付けない（LINE署名検証と干渉させない）

app.get('/health', (_, res) => res.status(200).send('healthy'));

app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).end();
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`listening on ${PORT}`));

// ────────────────────────────────────────────────────────────
// 外部サービス
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

// Apps Script WebApp（下にサンプルあり）へ投げる
async function sendAdminEmail({ htmlBody, photoUrls = [] }) {
  const endpoint = process.env.EMAIL_WEBAPP_URL;
  const to = process.env.EMAIL_TO;
  if (!endpoint || !to) return;

  await axios.post(endpoint, {
    to,
    subject: '【外壁塗装】最終入力（概算＋回答＋写真）',
    htmlBody,
    photoUrls,
  }, { timeout: 20000 });
}

// ────────────────────────────────────────────────────────────
// セッション
// ────────────────────────────────────────────────────────────
const sessions = new Map(); // userId -> state

function newSession() {
  return {
    step: 1,
    answers: {},
    expectingPhoto: false,
    photoIndex: -1, // askNextPhotoで最初に+1して0番へ
    photoUrls: [],
    contact: { name: '', postal: '', addr1: '', addr2: '' },
  };
}
function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, newSession());
  return sessions.get(userId);
}
function resetSession(userId) { sessions.set(userId, newSession()); }

// ────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────
const START_WORDS = ['見積もり', '見積り', '見積', 'スタート', '開始', 'start'];
const RESET_WORDS = ['リセット', '最初から', 'やり直し', 'reset'];

function isStartCommand(text) {
  const t = (text || '').replace(/\s+/g, '');
  return START_WORDS.some(w => t.includes(w));
}
function isResetCommand(text) {
  const t = (text || '').replace(/\s+/g, '');
  return RESET_WORDS.some(w => t.includes(w));
}

function replyText(rt, text) { return client.replyMessage(rt, { type: 'text', text }); }
function yen(n) { return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }); }
function esc(s){ return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

const ICONS = {
  floor: 'https://cdn-icons-png.flaticon.com/512/8911/8911331.png',
  layout: 'https://cdn-icons-png.flaticon.com/512/9193/9193091.png',
  paint: 'https://cdn-icons-png.flaticon.com/512/992/992703.png',
  yes: 'https://cdn-icons-png.flaticon.com/512/5610/5610944.png',
  no: 'https://cdn-icons-png.flaticon.com/512/463/463612.png',
  years: 'https://cdn-icons-png.flaticon.com/512/1827/1827370.png',
  wall: 'https://cdn-icons-png.flaticon.com/512/2992/2992653.png',
  roof: 'https://cdn-icons-png.flaticon.com/512/2933/2933922.png',
  leak: 'https://cdn-icons-png.flaticon.com/512/415/415734.png',
  distance: 'https://cdn-icons-png.flaticon.com/512/535/535285.png',
  camera: 'https://cdn-icons-png.flaticon.com/512/685/685655.png',
};

// 10/10 写真
const PHOTO_STEPS = [
  { key: 'front',  label: '外観写真：正面' },
  { key: 'right',  label: '外観写真：右側' },
  { key: 'left',   label: '外観写真：左側' },
  { key: 'back',   label: '外観写真：後ろ側' },
  { key: 'damage', label: '損傷箇所（任意）' },
];

// ────────────────────────────────────────────────────────────
// メイン ハンドラ
// ────────────────────────────────────────────────────────────
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n' +
      '外壁・屋根塗装の【かんたん概算見積もり】をご案内します。\n' +
      '「見積もり」や「スタート」と送ってください。'
    );
  }

  if (event.type === 'message') {
    const msg = event.message;
    if (msg.type === 'text') {
      const text = (msg.text || '').trim();
      const s = getSession(userId);

      // リセット
      if (isResetCommand(text)) {
        resetSession(userId);
        return replyText(event.replyToken, '回答をリセットしました。\n「見積もり」または「スタート」と送ってください。');
      }

      // 連絡先ボタン互換（旧クライアントが message を送る場合）
      if (text === '詳しい見積もりを依頼する') {
        s.step = 'contact_name';
        return replyText(event.replyToken, 'お名前を入力してください（フルネーム）');
      }

      // 連絡先入力フェーズ
      if (s.step === 'contact_name') {
        s.contact.name = text;
        s.step = 'contact_postal';
        return replyText(event.replyToken, '郵便番号を入力してください（7桁。ハイフン可）');
      }
      if (s.step === 'contact_postal') {
        const zip = text.replace(/[^\d]/g, '').slice(0, 7);
        s.contact.postal = zip;
        // 郵便番号→住所自動補完
        try {
          if (zip && zip.length === 7) {
            const r = await axios.get(`https://zipcloud.ibsnet.co.jp/api/search`, { params: { zipcode: zip }, timeout: 8000 });
            const res = r?.data;
            if (res?.results && res.results.length) {
              const z = res.results[0];
              const addr = `${z.address1}${z.address2}${z.address3}`; // 県市区町村
              s.contact.addr1 = addr;
              s.step = 'contact_addr2';
              return replyText(event.replyToken, `住所を自動入力しました：\n${addr}\n\n建物名・部屋番号など（あれば）を入力してください。無ければ「なし」`);
            }
          }
        } catch (e) {
          console.warn('zipcloud error', e?.message || e);
        }
        s.step = 'contact_addr1';
        return replyText(event.replyToken, '住所（都道府県・市区町村・番地など）を入力してください');
      }
      if (s.step === 'contact_addr1') {
        s.contact.addr1 = text;
        s.step = 'contact_addr2';
        return replyText(event.replyToken, '建物名・部屋番号など（あれば）を入力してください。無ければ「なし」');
      }
      if (s.step === 'contact_addr2') {
        s.contact.addr2 = (text === 'なし') ? '' : text;
        return finalizeAndNotify(event.replyToken, userId);
      }

      // 見積もり開始
      if (isStartCommand(text)) {
        resetSession(userId);
        return askQ1(event.replyToken, userId);
      }

      // 写真待ち中のテキスト（スキップ・完了）
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(text)) return askNextPhoto(event.replyToken, userId, true);
        if (/^(完了|おわり|終了)$/i.test(text)) {
          s.photoIndex = PHOTO_STEPS.length - 1; // 最後にして…
          return askNextPhoto(event.replyToken, userId, false); // …完了動線へ
        }
        return replyText(event.replyToken, '画像を送信してください。送らない場合は「スキップ」、すべて終えたら「完了」と送ってください。');
      }

      // それ以外
      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。');
    }

    if (msg.type === 'image') {
      const s = getSession(userId);
      if (!s.expectingPhoto) {
        return replyText(event.replyToken, 'ありがとうございます。いま質問中です。ボタンから続きへお進みください。');
      }
      // 非同期で保存
      saveImageToSupabase(userId, msg.id, s).catch(err => console.error('saveImage:', err));
      // すぐ次を案内
      return askNextPhoto(event.replyToken, userId, false);
    }

    return;
  }

  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data || '');

    // 連絡先開始
    if (data.contact === 'start') {
      const s = getSession(userId);
      s.step = 'contact_name';
      return replyText(event.replyToken, 'お名前を入力してください（フルネーム）');
    }

    // 通常QA
    const q = Number(data.q);
    const v = data.v;
    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }
    const s = getSession(userId);
    s.answers[`q${q}`] = v;

    // Q4 分岐（前回塗装）
    if (q === 4 && (v === 'ない' || v === 'わからない')) {
      s.answers.q5 = '該当なし';
      s.step = 6;
      return askQ6(event.replyToken, userId);
    }

    s.step = q + 1;
    switch (s.step) {
      case 2: return askQ2(event.replyToken);
      case 3: return askQ3(event.replyToken);
      case 4: return askQ4(event.replyToken);
      case 5: return askQ5(event.replyToken);
      case 6: return askQ6(event.replyToken);
      case 7: return askQ7(event.replyToken);
      case 8: return askQ8(event.replyToken);
      case 9: return askQ9(event.replyToken);
      case 10: return askQ10_Begin(event.replyToken, userId);
      case 11: return askContact(event.replyToken, userId);
      default: return askContact(event.replyToken, userId);
    }
  }
}

// ────────────────────────────────────────────────────────────
// QA 画面
// ────────────────────────────────────────────────────────────
function quickReply(items) { return { items }; }
function pb(label, data, imageUrl) {
  return { type: 'action', imageUrl, action: { type: 'postback', label, data, displayText: label } };
}

async function askQ1(rt, userId) {
  getSession(userId).step = 1;
  return client.replyMessage(rt, {
    type: 'text',
    text: '1/10 階数を選んでください',
    quickReply: quickReply([
      pb('1階建て', qs.stringify({ q: 1, v: '1階建て' }), ICONS.floor),
      pb('2階建て', qs.stringify({ q: 1, v: '2階建て' }), ICONS.floor),
      pb('3階建て', qs.stringify({ q: 1, v: '3階建て' }), ICONS.floor),
    ])
  });
}
async function askQ2(rt){ 
  const L = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  return client.replyMessage(rt,{type:'text',text:'2/10 間取りを選んでください',quickReply:quickReply(L.map(v=>pb(v,qs.stringify({q:2,v}),ICONS.layout)))});
}
async function askQ3(rt){
  const A=[pb('外壁塗装',qs.stringify({q:3,v:'外壁塗装'}),ICONS.paint),
           pb('屋根塗装',qs.stringify({q:3,v:'屋根塗装'}),ICONS.paint),
           pb('外壁塗装＋屋根塗装',qs.stringify({q:3,v:'外壁塗装＋屋根塗装'}),ICONS.paint)];
  return client.replyMessage(rt,{type:'text',text:'3/10 希望する工事内容を選んでください',quickReply:quickReply(A)});
}
async function askQ4(rt){
  const A=[pb('ある',qs.stringify({q:4,v:'ある'}),ICONS.yes),
           pb('ない',qs.stringify({q:4,v:'ない'}),ICONS.no),
           pb('わからない',qs.stringify({q:4,v:'わからない'}),ICONS.no)];
  return client.replyMessage(rt,{type:'text',text:'4/10 これまで外壁塗装をしたことはありますか？',quickReply:quickReply(A)});
}
async function askQ5(rt){
  const L=['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  return client.replyMessage(rt,{type:'text',text:'5/10 前回の外壁塗装からどれくらい？',quickReply:quickReply(L.map(v=>pb(v,qs.stringify({q:5,v}),ICONS.years)))});
}
async function askQ6(rt){
  const L=['モルタル','サイディング','タイル','ALC'];
  return client.replyMessage(rt,{type:'text',text:'6/10 外壁の種類は？',quickReply:quickReply(L.map(v=>pb(v,qs.stringify({q:6,v}),ICONS.wall)))});
}
async function askQ7(rt){
  const L=['瓦','スレート','ガルバリウム','トタン'];
  return client.replyMessage(rt,{type:'text',text:'7/10 屋根の種類は？',quickReply:quickReply(L.map(v=>pb(v,qs.stringify({q:7,v}),ICONS.roof)))});
}
async function askQ8(rt){
  const L=['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'];
  return client.replyMessage(rt,{type:'text',text:'8/10 雨漏りの状況は？',quickReply:quickReply(L.map(v=>pb(v,qs.stringify({q:8,v}),ICONS.leak)))});
}
async function askQ9(rt){
  const L=['30cm以下','50cm以下','70cm以下','70cm以上'];
  return client.replyMessage(rt,{type:'text',text:'9/10 周辺との最短距離（足場の目安）',quickReply:quickReply(L.map(v=>pb(v,qs.stringify({q:9,v}),ICONS.distance)))});
}

// 10/10 写真
async function askQ10_Begin(rt, userId) {
  const s = getSession(userId);
  s.expectingPhoto = true;
  s.photoIndex = -1;
  return askNextPhoto(rt, userId, false);
}
async function askNextPhoto(rt, userId, skipped) {
  const s = getSession(userId);
  s.photoIndex += 1;
  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    return askContact(rt, userId);
  }
  const cur = PHOTO_STEPS[s.photoIndex];
  const items = [
    { type:'action', imageUrl:ICONS.camera, action:{ type:'camera', label:'カメラを起動' } },
    { type:'action', imageUrl:ICONS.camera, action:{ type:'cameraRoll', label:'アルバムから' } },
    { type:'action', imageUrl:ICONS.no,     action:{ type:'message', label:'スキップ', text:'スキップ' } },
    { type:'action', imageUrl:ICONS.yes,    action:{ type:'message', label:'完了', text:'完了' } },
  ];
  const text = `10/10 写真アップロード\n「${cur.label}」を送ってください。\n` +
               `※一部端末で「カメラ」「アルバム」ボタンが出ない場合があります。その際は画面左下の「＋」から送信してください。`;
  return client.replyMessage(rt, { type:'text', text, quickReply: { items } });
}

// 連絡先入力導線（POSTBACKで開始）
async function askContact(rt, userId) {
  const s = getSession(userId);
  const a = s.answers;
  const estimate = estimateCost(a);
  const count = s.photoUrls.length;

  await client.replyMessage(rt, [
    { type:'text', text: summaryText(a, count) },
    { type:'text', text: `概算金額：${yen(estimate)}\n\nより詳しい見積もりをご希望の方は、下のボタンから連絡先をご入力ください。` },
    {
      type:'flex', altText:'連絡先の入力', contents:{
        type:'bubble',
        body:{type:'box',layout:'vertical',spacing:'md',contents:[
          {type:'text',text:'詳しい見積もりをご希望の方へ',weight:'bold',wrap:true},
          {type:'text',text:'ボタンを押して、お名前とご住所を入力してください。',wrap:true}
        ]},
        footer:{type:'box',layout:'vertical',contents:[
          {type:'button',style:'primary',
           action:{type:'postback',label:'詳しい見積もりを依頼する',data:'contact=start',displayText:'詳しい見積もりを依頼する'}}
        ]}
      }
    }
  ]);
}

function summaryText(a, count){
  return [
    '【回答の確認】',
    `・階数: ${a.q1||'-'} / 間取り: ${a.q2||'-'} / 工事: ${a.q3||'-'}`,
    `・過去塗装: ${a.q4||'-'} / 前回から: ${a.q5||'該当なし'}`,
    `・外壁: ${a.q6||'-'} / 屋根: ${a.q7||'-'} / 雨漏り: ${a.q8||'-'}`,
    `・最短距離: ${a.q9||'-'} / 受領写真: ${count}枚`
  ].join('\n');
}

// ────────────────────────────────────────────────────────────
// 保存（Supabase）
// ────────────────────────────────────────────────────────────
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
  const name = PHOTO_STEPS[s.photoIndex]?.key || `photo${s.photoIndex}`;
  const filename = `${name}_${Date.now()}.jpg`;
  const filepath = `line/${userId}/${filename}`;

  const { error } = await supabase.storage.from('photos').upload(filepath, buf, {
    contentType: 'image/jpeg',
    upsert: true
  });
  if (error) throw error;

  const { data: pub } = supabase.storage.from('photos').getPublicUrl(filepath);
  if (pub?.publicUrl) s.photoUrls.push(pub.publicUrl);
}

// ────────────────────────────────────────────────────────────
// 見積もり計算 & 最終確定
// ────────────────────────────────────────────────────────────
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
  cost *= wall[a.q6] || 1.0;
  cost *= leak[a.q8] || 1.0;
  cost *= dist[a.q9] || 1.0;
  if (a.q3 === '屋根塗装' || a.q3 === '外壁塗装＋屋根塗装') cost *= roof[a.q7] || 1.0;
  if (a.q4 === 'ある') cost *= years[a.q5] || 1.0;

  return Math.round(cost / 1000) * 1000;
}

async function finalizeAndNotify(replyToken, userId) {
  const s = getSession(userId);
  const a = s.answers;
  const est = estimateCost(a);
  const now = new Date();

  // スプレッドシート（列順固定）
  const row = [
    now.toISOString(),        // A: Timestamp
    userId,                   // B: LINEユーザーID
    s.contact.name,           // C: 名前
    s.contact.postal,         // D: 郵便番号
    s.contact.addr1,          // E: 住所1
    s.contact.addr2,          // F: 住所2
    a.q1||'', a.q2||'', a.q3||'', a.q4||'', a.q5||'',
    a.q6||'', a.q7||'', a.q8||'', a.q9||'', // G〜N, O〜?
    s.photoUrls.length,       // O: 写真枚数
    est                       // P: 概算見積
  ];
  try { await appendToSheet(row); } catch (e) { console.error('appendToSheet', e?.response?.data || e); }

  // メール（Apps Script にて写真を添付）
  const html = `
  <div style="font-family:system-ui,Segoe UI,Helvetica,Arial">
    <h2>外壁塗装 — 最終入力</h2>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
      <tr><th align="left">LINEユーザーID</th><td>${esc(userId)}</td></tr>
      <tr><th align="left">お名前</th><td>${esc(s.contact.name)}</td></tr>
      <tr><th align="left">郵便番号</th><td>${esc(s.contact.postal)}</td></tr>
      <tr><th align="left">住所1</th><td>${esc(s.contact.addr1)}</td></tr>
      <tr><th align="left">住所2</th><td>${esc(s.contact.addr2)}</td></tr>
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
  try { await sendAdminEmail({ htmlBody: html, photoUrls: s.photoUrls }); } catch (e) { console.error('sendAdminEmail', e?.response?.data || e); }

  // 完了メッセージ（友だち追加ボタンは出さない）
  await client.replyMessage(replyToken, [
    { type:'text', text:'ありがとうございます。連絡先を受け付けました。1営業日以内に正式なお見積もりをお送りします。' }
  ]);

  resetSession(userId);
}
