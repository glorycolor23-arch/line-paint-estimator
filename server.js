/**
 * LINE 外壁塗装 見積もりBot + LIFF 連携
 * - QA はLINE上（カード/ボタン）
 * - 写真は個別アップ（カメラ/アルバムのクイックリプライ）
 * - 連絡先は LIFF で一括入力 → CONTACT:JSON を受信して最終確定
 * - スプレッドシート追記 + 管理者メール送信（最終時のみ）
 *
 * 必要な環境変数
 *  CHANNEL_SECRET
 *  CHANNEL_ACCESS_TOKEN
 *  SUPABASE_URL
 *  SUPABASE_SERVICE_ROLE_KEY
 *  GOOGLE_SERVICE_ACCOUNT_EMAIL
 *  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 *  GSHEET_SPREADSHEET_ID
 *  GSHEET_SHEET_NAME
 *  EMAIL_TO
 *  EMAIL_WEBAPP_URL
 *  FRIEND_ADD_URL        ← 使わなくなりました（最終カードから削除）
 *  LIFF_ID               ← 例: 2007914959-XXXXXX
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import axios from 'axios';
import qs from 'qs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ── 基本設定 ───────────────────────────────
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
const LIFF_ID = process.env.LIFF_ID || '';
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('CHANNEL_* が未設定です'); process.exit(1);
}
if (!LIFF_ID) console.warn('⚠️  LIFF_ID が未設定です。LIFF起動ボタンは動きません。');

const client = new line.Client(config);
const app = express();
app.use(express.json());

// 静的配信（/liff/** を配信）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/liff', express.static(path.join(__dirname, 'liff')));
app.get('/health', (_,res)=>res.send('ok'));

// Webhook
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    await Promise.all((req.body.events || []).map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error(e);
    res.status(500).send('NG');
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`listening on ${PORT}`));

// ── 外部サービス ────────────────────────────
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
    requestBody: { values: [row] }
  });
}

async function sendAdminEmail({ htmlBody, photoUrls=[] }) {
  const endpoint = process.env.EMAIL_WEBAPP_URL;
  const to = process.env.EMAIL_TO;
  if (!endpoint || !to) return;
  await axios.post(endpoint, {
    to, subject: '【外壁塗装】最終入力（概算＋回答＋写真）',
    htmlBody, photoUrls
  }, { timeout: 15000 });
}

// ── セッション ───────────────────────────────
const sessions = new Map(); // userId -> state
function defSession() {
  return {
    step: 1,
    answers: {},
    needWall: false,
    needRoof: false,
    photoIndex: -1,
    expectingPhoto: false,
    photoUrls: [],
    contact: { name:'', postal:'', addr1:'', addr2:'' },
  };
}
function getS(uid){ if(!sessions.has(uid)) sessions.set(uid, defSession()); return sessions.get(uid); }
function resetS(uid){ sessions.set(uid, defSession()); }

// ── アイコン（カード用の仮画像） ────────────────
const ICON = {
  floor: 'https://cdn-icons-png.flaticon.com/512/8911/8911331.png',
  layout: 'https://cdn-icons-png.flaticon.com/512/9193/9193091.png',
  paint: 'https://cdn-icons-png.flaticon.com/512/992/992703.png',
  years: 'https://cdn-icons-png.flaticon.com/512/1827/1827370.png',
  wall: 'https://cdn-icons-png.flaticon.com/512/2992/2992653.png',
  roof: 'https://cdn-icons-png.flaticon.com/512/2933/2933922.png',
  leak: 'https://cdn-icons-png.flaticon.com/512/415/415734.png',
  distance: 'https://cdn-icons-png.flaticon.com/512/535/535285.png',
  camera: 'https://cdn-icons-png.flaticon.com/512/685/685655.png',
};

// ── 写真ステップ ─────────────────────────────
const PHOTO_STEPS = [
  { key:'front',  label:'外観写真：正面' },
  { key:'right',  label:'外観写真：右側' },
  { key:'left',   label:'外観写真：左側' },
  { key:'back',   label:'外観写真：後ろ側' },
  { key:'damage', label:'損傷箇所（任意）' },
];

// ── 入口：イベント処理 ────────────────────────
async function handleEvent(ev){
  const userId = ev.source?.userId;
  if (!userId) return;

  if (ev.type === 'follow') {
    resetS(userId);
    return reply(ev, '友だち追加ありがとうございます！\n「見積もり」または「スタート」と送ると、かんたん概算が始まります。');
  }

  if (ev.type === 'message' && ev.message?.type === 'text') {
    const t = (ev.message.text || '').trim();

    // LIFF からの連絡先（CONTACT:JSON）
    if (t.startsWith('CONTACT:')) {
      try {
        const payload = JSON.parse(t.slice(8));
        const s = getS(userId);
        s.contact = {
          name:  payload.name || '',
          postal: (payload.postal || '').replace(/[^\d]/g,''),
          addr1: payload.addr1 || '',
          addr2: payload.addr2 || '',
        };
        return finalizeAndNotify(ev.replyToken, userId);
      } catch (e) {
        console.error('CONTACT parse error', e);
        return reply(ev, '連絡先の受信に失敗しました。もう一度お試しください。');
      }
    }

    if (/^(リセット|最初から)$/i.test(t)) {
      resetS(userId);
      return reply(ev, 'リセットしました。\n「見積もり」または「スタート」と送ってください。');
    }

    if (/^(見積もり|スタート|start)$/i.test(t)) {
      resetS(userId);
      return askQ1(ev.replyToken, userId);
    }

    // 写真待ち中のテキスト
    const s = getS(userId);
    if (s.expectingPhoto) {
      if (/^スキップ$/i.test(t)) return askNextPhoto(ev.replyToken, userId, true);
      if (/^(完了|おわり|終了)$/i.test(t)) {
        s.photoIndex = PHOTO_STEPS.length;
        s.expectingPhoto = false;
        return askContact(ev.replyToken, userId);
      }
      return reply(ev, '写真を送信してください。スキップは「スキップ」、終了は「完了」です。');
    }

    return reply(ev, '「見積もり」または「スタート」と送ってください。');
  }

  if (ev.type === 'message' && ev.message?.type === 'image') {
    const s = getS(userId);
    if (!s.expectingPhoto) return; // 質問中の写真は無視
    // 画像保存（非同期）
    saveImageToSupabase(userId, ev.message.id, s).catch(err=>console.error(err));
    return askNextPhoto(ev.replyToken, userId, false);
  }

  if (ev.type === 'postback') {
    const data = qs.parse(ev.postback.data || '');
    const q = Number(data.q);
    const v = data.v;
    const s = getS(userId);
    if (!q || typeof v === 'undefined') return reply(ev,'受け取りに失敗しました。');

    s.answers[`q${q}`] = v;

    if (q === 3) {
      s.needWall = /外壁/.test(v);
      s.needRoof = /屋根/.test(v);
    }

    // 進行制御
    return advance(ev.replyToken, userId, q);
  }
}

// ── 進行制御（分岐あり） ────────────────────────
async function advance(rt, uid, lastQ){
  const s = getS(uid);

  switch (lastQ) {
    case 1: return askQ2(rt, uid);
    case 2: return askQ3(rt, uid);
    case 3: return askQ4(rt, uid);
    case 4:
      if (s.answers.q4 === 'ある') return askQ5(rt, uid);
      // 無い/わからない → q5スキップ
      s.answers.q5 = '該当なし';
      // 壁/屋根のどちらから？
      if (s.needWall) return askQ6(rt, uid);
      if (s.needRoof) return askQ7(rt, uid);
      return askQ8(rt, uid);
    case 5:
      if (s.needWall) return askQ6(rt, uid);
      if (s.needRoof) return askQ7(rt, uid);
      return askQ8(rt, uid);
    case 6:
      if (s.needRoof) return askQ7(rt, uid);
      return askQ8(rt, uid);
    case 7: return askQ8(rt, uid);
    case 8: return askQ9(rt, uid);
    case 9: return askQ10_Begin(rt, uid);
    default: return askContact(rt, uid);
  }
}

// ── カードUI（Flex） ───────────────────────────
function cardCarousel(title, qnum, items){
  // items: [{label, value, image}]
  const bubbles = items.map(it => ({
    type:'bubble',
    body:{
      type:'box', layout:'vertical', spacing:'sm',
      contents:[
        { type:'image', url: it.image, size:'full', aspectMode:'cover', aspectRatio:'1:1' },
        { type:'text', text: title, weight:'bold', wrap:true, margin:'md' },
        { type:'text', text: it.label, size:'sm', color:'#555555', wrap:true }
      ]
    },
    footer:{
      type:'box', layout:'vertical', contents:[
        { type:'button', style:'primary',
          action:{ type:'postback', label:'選ぶ', data: qs.stringify({ q:qnum, v:it.value }), displayText: it.label }
        }
      ]
    }
  }));
  return {
    type:'flex',
    altText:title,
    contents:{ type:'carousel', contents: bubbles }
  };
}

// ── 質問 ──────────────────────────────────────
async function askQ1(rt, uid){
  const title = '1/10 階数を選んでください';
  const items = [
    { label:'1階建て', value:'1階建て', image: ICON.floor },
    { label:'2階建て', value:'2階建て', image: ICON.floor },
    { label:'3階建て', value:'3階建て', image: ICON.floor },
  ];
  return client.replyMessage(rt, cardCarousel(title, 1, items));
}
async function askQ2(rt){
  const title='2/10 間取りを選んでください';
  const L=['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  const items = L.map(v => ({ label:v, value:v, image: ICON.layout }));
  return client.replyMessage(rt, cardCarousel(title, 2, items));
}
async function askQ3(rt, uid){
  const title='3/10 希望する工事内容を選んでください';
  const items = [
    { label:'外壁塗装', value:'外壁塗装', image: ICON.paint },
    { label:'屋根塗装', value:'屋根塗装', image: ICON.paint },
    { label:'外壁塗装＋屋根塗装', value:'外壁塗装＋屋根塗装', image: ICON.paint },
  ];
  return client.replyMessage(rt, cardCarousel(title, 3, items));
}
async function askQ4(rt){
  const title='4/10 これまで外壁塗装をしたことはありますか？';
  const items = [
    { label:'ある', value:'ある', image: ICON.years },
    { label:'ない', value:'ない', image: ICON.years },
    { label:'わからない', value:'わからない', image: ICON.years },
  ];
  return client.replyMessage(rt, cardCarousel(title, 4, items));
}
async function askQ5(rt){
  const title='5/10 前回の外壁塗装からどれくらい？';
  const L=['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  const items = L.map(v=>({label:v, value:v, image: ICON.years}));
  return client.replyMessage(rt, cardCarousel(title, 5, items));
}
async function askQ6(rt){ // 外壁
  const title='6/10 外壁の種類は？';
  const L=['モルタル','サイディング','タイル','ALC'];
  const items = L.map(v=>({label:v,value:v,image:ICON.wall}));
  return client.replyMessage(rt, cardCarousel(title, 6, items));
}
async function askQ7(rt){ // 屋根
  const title='7/10 屋根の種類は？';
  const L=['瓦','スレート','ガルバリウム','トタン'];
  const items = L.map(v=>({label:v,value:v,image:ICON.roof}));
  return client.replyMessage(rt, cardCarousel(title, 7, items));
}
async function askQ8(rt){
  const title='8/10 雨漏りの状況は？';
  const L=['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'];
  const items = L.map(v=>({label:v,value:v,image:ICON.leak}));
  return client.replyMessage(rt, cardCarousel(title, 8, items));
}
async function askQ9(rt){
  const title='9/10 周辺との最短距離（足場の目安）';
  const L=['30cm以下','50cm以下','70cm以下','70cm以上'];
  const items = L.map(v=>({label:v,value:v,image:ICON.distance}));
  return client.replyMessage(rt, cardCarousel(title, 9, items));
}

async function askQ10_Begin(rt, uid){
  const s = getS(uid);
  s.expectingPhoto = true;
  s.photoIndex = -1;
  return askNextPhoto(rt, uid, false, true);
}

async function askNextPhoto(rt, uid, skipped=false, first=false){
  const s = getS(uid);
  if (!first) s.photoIndex += 1;
  else s.photoIndex = 0;

  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    return askContact(rt, uid);
  }
  const cur = PHOTO_STEPS[s.photoIndex];
  const quick = {
    items: [
      { type:'action', imageUrl: ICON.camera, action:{ type:'camera',     label:'カメラを起動' } },
      { type:'action', imageUrl: ICON.camera, action:{ type:'cameraRoll', label:'アルバムから' } },
      { type:'action', imageUrl: ICON.camera, action:{ type:'message',    label:'スキップ', text:'スキップ' } },
      { type:'action', imageUrl: ICON.camera, action:{ type:'message',    label:'完了',     text:'完了' } },
    ]
  };
  return client.replyMessage(rt, {
    type:'text',
    text:`10/10 写真アップロード\n「${cur.label}」を送ってください。\n（送れない場合は「スキップ」／全部終えたら「完了」）`,
    quickReply: quick
  });
}

async function askContact(rt, uid){
  const s = getS(uid);
  const a = s.answers;
  const est = estimateCost(a);
  const title = '詳しい見積もりをご希望の方へ';
  const alt = '詳しい見積もりの依頼';
  const liffUrl = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : 'https://example.com';

  const card = {
    type:'flex', altText: alt,
    contents:{
      type:'bubble',
      body:{ type:'box', layout:'vertical', spacing:'md', contents:[
        { type:'text', text: '見積り金額', weight:'bold', size:'lg' },
        { type:'text', text: `¥ ${est.toLocaleString()}`, weight:'bold', size:'xl' },
        { type:'text', wrap:true, text:'上記はご入力いただいた内容を元に算出した概算金額です。' },
        { type:'separator', margin:'md' },
        { type:'text', text:'正式なお見積りが必要な方は続けてご入力をお願いします。', wrap:true },
        { type:'text', text:'現地調査なしで、詳細な見積りをLINEでお知らせします。', wrap:true, color:'#666666' }
      ]},
      footer:{ type:'box', layout:'vertical', contents:[
        { type:'button', style:'primary',
          action:{ type:'uri', label:'現地調査なしで見積を依頼', uri: liffUrl } }
      ]}
    }
  };

  return client.replyMessage(rt, [
    { type:'text', text: summaryText(a, s.photoUrls.length) },
    card
  ]);
}

// ── 画像保存（Supabase） ───────────────────────
async function streamToBuffer(stream){
  return new Promise((res,rej)=>{
    const chunks=[]; stream.on('data',c=>chunks.push(c));
    stream.on('end',()=>res(Buffer.concat(chunks)));
    stream.on('error',rej);
  });
}
async function saveImageToSupabase(userId, messageId, s){
  const stream = await client.getMessageContent(messageId);
  const buf = await streamToBuffer(stream);
  const name = `${PHOTO_STEPS[s.photoIndex]?.key || 'photo'}_${Date.now()}.jpg`;
  const pathOnBucket = `line/${userId}/${name}`;
  const { error } = await supabase.storage.from('photos')
    .upload(pathOnBucket, buf, { contentType:'image/jpeg', upsert:true });
  if (error) throw error;
  const { data:pub } = supabase.storage.from('photos').getPublicUrl(pathOnBucket);
  if (pub?.publicUrl) s.photoUrls.push(pub.publicUrl);
}

// ── 見積もり計算/最終確定 ──────────────────────
function estimateCost(a){
  const base = { '外壁塗装':700000, '屋根塗装':300000, '外壁塗装＋屋根塗装':900000 };
  const floor={ '1階建て':1.0,'2階建て':1.2,'3階建て':1.4 };
  const layout={ '1DK':0.9,'1LDK':0.95,'2DK':1.0,'2LDK':1.05,'3DK':1.1,'3LDK':1.15,'4DK':1.2,'4LDK':1.25,'5DK':1.3,'5LDK':1.35 };
  const wall={ 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof={ '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak={ '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.1,'雨漏りはない':1.0 };
  const dist={ '30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.1,'70cm以上':1.0 };
  const years={ '1〜5年':0.95,'5〜10年':1.0,'10〜15年':1.05,'15〜20年':1.1,'20〜30年':1.15,'30〜40年':1.2,'40年以上':1.25,'0年（新築）':0.9 };

  let cost = base[a.q3] || 600000;
  cost *= floor[a.q1] || 1.0;
  cost *= layout[a.q2] || 1.0;
  if (a.q3.includes('外壁')) cost *= wall[a.q6] || 1.0;
  if (a.q3.includes('屋根')) cost *= roof[a.q7] || 1.0;
  cost *= leak[a.q8] || 1.0;
  cost *= dist[a.q9] || 1.0;
  if (a.q4 === 'ある') cost *= years[a.q5] || 1.0;
  return Math.round(cost/1000)*1000;
}
function summaryText(a, nPhotos){
  return [
    '【回答の確認】',
    `・階数:${a.q1||'-'}  間取り:${a.q2||'-'}  工事:${a.q3||'-'}`,
    `・過去塗装:${a.q4||'-'}  前回から:${a.q5||'該当なし'}`,
    `・外壁:${a.q6||'-'}  屋根:${a.q7||'-'}  雨漏り:${a.q8||'-'}`,
    `・最短距離:${a.q9||'-'}  受領写真:${nPhotos}枚`
  ].join('\n');
}

async function finalizeAndNotify(replyToken, uid){
  const s = getS(uid);
  const a = s.answers;
  const est = estimateCost(a);
  const now = new Date();

  // シート追記
  const row = [
    now.toISOString(), uid,
    s.contact.name, s.contact.postal, s.contact.addr1, s.contact.addr2,
    a.q1||'',a.q2||'',a.q3||'',a.q4||'',a.q5||'',
    a.q6||'',a.q7||'',a.q8||'',a.q9||'',
    s.photoUrls.length, est
  ];
  try{ await appendToSheet(row); } catch(e){ console.error('sheet',e?.response?.data||e); }

  // メール
  const html = `
  <div style="font-family:system-ui">
    <h2>外壁塗装 — 最終入力</h2>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
      <tr><th align="left">LINEユーザーID</th><td>${esc(uid)}</td></tr>
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
      <tr><th align="left">受領写真</th><td>${s.photoUrls.length}枚</td></tr>
      <tr><th align="left">概算金額</th><td>¥ ${est.toLocaleString()}</td></tr>
      <tr><th align="left">タイムスタンプ</th><td>${now.toLocaleString('ja-JP')}</td></tr>
    </table>
    ${s.photoUrls.length ? `<p>写真リンク：</p><ol>${s.photoUrls.map(u=>`<li><a href="${u}">${u}</a></li>`).join('')}</ol>` : ''}
  </div>`;
  try{ await sendAdminEmail({ htmlBody: html, photoUrls: s.photoUrls }); } catch(e){ console.error('email',e?.response?.data||e); }

  // ユーザーへ完了メッセージ（友だち追加案内は削除）
  await client.replyMessage(replyToken, [
    {
      type:'flex', altText:'受付完了',
      contents:{
        type:'bubble',
        body:{ type:'box', layout:'vertical', spacing:'md', contents:[
          { type:'text', text:'お見積りのご依頼ありがとうございます。', weight:'bold', size:'lg' },
          { type:'text', wrap:true, text:'送信された内容を確認し、1〜2営業日程度で詳細なお見積りをLINEでご返信致します。' }
        ]}
      }
    }
  ]);

  resetS(uid);
}

function esc(s){ return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function reply(ev, text){ return client.replyMessage(ev.replyToken, { type:'text', text }); }
