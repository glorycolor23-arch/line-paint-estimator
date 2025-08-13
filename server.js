// server.js — LINE 見積もりBot + LIFF
// -------------------------------------------------
import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import qs from 'qs';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ---- path ユーティリティ（静的配信用）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- LINE Bot 設定
const lineConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
if (!lineConfig.channelAccessToken || !lineConfig.channelSecret) {
  console.error('ENV: CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET が未設定です');
  process.exit(1);
}
const lineClient = new line.Client(lineConfig);

// ---- 外部サービス
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---- アプリ本体
const app = express();

// ヘルスチェック
app.get('/health', (_, res) => res.status(200).send('ok'));

// ---------------------- 重要：/webhook は最初に宣言 ----------------------
// ここでは絶対に express.json() を使わないこと！
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body?.events || [];
    await Promise.all(events.map(handleEvent));
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook handler error:', err);
    // 200 を返さないと検証が失敗するため、ログだけ残して 200 を返す
    return res.status(200).send('OK');
  }
});
// ------------------------------------------------------------------------

// 静的ファイル（LIFF）
app.use('/liff', express.static(path.join(__dirname, 'liff')));

// LIFF 用の公開環境変数を JS として配布
app.get('/liff/env.js', (req, res) => {
  const payload = {
    LIFF_ID: process.env.LIFF_ID || '',
    SHEET_NAME: process.env.GSHEET_SHEET_NAME || 'Entries'
  };
  res.type('application/javascript').send(`window.__LIFF_ENV__=${JSON.stringify(payload)};`);
});

// ここから下だけ JSON パーサを使う（webhook には影響させない）
const jsonOnly = express.json();

