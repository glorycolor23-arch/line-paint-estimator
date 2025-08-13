// server.js  — LINE 外壁塗装 見積もりBot（LIFF連携、写真保存、GSheet/メールは確定時のみ）
// 1行目から最終行まで、コピペで差し替え可。

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import axios from 'axios';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

/* ─────────────────────────────────────────────
 * 必須環境変数
 * CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * GSHEET_SPREADSHEET_ID / GSHEET_SHEET_NAME
 * GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 * EMAIL_TO / EMAIL_WEBAPP_URL
 * FRIEND_ADD_URL（任意）
 * ───────────────────────────────────────────── */

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

// for raw body signature validate (line.middleware)
app.post('/webhook', express.raw({ type: '*/*' }), line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).send('Error');
  }
});

// JSON body for other endpoints
app.use(express.json());

// Health
app.get('/health', (_, res) => res.status(200).send('ok'));

/* ─────────────────────────────────────────────
 * 静的配信（LIFFフロント）
 * ───────────────────────────────────────────── */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/liff', express.static(path.join(__dirname, 'liff')));

/* ─────────────────────────────────────────────
 * 外部サービス（Supabase / Google Sheets / Email）
 * ───────────────────────────────────────────── */
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

// Apps Script WebApp: メール送信（本文＋写真URL）
async function sendAdminEmail({ htmlBody, photoUrls = [] }) {
  const endpoint = process.env.EMAIL_WEBAPP_URL;
  const to = process.env.EMAIL_TO;
  if (!endpoint || !to) return;
  await axios.post(endpoint, { to, subject: '【外壁塗装】最終入力（概算＋回答＋写真）', htmlBody, photoUrls }, { timeout: 15000 });
}

/* ─────────────────────────────────────────────
 * セッション（メモリ）
 * ───────────────────────────────────────────── */
const sessions = new Map(); // userId → session

function blankSession() {
  return {
    step: 1,
    answers: {},
    expectingPhoto: false,
    photoIndex: 0,
    photoUrls: [],
    contact: { name: '', postal: '', addr1: '', addr2: '' }
  };
}
function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, blankSession());
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, blankSession());
}

/* ─────────────────────────────────────────────
 * UI 素材
 * ───────────────────────────────────────────── */
const FRIEND_ADD_URL = process.env.FRIEND_ADD_URL || 'https://line.me/R/ti/p/@004szogc';

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
};

const PHOTO_STEPS = [
  { key: 'front',  label: '外観写真：正面' },
  { key: 'right',  label: '外観写真：右側' },
  { key: 'left',   label: '外観写真：左側' },
  { key: 'back',   label: '外観写真：後ろ側' },
  { key: 'damage', label: '損傷箇所（任意）' },
];

