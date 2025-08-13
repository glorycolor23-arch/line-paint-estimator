/**
 * 外壁塗装オンライン相談（質問中の管理者通知はOFF・郵便番号→住所自動入力・写真アップあり）
 *
 * 必要環境変数:
 *  CHANNEL_SECRET
 *  CHANNEL_ACCESS_TOKEN
 *  SUPABASE_URL
 *  SUPABASE_SERVICE_ROLE_KEY       // photosバケットへ保存
 *  GOOGLE_SERVICE_ACCOUNT_EMAIL    // スプレッドシート追記用
 *  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 *  GSHEET_SPREADSHEET_ID
 *  GSHEET_SHEET_NAME               // 例: Sheet1
 *  EMAIL_WEBAPP_URL                // Apps Script WebApp（管理者メール送信用）
 *  EMAIL_TO                        // 例: matsuo@graphity.co.jp
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import axios from 'axios';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────
// LINE 基本
// ─────────────────────────────────────────
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('CHANNEL_* が未設定です');
  process.exit(1);
}
const client = new line.Client(config);
const app = express();
app.use(express.json());

// health
app.get('/health', (_, res) => res.status(200).send('healthy'));

// webhook
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error('webhook error:', e);
    res.status(500).send('Error');
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('listening', PORT));

// ─────────────────────────────────────────
// 外部サービス
// ─────────────────────────────────────────
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

// 管理者メール（最終確定時のみ）
async function sendAdminEmail({ htmlBody, photoUrls = [] }) {
  const endpoint = process.env.EMAIL_WEBAPP_URL;
  const to = process.env.EMAIL_TO;
  if (!endpoint || !to) return;
  await axios.post(endpoint, { to, subject: '【外壁塗装】最終入力', htmlBody, photoUrls }, { timeout: 15000 });
}

// 郵便番号 → 住所（ZipCloud）
async function findAddressByPostal(postal7) {
  try {
    const z = postal7.replace(/[^\d]/g, '');
    if (z.length !== 7) return null;
    const { data } = await axios.get('https://zipcloud.ibsnet.co.jp/api/search', { params: { zipcode: z }, timeout: 8000 });
    if (data?.status !== 200 || !data?.results?.length) return null;
    const r = data.results[0];
    // 例: 東京都 渋谷区 神南
    return `${r.address1}${r.address2}${r.address3}`;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────
// セッション
// ─────────────────────────────────────────
const sessions = new Map(); // userId → state

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 1,
      answers: {},
      expectingPhoto: false,
      photoIndex: -1,      // askNextPhotoで0から始める
      photoUrls: [],
      contact: { name: '', postal: '', addr1: '', addr2: '' },
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, {
    step: 1,
    answers: {},
    expectingPhoto: false,
    photoIndex: -1,
    photoUrls: [],
    contact: { name: '', postal: '', addr1: '', addr2: '' },
  });
}

// ─────────────────────────────────────────
// 素材
// ─────────────────────────────────────────
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
  skip: 'https://cdn-icons-png.flaticon.com/512/1828/1828665.png',
};
const PHOTO_STEPS = [
  { key: 'front',  label: '外観写真：正面' },
  { key: 'right',  label: '外観写真：右側' },
  { key: 'left',   label: '外観写真：左側' },
  { key: 'back',   label: '外観写真：後ろ側' },
  { key: 'damage', label: '損傷箇所（任意）' },
];

// ─────────────────────────────────────────
// メイン
// ─────────────────────────────────────────
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n' +
      '外壁・屋根塗装の【かんたん概算見積り】をトーク上でご案内します。\n' +
      '「見積もり」または「スタート」と送ってください。'
    );
  }

  if (event.type === 'message') {
    const { message } = event;

    // 画像
    if (message.type === 'image') {
      const s = getSession(userId);
      if (!s.expectingPhoto) {
        return replyText(event.replyToken, 'ただいま質問中です。ボタンから続きにお進みください。');
      }
      await saveImageToSupabase(userId, message.id, s); // ここで通知は送らない
      // 次の写真案内
      return askNextPhoto(event.replyToken, userId);
    }

    // テキスト
    if (message.type === 'text') {
      const text = (message.text || '').trim();
      const s = getSession(userId);

      // リセット
      if (/^(最初から|リセット)$/i.test(text)) {
        resetSession(userId);
        return replyText(event.replyToken, '回答をリセットしました。\n「見積もり」または「スタート」と送ってください。');
      }

      // 連絡先入力フェーズ
      if (s.step === 'contact_name') {
        s.contact.name = text;
        s.step = 'contact_postal';
        return replyText(event.replyToken, '郵便番号を入力してください（7桁。ハイフン可）');
      }
      if (s.step === 'contact_postal') {
        const z = text.replace(/[^\d]/g, '').slice(0, 7);
        s.contact.postal = z;
        const found = await findAddressByPostal(z);
        s.contact.addr1 = found || '';
        s.step = 'contact_addr1';
        return replyText(event.replyToken,
          found
            ? `住所候補を見つけました：\n「${found}」\n続き（番地まで）を含めて修正・追記してください。`
            : '住所（都道府県・市区町村・番地など）を入力してください'
        );
      }
      if (s.step === 'contact_addr1') {
        s.contact.addr1 = text;
        s.step = 'contact_addr2';
        return replyText(event.replyToken, '建物名・部屋番号など（あれば）を入力してください。無ければ「なし」と入力');
      }
      if (s.step === 'contact_addr2') {
        s.contact.addr2 = (text === 'なし') ? '' : text;
        return finalize(event.replyToken, userId);
      }

      // スタート
      if (/^(見積もり|スタート|start)$/i.test(text)) {
        resetSession(userId);
        return askQ1(event.replyToken, userId);
      }

      // 写真待ちでのテキスト（スキップ/完了）
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(text)) {
          // 次の写真へ
          return askNextPhoto(event.replyToken, userId, true);
        }
        if (/^(完了|おわり|終了)$/i.test(text)) {
          // 写真終了 → 連絡先へ
          s.expectingPhoto = false;
          return askContactIntro(event.replyToken, userId);
        }
        return replyText(event.replyToken, '画像を送信してください。スキップは「スキップ」、全て終えたら「完了」と送ってください。');
      }

      // その他
      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。');
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

    // Q4 分岐（無い/わからない → Q5スキップ）
    if (q === 4 && (v === 'ない' || v === 'わからない')) {
      s.answers.q5 = '該当なし';
      s.step = 6;
      return askQ6(event.replyToken, userId);
    }

    s.step = q + 1;
    switch (s.step) {
      case 2: return askQ2(event.replyToken, userId);
      case 3: return askQ3(event.replyToken, userId);
      case 4: return askQ4(event.replyToken, userId);
      case 5: return askQ5(event.replyToken, userId);
      case 6: return askQ6(event.replyToken, userId);
      case 7: return askQ7(event.replyToken, userId);
      case 8: return askQ8(event.replyToken, userId);
      case 9: return askQ9(event.replyToken, userId);
      case 10: return askQ10_Begin(event.replyToken, userId);
      case 11: return askContactIntro(event.replyToken, userId);
      default: return askContactIntro(event.replyToken, userId);
    }
  }
}

// ─────────────────────────────────────────
// 質問UI
// ─────────────────────────────────────────
function qr(items) { return { items }; }
function pb(label, data, imageUrl) {
  return { type: 'action', imageUrl, action: { type: 'postback', label, data, displayText: label } };
}

async function askQ1(rt, uid) {
  getSession(uid).step = 1;
  const items = [
    pb('1階建て', qs.stringify({ q:1, v:'1階建て' }), ICONS.floor),
    pb('2階建て', qs.stringify({ q:1, v:'2階建て' }), ICONS.floor),
    pb('3階建て', qs.stringify({ q:1, v:'3階建て' }), ICONS.floor),
  ];
  return client.replyMessage(rt, { type:'text', text:'1/10 階数を選んでください', quickReply: qr(items) });
}
async function askQ2(rt){
  const L=['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  return client.replyMessage(rt,{type:'text',text:'2/10 間取りを選んでください',quickReply:qr(L.map(v=>pb(v,qs.stringify({q:2,v}),ICONS.layout)))});
}
async function askQ3(rt){
  const A=[
    pb('外壁塗装',qs.stringify({q:3,v:'外壁塗装'}),ICONS.paint),
    pb('屋根塗装',qs.stringify({q:3,v:'屋根塗装'}),ICONS.paint),
    pb('外壁＋屋根',qs.stringify({q:3,v:'外壁塗装＋屋根塗装'}),ICONS.paint)
  ];
  return client.replyMessage(rt,{type:'text',text:'3/10 希望する工事内容を選んでください',quickReply:qr(A)});
}
async function askQ4(rt){
  const A=[pb('ある',qs.stringify({q:4,v:'ある'}),ICONS.yes),
           pb('ない',qs.stringify({q:4,v:'ない'}),ICONS.no),
           pb('わからない',qs.stringify({q:4,v:'わからない'}),ICONS.no)];
  return client.replyMessage(rt,{type:'text',text:'4/10 これまで外壁塗装をしたことはありますか？',quickReply:qr(A)});
}
async function askQ5(rt){
  const L=['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  return client.replyMessage(rt,{type:'text',text:'5/10 前回の外壁塗装からどれくらい？',quickReply:qr(L.map(v=>pb(v,qs.stringify({q:5,v}),ICONS.years)))});
}
async function askQ6(rt){
  const L=['モルタル','サイディング','タイル','ALC'];
  return client.replyMessage(rt,{type:'text',text:'6/10 外壁の種類は？',quickReply:qr(L.map(v=>pb(v,qs.stringify({q:6,v}),ICONS.wall)))});
}
async function askQ7(rt){
  const L=['瓦','スレート','ガルバリウム','トタン'];
  return client.replyMessage(rt,{type:'text',text:'7/10 屋根の種類は？',quickReply:qr(L.map(v=>pb(v,qs.stringify({q:7,v}),ICONS.roof)))});
}
async function askQ8(rt){
  const L=['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'];
  return client.replyMessage(rt,{type:'text',text:'8/10 雨漏りの状況は？',quickReply:qr(L.map(v=>pb(v,qs.stringify({q:8,v}),ICONS.leak)))});
}
async function askQ9(rt){
  const L=['30cm以下','50cm以下','70cm以下','70cm以上'];
  return client.replyMessage(rt,{type:'text',text:'9/10 周辺との最短距離（足場の目安）',quickReply:qr(L.map(v=>pb(v,qs.stringify({q:9,v}),ICONS.distance)))});
}

// 写真アップロード開始
async function askQ10_Begin(rt, uid) {
  const s = getSession(uid);
  s.expectingPhoto = true;
  s.photoIndex = -1; // ここから0に上げる
  return askNextPhoto(rt, uid);
}

// 次の写真案内（スキップ時も含む）
async function askNextPhoto(rt, uid, skipped = false) {
  const s = getSession(uid);
  s.photoIndex += 1;
  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    return askContactIntro(rt, uid);
  }
  const cur = PHOTO_STEPS[s.photoIndex];
  const items = [
    { type:'action', imageUrl:ICONS.camera, action:{ type:'camera',     label:'カメラを起動' } },
    { type:'action', imageUrl:ICONS.camera, action:{ type:'cameraRoll', label:'アルバムから' } },
    { type:'action', imageUrl:ICONS.skip,   action:{ type:'message',    label:'スキップ', text:'スキップ' } },
    { type:'action', imageUrl:ICONS.yes,    action:{ type:'message',    label:'完了',     text:'完了' } },
  ];
  return client.replyMessage(rt, {
    type:'text',
    text:`10/10 写真アップロード\n「${cur.label}」を送ってください。\n（送れない場合は「スキップ」、すべて終えたら「完了」と送信できます）`,
    quickReply: { items }
  });
}

// 連絡先入力の導入（名前から）
async function askContactIntro(rt, uid) {
  const a = getSession(uid).answers;
  const estimate = estimateCost(a);
  await client.replyMessage(rt, [
    { type:'text', text: summaryText(a, getSession(uid).photoUrls.length) },
    { type:'text', text:`概算金額：${yen(estimate)}\n\n正式見積もりのため、連絡先をご入力ください。まずは「お名前」からお願いします。` }
  ]);
  getSession(uid).step = 'contact_name';
}

// ─────────────────────────────────────────
// 画像保存（Supabase Storage）
// ─────────────────────────────────────────
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
    upsert: true,
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from('photos').getPublicUrl(filepath);
  const url = pub?.publicUrl;
  if (url) s.photoUrls.push(url);
}

// ─────────────────────────────────────────
// 見積り計算・最終確定
// ─────────────────────────────────────────
function estimateCost(a) {
  const base = { '外壁塗装':700000, '屋根塗装':300000, '外壁塗装＋屋根塗装':900000 };
  const floor = { '1階建て':1.0, '2階建て':1.2, '3階建て':1.4 };
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

async function finalize(rt, uid) {
  const s = getSession(uid);
  const a = s.answers;
  const est = estimateCost(a);
  const now = new Date();

  // スプレッドシートに行追加（最後だけ）
  const row = [
    now.toISOString(), uid,
    s.contact.name, s.contact.postal, s.contact.addr1, s.contact.addr2,
    a.q1||'', a.q2||'', a.q3||'', a.q4||'', a.q5||'',
    a.q6||'', a.q7||'', a.q8||'', a.q9||'',
    s.photoUrls.length, est
  ];
  try { await appendToSheet(row); } catch(e){ console.error('sheet:', e?.response?.data || e); }

  // 管理者メール（最後だけ）
  const html = `
    <div>
      <h3>外壁塗装 — 最終入力</h3>
      <p><b>LINEユーザーID:</b> ${esc(uid)}</p>
      <p><b>お名前:</b> ${esc(s.contact.name)}</p>
      <p><b>郵便番号:</b> ${esc(s.contact.postal)}</p>
      <p><b>住所1:</b> ${esc(s.contact.addr1)}</p>
      <p><b>住所2:</b> ${esc(s.contact.addr2)}</p>
      <pre>${esc(summaryText(a, s.photoUrls.length))}</pre>
      <p><b>概算:</b> ${esc(yen(est))}</p>
      ${s.photoUrls?.length ? `<ol>${s.photoUrls.map(u=>`<li><a href="${u}">${u}</a></li>`).join('')}</ol>`:''}
    </div>`;
  try { await sendAdminEmail({ htmlBody: html, photoUrls: s.photoUrls }); } catch(e){ console.error('mail:', e?.response?.data || e); }

  // ユーザーへ完了
  await client.replyMessage(rt, [
    { type:'text', text:'ありがとうございます。内容を受け付けました。1営業日以内に担当者がこのLINEでご連絡します。' }
  ]);

  resetSession(uid);
}

function esc(s){ return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function replyText(rt, text){ return client.replyMessage(rt, { type:'text', text }); }