// 郵便番号 → 住所（zipcloud）
app.get('/api/zip2addr', async (req, res) => {
  try {
    const zip = String(req.query.zip || '').replace(/[^\d]/g, '');
    if (!zip) return res.status(400).json({ ok: false, error: 'zip required' });
    const { data } = await axios.get(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`, { timeout: 8000 });
    return res.json({ ok: true, data });
  } catch (e) {
    console.error('zip2addr error:', e?.response?.data || e.message);
    return res.json({ ok: false });
  }
});

// LIFF 送信（概算・回答・写真・連絡先）を受け取り、Sheetとメールに転送
app.post('/api/liff/submit', jsonOnly, async (req, res) => {
  try {
    const payload = req.body || {};
    await appendToSheet(buildSheetRow(payload));
    await sendAdminEmail(buildMail(payload));
    return res.json({ ok: true });
  } catch (e) {
    console.error('/api/liff/submit error:', e?.response?.data || e);
    return res.status(200).json({ ok: false });
  }
});

// ----------------- ここから下は Bot ロジック（省略せず記載） -----------------
const sessions = new Map(); // userId -> session

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 0,
      answers: {},
      expectingPhoto: false,
      photoIndex: 0,
      photoUrls: [],
      contact: { name: '', postal: '', addr1: '', addr2: '' },
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.delete(userId);
  getSession(userId);
}

const PHOTO_STEPS = [
  { key: 'front', label: '外観写真：正面' },
  { key: 'right', label: '外観写真：右側' },
  { key: 'left', label: '外観写真：左側' },
  { key: 'back', label: '外観写真：後ろ側' },
  { key: 'damage', label: '損傷箇所（任意）' },
];

// 受信イベント
async function handleEvent(event) {
  const userId = event?.source?.userId;
  if (!userId) return;

  // 友だち追加
  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n「見積もり」または「スタート」と送ると概算見積りを開始します。'
    );
  }

  // テキスト
  if (event.type === 'message' && event.message.type === 'text') {
    const text = (event.message.text || '').trim();

    if (/^(リセット|最初から)$/i.test(text)) {
      resetSession(userId);
      return replyText(event.replyToken, '回答をリセットしました。\n「見積もり」または「スタート」と送ってください。');
    }

    // 質問開始トリガー
    if (/^(見積もり|スタート|start)$/i.test(text)) {
      resetSession(userId);
      return askQ1(event.replyToken, userId);
    }

    // 連絡先入力フロー
    const s = getSession(userId);
    if (s.step === 'contact_name') {
      s.contact.name = text;
      s.step = 'contact_postal';
      return replyText(event.replyToken, '郵便番号を入力してください（7桁・ハイフン可）');
    }
    if (s.step === 'contact_postal') {
      s.contact.postal = text.replace(/[^\d]/g, '');
      s.step = 'contact_addr1';
      return replyText(event.replyToken, '住所（都道府県・市区町村・番地など）を入力してください');
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

    // 写真待ち中のテキスト
    if (s.expectingPhoto) {
      if (/^(スキップ)$/i.test(text)) {
        return askNextPhoto(event.replyToken, userId, true);
      }
      if (/^(完了|終了)$/i.test(text)) {
        s.photoIndex = PHOTO_STEPS.length;
        s.expectingPhoto = false;
        return askContact(event.replyToken, userId);
      }
      return replyText(event.replyToken, '画像を送ってください。スキップは「スキップ」、終了は「完了」。');
    }

    // デフォルト
    return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。');
  }

  // 画像
  if (event.type === 'message' && event.message.type === 'image') {
    const s = getSession(userId);
    if (!s.expectingPhoto) return;
    // 画像保存は fire-and-forget
    saveImageToSupabase(userId, event.message.id, s).catch(e => console.error('saveImage error:', e));
    return askNextPhoto(event.replyToken, userId, false);
  }

  // ポストバック
  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data || '');
    const q = Number(data.q);
    const v = data.v;
    const s = getSession(userId);

    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    s.answers[`q${q}`] = v;

    // Q4 が「ない／わからない」なら Q5 をスキップ
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
      case 11: return askContact(event.replyToken, userId);
      default: return askContact(event.replyToken, userId);
    }
  }
}

// ---------------- 質問UI（ボタンは画像付きクイックリプライ） ----------------
function quick(items){ return { items }; }
function pb(label, data, imageUrl){
  return { type: 'action', imageUrl, action: { type: 'postback', label, data, displayText: label } };
}
const ICONS = {
  floor:'https://cdn-icons-png.flaticon.com/512/8911/8911331.png',
  layout:'https://cdn-icons-png.flaticon.com/512/9193/9193091.png',
  paint:'https://cdn-icons-png.flaticon.com/512/992/992703.png',
  yes:'https://cdn-icons-png.flaticon.com/512/5610/5610944.png',
  no:'https://cdn-icons-png.flaticon.com/512/5610/5610944.png',
  years:'https://cdn-icons-png.flaticon.com/512/1827/1827370.png',
  wall:'https://cdn-icons-png.flaticon.com/512/2992/2992653.png',
  roof:'https://cdn-icons-png.flaticon.com/512/2933/2933922.png',
  leak:'https://cdn-icons-png.flaticon.com/512/415/415734.png',
  distance:'https://cdn-icons-png.flaticon.com/512/535/535285.png',
  camera:'https://cdn-icons-png.flaticon.com/512/685/685655.png',
};

async function askQ1(rt, userId){
  const s = getSession(userId); s.step = 1;
  const items = [
    pb('1階建て', qs.stringify({q:1,v:'1階建て'}), ICONS.floor),
    pb('2階建て', qs.stringify({q:1,v:'2階建て'}), ICONS.floor),
    pb('3階建て', qs.stringify({q:1,v:'3階建て'}), ICONS.floor),
  ];
  return lineClient.replyMessage(rt, { type:'text', text:'1/10 階数を選んでください', quickReply:quick(items) });
}
async function askQ2(rt){
  const L=['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  return lineClient.replyMessage(rt,{type:'text',text:'2/10 間取りを選んでください',quickReply:quick(L.map(v=>pb(v,qs.stringify({q:2,v}),ICONS.layout)))});
}
async function askQ3(rt){
  const A=[pb('外壁塗装',qs.stringify({q:3,v:'外壁塗装'}),ICONS.paint),
           pb('屋根塗装',qs.stringify({q:3,v:'屋根塗装'}),ICONS.paint),
           pb('外壁塗装＋屋根塗装',qs.stringify({q:3,v:'外壁塗装＋屋根塗装'}),ICONS.paint)];
  return lineClient.replyMessage(rt,{type:'text',text:'3/10 希望する工事内容を選んでください',quickReply:quick(A)});
}
async function askQ4(rt){
  const A=[pb('ある',qs.stringify({q:4,v:'ある'}),ICONS.yes),
           pb('ない',qs.stringify({q:4,v:'ない'}),ICONS.no),
           pb('わからない',qs.stringify({q:4,v:'わからない'}),ICONS.no)];
  return lineClient.replyMessage(rt,{type:'text',text:'4/10 これまで外壁塗装をしたことはありますか？',quickReply:quick(A)});
}
async function askQ5(rt){
  const L=['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  return lineClient.replyMessage(rt,{type:'text',text:'5/10 前回の外壁塗装からどれくらい？',quickReply:quick(L.map(v=>pb(v,qs.stringify({q:5,v}),ICONS.years)))});
}
async function askQ6(rt){
  const L=['モルタル','サイディング','タイル','ALC'];
  return lineClient.replyMessage(rt,{type:'text',text:'6/10 外壁の種類は？',quickReply:quick(L.map(v=>pb(v,qs.stringify({q:6,v}),ICONS.wall)))});
}
async function askQ7(rt){
  const L=['瓦','スレート','ガルバリウム','トタン'];
  return lineClient.replyMessage(rt,{type:'text',text:'7/10 屋根の種類は？',quickReply:quick(L.map(v=>pb(v,qs.stringify({q:7,v}),ICONS.roof)))});
}
async function askQ8(rt){
  const L=['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'];
  return lineClient.replyMessage(rt,{type:'text',text:'8/10 雨漏りの状況は？',quickReply:quick(L.map(v=>pb(v,qs.stringify({q:8,v}),ICONS.leak)))});
}
async function askQ9(rt){
  const L=['30cm以下','50cm以下','70cm以下','70cm以上'];
  return lineClient.replyMessage(rt,{type:'text',text:'9/10 周辺との最短距離（足場の目安）',quickReply:quick(L.map(v=>pb(v,qs.stringify({q:9,v}),ICONS.distance)))});
}
async function askQ10_Begin(rt, userId){
  const s = getSession(userId);
  s.expectingPhoto = true; s.photoIndex = -1;
  return askNextPhoto(rt, userId, false);
}
async function askNextPhoto(rt, userId, skipped){
  const s = getSession(userId);
  s.photoIndex += 1;
  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    return askContact(rt, userId);
  }
  const cur = PHOTO_STEPS[s.photoIndex];
  const items = [
    { type:'action', imageUrl:ICONS.camera, action:{ type:'camera', label:'カメラを起動' } },
    { type:'action', imageUrl:ICONS.camera, action:{ type:'cameraRoll', label:'アルバムから選択' } },
    { type:'action', imageUrl:ICONS.no, action:{ type:'message', label:'スキップ', text:'スキップ' } },
    { type:'action', imageUrl:ICONS.yes, action:{ type:'message', label:'完了', text:'完了' } },
  ];
  return lineClient.replyMessage(rt, { type:'text', text:`10/10 写真アップロード\n「${cur.label}」を送ってください。`, quickReply:{ items } });
}

async function askContact(rt, userId){
  const s = getSession(userId);
  s.step = 'contact_name';
  const a = s.answers;
  const estimate = estimateCost(a);
  const flex = {
    type:'flex', altText:'詳しい見積もり',
    contents:{
      type:'bubble',
      body:{ type:'box', layout:'vertical', spacing:'md', contents:[
        { type:'text', text:'見積り金額', size:'sm', color:'#777' },
        { type:'text', text:`${yen(estimate)}`, weight:'bold', size:'xl' },
        { type:'text', text:'上記はご入力内容を元に算出した概算金額です。', wrap:true, size:'sm', color:'#777' },
        { type:'separator', margin:'md' },
        { type:'text', text:'正式なお見積りが必要な方は続けてご入力ください。', wrap:true },
      ]},
      footer:{ type:'box', layout:'vertical', contents:[
        { type:'button', style:'primary', action:{ type:'message', label:'現地調査なしで見積を依頼', text:'詳しい見積もりを依頼する' } }
      ]}
    }
  };
  return lineClient.replyMessage(rt, [
    { type:'text', text: summaryText(a, s.photoUrls.length) },
    flex,
    { type:'text', text:'お名前を入力してください' }
  ]);
}

// 画像保存（Supabase Storage）
async function streamToBuffer(stream){
  return new Promise((resolve,reject)=>{
    const chunks=[]; stream.on('data',c=>chunks.push(c));
    stream.on('end',()=>resolve(Buffer.concat(chunks)));
    stream.on('error',reject);
  });
}
async function saveImageToSupabase(userId, messageId, s){
  const stream = await lineClient.getMessageContent(messageId);
  const buf = await streamToBuffer(stream);
  const key = `${PHOTO_STEPS[s.photoIndex]?.key || 'photo'}_${Date.now()}.jpg`;
  const pathKey = `line/${userId}/${key}`;
  const { error } = await supabase.storage.from('photos').upload(pathKey, buf, { contentType:'image/jpeg', upsert:true });
  if (error) throw error;
  const { data } = supabase.storage.from('photos').getPublicUrl(pathKey);
  if (data?.publicUrl) s.photoUrls.push(data.publicUrl);
}

// 概算計算
function estimateCost(a){
  const base = { '外壁塗装':700000, '屋根塗装':300000, '外壁塗装＋屋根塗装':900000 };
  const floor = { '1階建て':1.0, '2階建て':1.2, '3階建て':1.4 };
  const layout = { '1DK':0.9,'1LDK':0.95,'2DK':1.0,'2LDK':1.05,'3DK':1.1,'3LDK':1.15,'4DK':1.2,'4LDK':1.25,'5DK':1.3,'5LDK':1.35 };
  const wall = { 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof = { '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak = { '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.1,'雨漏りはない':1.0 };
  const dist = { '30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.1,'70cm以上':1.0 };
  const years = { '1〜5年':0.95,'5〜10年':1.0,'10〜15年':1.05,'15〜20年':1.1,'20〜30年':1.15,'30〜40年':1.2,'40年以上':1.25,'0年（新築）':0.9 };
  let cost = base[a.q3] || 600000;
  cost *= floor[a.q1] || 1;
  cost *= layout[a.q2] || 1;
  if (a.q3 !== '屋根塗装') cost *= wall[a.q6] || 1;            // 外壁工事が含まれるとき
  if (a.q3 !== '外壁塗装') cost *= roof[a.q7] || 1;            // 屋根工事が含まれるとき
  cost *= leak[a.q8] || 1;
  cost *= dist[a.q9] || 1;
  if (a.q4 === 'ある') cost *= years[a.q5] || 1;
  return Math.round(cost / 1000) * 1000;
}
function yen(n){ return n.toLocaleString('ja-JP',{ style:'currency', currency:'JPY', maximumFractionDigits:0 }); }
function summaryText(a, count){
  return [
    '【回答の確認】',
    `・階数: ${a.q1||'-'} / 間取り: ${a.q2||'-'} / 工事: ${a.q3||'-'}`,
    `・過去塗装: ${a.q4||'-'} / 前回から: ${a.q5||'該当なし'}`,
    `・外壁: ${a.q6||'-'} / 屋根: ${a.q7||'-'} / 雨漏り: ${a.q8||'-'}`,
    `・最短距離: ${a.q9||'-'} / 写真: ${count}枚`
  ].join('\n');
}
function replyText(rt, text){ return lineClient.replyMessage(rt, { type:'text', text }); }

// ---- スプレッドシート
async function appendToSheet(row){
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
    range: `${process.env.GSHEET_SHEET_NAME || 'Entries'}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
}
function buildSheetRow(p){
  const a = p.answers || {};
  const c = p.contact || {};
  const now = new Date();
  return [
    now.toISOString(),
    p.userId || '',
    c.name || '',
    c.postal || '',
    c.addr1 || '',
    c.addr2 || '',
    a.q1||'', a.q2||'', a.q3||'', a.q4||'', a.q5||'',
    a.q6||'', a.q7||'', a.q8||'', a.q9||'',
    (p.photos || []).length || 0,
    p.estimate || ''
  ];
}

// ---- 管理者メール（Apps Script WebApp）
async function sendAdminEmail({ htmlBody, photoUrls=[] }){
  const endpoint = process.env.EMAIL_WEBAPP_URL;
  const to = process.env.EMAIL_TO;
  if (!endpoint || !to) return;
  await axios.post(endpoint, { to, subject:'【外壁塗装】最終入力', htmlBody, photoUrls }, { timeout: 15000 });
}
function buildMail(p){
  const a = p.answers || {};
  const c = p.contact || {};
  const now = new Date();
  const est = p.estimate || estimateCost(a);
  const esc = s => String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m]));
  const list = (p.photos||[]).map(u=>`<li><a href="${u}">${u}</a></li>`).join('');
  return {
    htmlBody: `
      <div style="font-family:system-ui,Segoe UI,Helvetica,Arial">
        <h2>外壁塗装 — 最終入力</h2>
        <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
          <tr><th align="left">LINEユーザーID</th><td>${esc(p.userId||'')}</td></tr>
          <tr><th align="left">お名前</th><td>${esc(c.name)}</td></tr>
          <tr><th align="left">郵便番号</th><td>${esc(c.postal)}</td></tr>
          <tr><th align="left">住所1</th><td>${esc(c.addr1)}</td></tr>
          <tr><th align="left">住所2</th><td>${esc(c.addr2)}</td></tr>
          <tr><th align="left">階数</th><td>${esc(a.q1||'')}</td></tr>
          <tr><th align="left">間取り</th><td>${esc(a.q2||'')}</td></tr>
          <tr><th align="left">工事内容</th><td>${esc(a.q3||'')}</td></tr>
          <tr><th align="left">過去塗装</th><td>${esc(a.q4||'')}</td></tr>
          <tr><th align="left">前回から</th><td>${esc(a.q5||'')}</td></tr>
          <tr><th align="left">外壁</th><td>${esc(a.q6||'')}</td></tr>
          <tr><th align="left">屋根</th><td>${esc(a.q7||'')}</td></tr>
          <tr><th align="left">雨漏り</th><td>${esc(a.q8||'')}</td></tr>
          <tr><th align="left">距離</th><td>${esc(a.q9||'')}</td></tr>
          <tr><th align="left">受領写真</th><td>${(p.photos||[]).length}枚</td></tr>
          <tr><th align="left">概算金額</th><td>${esc(yen(est))}</td></tr>
          <tr><th align="left">タイムスタンプ</th><td>${now.toLocaleString('ja-JP')}</td></tr>
        </table>
        ${list ? `<p>写真リンク：</p><ol>${list}</ol>` : ''}
      </div>`
    ,
    photoUrls: p.photos || []
  };
}

// ---- ポート
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`listening on ${PORT}`));

// ---- グローバルエラーハンドラ（最後に）
app.use((err, req, res, next) => {
  console.error('UNCAUGHT:', err);
  // 念のため 200 を返す
  if (!res.headersSent) res.status(200).send('OK');
});