/* ─────────────────────────────────────────────
 * イベントハンドラ
 * ───────────────────────────────────────────── */
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    resetSession(userId);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '友だち追加ありがとうございます！\n「見積もり」または「スタート」と送ってください。'
    });
  }

  if (event.type === 'message') {
    const msg = event.message;

    // 画像
    if (msg.type === 'image') {
      const s = getSession(userId);
      if (!s.expectingPhoto) {
        return replyText(event.replyToken, 'ありがとうございます。いま質問中です。ボタンから続きにお進みください。');
      }
      // いま要求している写真のインデックスを固定して保存タスクへ
      const idxForSave = s.photoIndex;
      const keyForSave = PHOTO_STEPS[idxForSave]?.key || `photo${idxForSave}`;
      saveImageToSupabase(userId, msg.id, keyForSave, s).catch(e => console.error('saveImage:', e));

      // 返信は即時に「次へ」
      return askNextPhoto(event.replyToken, userId);
    }

    // テキスト
    if (msg.type === 'text') {
      const text = (msg.text || '').trim();

      // 強制リセット
      if (/^(最初から|リセット)$/i.test(text)) {
        resetSession(userId);
        return replyText(event.replyToken, '回答をリセットしました。\n「見積もり」または「スタート」と送ってください。');
      }

      // 連絡先入力フロー
      const s = getSession(userId);
      if (s.step === 'contact_name') {
        s.contact.name = text;
        s.step = 'contact_postal';
        return replyText(event.replyToken, '郵便番号を入力してください（ハイフンなし7桁OK）\n※お住まいの区画確認のため。現地調査や営業訪問は致しません。');
      }
      if (s.step === 'contact_postal') {
        s.contact.postal = text.replace(/[^\d]/g, '');
        s.step = 'contact_addr1';
        return replyText(event.replyToken, '住所（都道府県・市区町村・番地など）を入力してください\n※お住まいの区画確認のため。現地調査や営業訪問は致しません。');
      }
      if (s.step === 'contact_addr1') {
        s.contact.addr1 = text;
        s.step = 'contact_addr2';
        return replyText(event.replyToken, '番地など以降の住所や建物名・部屋番号などを入力してください。無ければ「なし」を入力してください。');
      }
      if (s.step === 'contact_addr2') {
        s.contact.addr2 = (text === 'なし') ? '' : text;
        return finalizeAndNotify(event.replyToken, userId);
      }

      // 写真待受け中の補助文言
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(text)) {
          return askNextPhoto(event.replyToken, userId, true);
        }
        if (/^(完了|おわり|終了)$/i.test(text)) {
          // 次は強制的に連絡先へ
          s.photoIndex = PHOTO_STEPS.length;
          s.expectingPhoto = false;
          return askContact(event.replyToken, userId);
        }
        return replyText(event.replyToken, '画像を送信してください。スキップは「スキップ」、すべて終えたら「完了」と送ってください。');
      }

      // スタート
      if (/^(見積もり|スタート|start)$/i.test(text)) {
        resetSession(userId);
        return askQ1(event.replyToken, userId);
      }

      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。');
    }
    return;
  }

  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data || '');
    const q = Number(data.q);
    const v = data.v;
    const s = getSession(event.source.userId);
    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    s.answers[`q${q}`] = v;

    // Q4=「ない」「わからない」はQ5スキップ
    if (q === 4) {
      if (v === 'ない' || v === 'わからない') {
        s.answers.q5 = '該当なし';
        s.step = 6;
        return askQ6(event.replyToken, event.source.userId);
      }
    }

    s.step = q + 1;
    switch (s.step) {
      case 2: return askQ2(event.replyToken, event.source.userId);
      case 3: return askQ3(event.replyToken, event.source.userId);
      case 4: return askQ4(event.replyToken, event.source.userId);
      case 5: return askQ5(event.replyToken, event.source.userId);
      case 6: return askQ6(event.replyToken, event.source.userId);
      case 7: return askQ7(event.replyToken, event.source.userId);
      case 8: return askQ8(event.replyToken, event.source.userId);
      case 9: return askQ9(event.replyToken, event.source.userId);
      case 10: return askQ10_Begin(event.replyToken, event.source.userId);
      case 11: return askContact(event.replyToken, event.source.userId);
      default: return askContact(event.replyToken, event.source.userId);
    }
  }
}

/* ─────────────────────────────────────────────
 * 質問UI（画像アイコン付きクイックリプライ固定）
 * ───────────────────────────────────────────── */
const qr = (items) => ({ items });
const pb = (label, data, imageUrl) =>
  ({ type: 'action', imageUrl, action: { type: 'postback', label, data, displayText: label } });

async function askQ1(rt, userId) {
  const s = getSession(userId); s.step = 1;
  const items = [
    pb('1階建て', qs.stringify({ q: 1, v: '1階建て' }), ICONS.floor),
    pb('2階建て', qs.stringify({ q: 1, v: '2階建て' }), ICONS.floor),
    pb('3階建て', qs.stringify({ q: 1, v: '3階建て' }), ICONS.floor),
  ];
  return client.replyMessage(rt, { type: 'text', text: '1/10 階数を選んでください', quickReply: qr(items) });
}
async function askQ2(rt){
  const L = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  return client.replyMessage(rt,{ type:'text', text:'2/10 間取りを選んでください',
    quickReply: qr(L.map(v=>pb(v, qs.stringify({q:2,v}), ICONS.layout)))});
}
async function askQ3(rt){
  const items = [
    pb('外壁塗装', qs.stringify({q:3,v:'外壁塗装'}), ICONS.paint),
    pb('屋根塗装', qs.stringify({q:3,v:'屋根塗装'}), ICONS.paint),
    pb('外壁塗装＋屋根塗装', qs.stringify({q:3,v:'外壁塗装＋屋根塗装'}), ICONS.paint),
  ];
  return client.replyMessage(rt,{ type:'text', text:'3/10 希望する工事内容を選んでください', quickReply: qr(items)});
}
async function askQ4(rt){
  const items = [
    pb('ある', qs.stringify({q:4,v:'ある'}), ICONS.yes),
    pb('ない', qs.stringify({q:4,v:'ない'}), ICONS.no),
    pb('わからない', qs.stringify({q:4,v:'わからない'}), ICONS.no),
  ];
  return client.replyMessage(rt,{ type:'text', text:'4/10 これまで外壁塗装をしたことはありますか？', quickReply: qr(items)});
}
async function askQ5(rt){
  const L=['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  return client.replyMessage(rt,{ type:'text', text:'5/10 前回の外壁塗装からどれくらい？',
    quickReply: qr(L.map(v=>pb(v, qs.stringify({q:5,v}), ICONS.years)))});
}
async function askQ6(rt){
  const L=['モルタル','サイディング','タイル','ALC'];
  return client.replyMessage(rt,{ type:'text', text:'6/10 外壁の種類は？',
    quickReply: qr(L.map(v=>pb(v, qs.stringify({q:6,v}), ICONS.wall)))});
}
async function askQ7(rt){
  const L=['瓦','スレート','ガルバリウム','トタン'];
  return client.replyMessage(rt,{ type:'text', text:'7/10 屋根の種類は？',
    quickReply: qr(L.map(v=>pb(v, qs.stringify({q:7,v}), ICONS.roof)))});
}
async function askQ8(rt){
  const L=['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'];
  return client.replyMessage(rt,{ type:'text', text:'8/10 雨漏りの状況は？',
    quickReply: qr(L.map(v=>pb(v, qs.stringify({q:8,v}), ICONS.leak)))});
}
async function askQ9(rt){
  const L=['30cm以下','50cm以下','70cm以下','70cm以上'];
  return client.replyMessage(rt,{ type:'text', text:'9/10 周辺との最短距離（足場の目安）',
    quickReply: qr(L.map(v=>pb(v, qs.stringify({q:9,v}), ICONS.distance)))});
}

async function askQ10_Begin(rt, userId) {
  const s = getSession(userId);
  s.expectingPhoto = true;
  s.photoIndex = 0;
  return askNextPhoto(rt, userId, false, true);
}

async function askNextPhoto(rt, userId, _skipped=false, first=false) {
  const s = getSession(userId);
  if (!first) s.photoIndex += 1;

  // すべて終わったら連絡先へ
  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    try {
      return await askContact(rt, userId);
    } catch (e) {
      // 返信トークン失効などの異常時は push にフォールバック
      console.warn('askContact reply failed. try push:', e?.message || e);
      return client.pushMessage(userId, await buildContactMessages(userId));
    }
  }

  const cur = PHOTO_STEPS[s.photoIndex];
  const items = [
    { type:'action', imageUrl: ICONS.camera, action:{ type:'camera',      label:'カメラを起動' } },
    { type:'action', imageUrl: ICONS.camera, action:{ type:'cameraRoll',  label:'アルバムから選択' } },
    { type:'action', imageUrl: ICONS.no,     action:{ type:'message',     label:'スキップ', text:'スキップ' } },
    { type:'action', imageUrl: ICONS.yes,    action:{ type:'message',     label:'完了',     text:'完了' } },
  ];
  return client.replyMessage(rt, {
    type:'text',
    text:`10/10 写真アップロード\n「${cur.label}」を送ってください。`,
    quickReply: { items }
  });
}

/* ─────────────────────────────────────────────
 * 画像保存（非同期で実施／返信は先に返す）
 * ───────────────────────────────────────────── */
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}
async function saveImageToSupabase(userId, messageId, key, sessionRef) {
  try {
    const stream = await client.getMessageContent(messageId);
    const buf = await streamToBuffer(stream);
    const filename = `${key}_${Date.now()}.jpg`;
    const filepath = `line/${userId}/${filename}`;

    const { error } = await supabase.storage.from('photos')
      .upload(filepath, buf, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;

    const { data: pub } = supabase.storage.from('photos').getPublicUrl(filepath);
    const publicUrl = pub?.publicUrl;
    if (publicUrl) sessionRef.photoUrls.push(publicUrl);
  } catch (e) {
    console.error('Supabase upload failed:', e);
  }
}

/* ─────────────────────────────────────────────
 * 連絡先入力・概算
 * ───────────────────────────────────────────── */
function estimateCost(a) {
  const base = { '外壁塗装':700000,'屋根塗装':300000,'外壁塗装＋屋根塗装':900000 };
  const floor={'1階建て':1.0,'2階建て':1.2,'3階建て':1.4};
  const layout={'1DK':0.9,'1LDK':0.95,'2DK':1.0,'2LDK':1.05,'3DK':1.1,'3LDK':1.15,'4DK':1.2,'4LDK':1.25,'5DK':1.3,'5LDK':1.35};
  const wall={'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1};
  const roof={'瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95};
  const leak={'雨の日に水滴が落ちる':1.15,'天井にシミがある':1.1,'雨漏りはない':1.0};
  const dist={'30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.1,'70cm以上':1.0};
  const years={'1〜5年':0.95,'5〜10年':1.0,'10〜15年':1.05,'15〜20年':1.1,'20〜30年':1.15,'30〜40年':1.2,'40年以上':1.25,'0年（新築）':0.9};

  let cost = base[a.q3] || 600000;
  cost *= floor[a.q1] || 1.0;
  cost *= layout[a.q2] || 1.0;
  if (a.q3 !== '屋根塗装') cost *= wall[a.q6] || 1.0; // 外壁系のみ
  if (a.q3 !== '外壁塗装') cost *= roof[a.q7] || 1.0; // 屋根系のみ
  cost *= leak[a.q8] || 1.0;
  cost *= dist[a.q9] || 1.0;
  if (a.q4 === 'ある') cost *= years[a.q5] || 1.0;

  return Math.round(cost / 1000) * 1000;
}
const yen = (n) => n.toLocaleString('ja-JP', { style:'currency', currency:'JPY', maximumFractionDigits:0 });

function summaryText(a, count){
  return [
    '【回答の確認】',
    `・階数: ${a.q1||'-'} / 間取り: ${a.q2||'-'} / 工事: ${a.q3||'-'}`,
    `・過去塗装: ${a.q4||'-'} / 前回から: ${a.q5||'該当なし'}`,
    `・外壁: ${a.q6||'-'} / 屋根: ${a.q7||'-'} / 雨漏り: ${a.q8||'-'}`,
    `・最短距離: ${a.q9||'-'} / 受領写真: ${count}枚`
  ].join('\n');
}

async function buildContactMessages(userId){
  const s = getSession(userId);
  const est = estimateCost(s.answers);
  return [
    { type:'text', text: summaryText(s.answers, s.photoUrls.length) },
    {
      type:'flex', altText:'詳しい見積もりをご希望の方へ',
      contents:{
        type:'bubble',
        body:{ type:'box', layout:'vertical', spacing:'md', contents:[
          { type:'text', text:'見積り金額', size:'sm', color:'#888888' },
          { type:'text', text: yen(est), weight:'bold', size:'xl' },
          { type:'text', text:'上記はご入力内容を元に算出した概算金額です。', wrap:true, size:'sm', color:'#666666' },
          { type:'separator', margin:'md' },
          { type:'text', text:'正式なお見積りが必要な方は続けてご入力をお願いします。', wrap:true },
        ]},
        footer:{ type:'box', layout:'vertical', contents:[
          { type:'button', style:'primary', action:{ type:'message', label:'現地調査なしで見積を依頼', text:'詳しい見積もりを依頼する' } }
        ]}
      }
    },
    { type:'text', text:'詳しい見積もりを依頼する を押して、お名前・住所をご入力ください。' }
  ];
}

async function askContact(rt, userId) {
  const s = getSession(userId);
  const msgs = await buildContactMessages(userId);
  await client.replyMessage(rt, msgs);
  s.step = 'contact_name';
}

// 完了：スプレッドシート + メール + お礼
async function finalizeAndNotify(replyToken, userId) {
  const s = getSession(userId);
  const a = s.answers;
  const est = estimateCost(a);
  const now = new Date();

  const row = [
    now.toISOString(), userId,
    s.contact.name, s.contact.postal, s.contact.addr1, s.contact.addr2,
    a.q1||'',a.q2||'',a.q3||'',a.q4||'',a.q5||'',a.q6||'',a.q7||'',a.q8||'',a.q9||'',
    s.photoUrls.length, est
  ];
  try { await appendToSheet(row); } catch(e){ console.error('appendToSheet:', e?.response?.data || e); }

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
    ${s.photoUrls.length ? `<p>写真リンク：</p><ol>${s.photoUrls.map(u=>`<li><a href="${u}">${u}</a></li>`).join('')}</ol>` : ''}
  </div>`;
  try { await sendAdminEmail({ htmlBody: html, photoUrls: s.photoUrls }); } catch(e){ console.error('sendAdminEmail:', e?.response?.data || e); }

  await client.replyMessage(replyToken, [
    { type:'text', text:'お見積りのご依頼ありがとうございます。送信された内容を確認し、1〜2営業日程度で詳細なお見積りをLINEでご返信致します。' }
  ]);

  resetSession(userId);
}

/* ─────────────────────────────────────────────
 * ユーティリティ
 * ───────────────────────────────────────────── */
function esc(s){ return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function replyText(rt, text){ return client.replyMessage(rt, { type:'text', text }); }

/* ─────────────────────────────────────────────
 * 起動
 * ───────────────────────────────────────────── */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('listening on', PORT));
