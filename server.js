/****************************************************
 * 外装工事オンライン見積もり — 完全版
 *  - トリガー: 「カンタン見積りを依頼」「見積もりスタート」
 *  - 画像つきカルーセルで Q1〜Q10（条件分岐あり）
 *  - 最終に概算金額 + 「現地調査なしで見積を依頼」（LIFFへ）
 *  - LIFF:
 *      GET  /liff/prefill   ← LIFFアクセストークンで userId を同定し回答を取得
 *      POST /liff/submit    ← 連絡先＋写真(base64)を受け取り、Sheets追記＋Apps Scriptでメール
 *  - Supabase は使いません
 ****************************************************/

import express from 'express';
import crypto from 'crypto';
import * as line from '@line/bot-sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ---------- 環境変数 ---------- */
const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  PORT,
  LIFF_ID, // 例: 2007914959-XXXX
  EMAIL_WEBAPP_URL,
  EMAIL_TO,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  GSHEET_SPREADSHEET_ID,
  GSHEET_SHEET_NAME,
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error('CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET is required.');
  process.exit(1);
}
if (!EMAIL_WEBAPP_URL || !EMAIL_TO) {
  console.warn('[WARN] EMAIL_WEBAPP_URL / EMAIL_TO が未設定です（メール送信はスキップされます）');
}
if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || !GSHEET_SPREADSHEET_ID) {
  console.warn('[WARN] Google Sheets の認証情報が未設定です（シート追記はスキップされます）');
}

/* LIFF 遷移先（正確なURL; 余計なスペースなし） */
const LIFF_BUTTON_URL = `https://line-paint.onrender.com/liff/index.html`;

/* ---------- LINE Client ---------- */
const client = new line.Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* ---------- Express ---------- */
const app = express();

/* /liff を静的配信（liff/index.html, app.js など） */
app.use('/liff', express.static(path.join(__dirname, 'liff')));

/* health / env.js */
app.get('/health', (_req, res) => res.send('ok'));
app.get('/liff/env.js', (_req, res) => {
  res.type('application/javascript')
     .send(`window.__LIFF_ENV__=${JSON.stringify({ LIFF_ID })};`);
});

/* ---------- Webhook（署名検証＋生ボディ JSON化） ---------- */
app.use('/webhook', express.raw({ type: '*/*' }), (req, res, next) => {
  const signature = req.get('x-line-signature');
  const bodyBuf = req.body;
  const hmac = crypto.createHmac('sha256', CHANNEL_SECRET);
  hmac.update(bodyBuf);
  const expected = hmac.digest('base64');
  if (expected !== signature) return res.status(403).send('bad signature');
  try { req.body = JSON.parse(bodyBuf.toString()); }
  catch { return res.status(400).send('invalid body'); }
  next();
});

/* ---------- セッション（超簡易: メモリ） ---------- */
const sessions = new Map(); // userId -> {step, answers, updated}
const TTL = 60 * 60 * 1000;

function getState(uid){
  const now = Date.now();
  const s = sessions.get(uid);
  if (!s || now - s.updated > TTL) {
    const ns = { step: 0, answers: {}, updated: now };
    sessions.set(uid, ns); return ns;
  }
  s.updated = now; return s;
}
function reset(uid){ sessions.set(uid, { step:0, answers:{}, updated:Date.now() }); }

/* ---------- 送信ユーティリティ ---------- */
const t = (text)=>({ type:'text', text });
async function reply(token, m){ try{
  await client.replyMessage(token, Array.isArray(m)? m: [m]);
}catch(e){ console.error('reply err:', e?.response?.data || e);}}

/* ---------- 画像カルーセル生成 ---------- */
function img(label,color='2ecc71'){
  return `https://placehold.jp/30/${color}/ffffff/600x400.png?text=${encodeURIComponent(label)}`;
}
function carousel(title, opts){
  // opts: [{label,text,color}]
  // 1通10列制限 → 分割
  const chunks=[];
  for(let i=0;i<opts.length;i+=10) chunks.push(opts.slice(i,i+10));
  return chunks.map(chunk=>({
    type:'template',
    altText:title,
    template:{
      type:'carousel',
      columns: chunk.map(o=>({
        thumbnailImageUrl: img(o.label,o.color),
        title, text:'下のボタンから選択してください',
        actions:[{ type:'message', label:'選ぶ', text:o.text }]
      }))
    }
  }));
}

/* ---------- 質問（Q1〜Q10） ---------- */
// Q1 階数
const Q1 = ()=> carousel('1/10 工事物件の階数は？',[
  {label:'1階建て', text:'1階建て'},
  {label:'2階建て', text:'2階建て'},
  {label:'3階建て', text:'3階建て'},
]);

// Q2 間取り（12個→ 2通に自動分割）
const Q2 = ()=> carousel('2/10 物件の間取りは？',[
  {label:'1K', text:'1K'},{label:'1DK', text:'1DK'},{label:'1LDK', text:'1LDK'},
  {label:'2K', text:'2K'},{label:'2DK', text:'2DK'},{label:'2LDK', text:'2LDK'},
  {label:'3K', text:'3K'},{label:'3DK', text:'3DK'},{label:'3LDK', text:'3LDK'},
  {label:'4K', text:'4K'},{label:'4DK', text:'4DK'},{label:'4LDK', text:'4LDK'},
]);

// Q3 築年数
const Q3 = ()=> carousel('3/10 物件の築年数は？',[
  {label:'新築', text:'新築', color:'3498db'},
  {label:'〜10年', text:'〜10年'},{label:'〜20年', text:'〜20年'},
  {label:'〜30年', text:'〜30年'},{label:'〜40年', text:'〜40年'},
  {label:'〜50年', text:'〜50年'},{label:'51年以上', text:'51年以上'},
]);

// Q4 過去塗装
const Q4 = ()=> carousel('4/10 過去に塗装をした経歴は？',[
  {label:'ある', text:'ある', color:'2ecc71'},
  {label:'ない', text:'ない', color:'e74c3c'},
  {label:'わからない', text:'わからない', color:'e67e22'},
]);

// Q5 前回塗装から
const Q5 = ()=> carousel('5/10 前回の塗装はいつ頃？',[
  {label:'〜5年', text:'〜5年'},
  {label:'5〜10年', text:'5〜10年'},
  {label:'10〜20年', text:'10〜20年'},
  {label:'20〜30年', text:'20〜30年'},
  {label:'わからない', text:'わからない'},
]);

// Q6 希望工事内容（A）
const Q6 = ()=> carousel('6/10 ご希望の工事内容は？',[
  {label:'外壁塗装', text:'外壁塗装'},
  {label:'屋根塗装', text:'屋根塗装'},
  {label:'外壁塗装+屋根塗装', text:'外壁塗装+屋根塗装'},
]);

// Q7 外壁種類（条件: A が 外壁塗装 or 外壁+屋根）
const Q7 = ()=> carousel('7/10 外壁の種類は？',[
  {label:'モルタル', text:'モルタル'},
  {label:'サイディング', text:'サイディング'},
  {label:'タイル', text:'タイル'},
  {label:'ALC', text:'ALC'},
]);

// Q8 屋根種類（条件: A が 屋根塗装 or 外壁+屋根）
const Q8 = ()=> carousel('8/10 屋根の種類は？',[
  {label:'瓦', text:'瓦'},
  {label:'スレート', text:'スレート'},
  {label:'ガルバリウム', text:'ガルバリウム'},
  {label:'トタン', text:'トタン'},
]);

// Q9 雨漏り
const Q9 = ()=> carousel('9/10 雨漏りや漏水の症状はありますか？',[
  {label:'雨の日に水滴が落ちる', text:'雨の日に水滴が落ちる'},
  {label:'天井にシミがある', text:'天井にシミがある'},
  {label:'ない', text:'ない'},
]);

// Q10 距離
const Q10 = ()=> carousel('10/10 隣や裏の家との距離は？',[
  {label:'30cm以下', text:'30cm以下'},
  {label:'50cm以下', text:'50cm以下'},
  {label:'70cm以下', text:'70cm以下'},
  {label:'70cm以上', text:'70cm以上'},
]);

/* ---------- 概算ロジック ---------- */
function estimateCost(a) {
  const base = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装+屋根塗装': 900000 };
  const floor = { '1階建て': 1.0, '2階建て': 1.2, '3階建て': 1.4 };
  const layout = { '1K':0.85,'1DK':0.9,'1LDK':0.95,'2K':0.98,'2DK':1.0,'2LDK':1.05,'3K':1.10,'3DK':1.15,'3LDK':1.20,'4K':1.22,'4DK':1.25,'4LDK':1.30 };
  const age = { '新築':0.9,'〜10年':1.0,'〜20年':1.05,'〜30年':1.10,'〜40年':1.15,'〜50年':1.2,'51年以上':1.25 };
  const wall = { 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof = { '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak = { '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.1,'ない':1.0 };
  const dist = { '30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.1,'70cm以上':1.0 };

  let cost = base[a.q6_work] || 600000;
  cost *= floor[a.q1_floors] || 1.0;
  cost *= layout[a.q2_layout] || 1.0;
  if (a.q3_age && age[a.q3_age]) cost *= age[a.q3_age];
  if (a.q6_work === '外壁塗装' || a.q6_work === '外壁塗装+屋根塗装') {
    cost *= wall[a.q7_wall] || 1.0;
  }
  if (a.q6_work === '屋根塗装' || a.q6_work === '外壁塗装+屋根塗装') {
    cost *= roof[a.q8_roof] || 1.0;
  }
  cost *= leak[a.q9_leak] || 1.0;
  cost *= dist[a.q10_dist] || 1.0;

  // 前回塗装時期（q4が「ある」のときのみ影響）
  if (a.q4_painted === 'ある') {
    const last = { '〜5年':0.98,'5〜10年':1.0,'10〜20年':1.05,'20〜30年':1.10,'わからない':1.0 };
    cost *= last[a.q5_last] || 1.0;
  }

  return Math.round(cost / 1000) * 1000;
}
const yen = (n)=> n.toLocaleString('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0});

/* ---------- 次に出すメッセージ ---------- */
function followupFor(s){
  const a = s.answers;
  if (s.step===1) return [ t('見積もりを開始します。以下の質問にお答えください。'), ...Q1() ];
  if (s.step===2) return [ t('ありがとうございます。次の質問です。'), ...Q2() ];
  if (s.step===3) return [ t('ありがとうございます。次の質問です。'), ...Q3() ];
  if (s.step===4) return [ t('ありがとうございます。次の質問です。'), ...Q4() ];
  if (s.step===5) {
    if (a.q4_painted==='ある') return [ t('ありがとうございます。次の質問です。'), ...Q5() ];
    s.step=6; return followupFor(s); // スキップ
  }
  if (s.step===6) return [ t('ありがとうございます。次の質問です。'), ...Q6() ];
  if (s.step===7) {
    if (a.q6_work==='外壁塗装' || a.q6_work==='外壁塗装+屋根塗装') return [ t('ありがとうございます。次の質問です。'), ...Q7() ];
    s.step=8; return followupFor(s); // スキップ（外壁不要）
  }
  if (s.step===8) {
    if (a.q6_work==='屋根塗装' || a.q6_work==='外壁塗装+屋根塗装') return [ t('ありがとうございます。次の質問です。'), ...Q8() ];
    s.step=9; return followupFor(s); // スキップ（屋根不要）
  }
  if (s.step===9) return [ t('ありがとうございます。次の質問です。'), ...Q9() ];
  if (s.step===10) return [ t('ありがとうございます。次の質問です。'), ...Q10() ];
  if (s.step===11) {
    const price = estimateCost(a);
    const summary = [
      '【回答の確認】',
      `・階数: ${a.q1_floors||'-'} / 間取り: ${a.q2_layout||'-'} / 築年数: ${a.q3_age||'-'}`,
      `・過去塗装: ${a.q4_painted||'-'} / 前回から: ${a.q5_last||'該当なし'}`,
      `・工事内容: ${a.q6_work||'-'} / 外壁: ${a.q7_wall||'—'} / 屋根: ${a.q8_roof||'—'}`,
      `・雨漏り: ${a.q9_leak||'-'} / 距離: ${a.q10_dist||'-'}`
    ].join('\n');

    const flex = {
      type:'flex',
      altText:'概算見積もり',
      contents:{
        type:'bubble',
        body:{
          type:'box',layout:'vertical',spacing:'md',contents:[
            {type:'text',text:'見積り金額',weight:'bold',size:'md'},
            {type:'text',text:yen(price),weight:'bold',size:'xl'},
            {type:'text',text:'上記はご入力いただいた内容を元に算出した概算金額です。',wrap:true,size:'sm',color:'#666'}
          ]
        },
        footer:{
          type:'box',layout:'vertical',spacing:'md',contents:[
            {type:'text',text:'正式なお見積りが必要な方は続けてご入力をお願いします。',wrap:true,size:'sm'},
            {type:'button',style:'primary',action:{type:'uri',label:'現地調査なしで見積を依頼',uri:LIFF_BUTTON_URL}}
          ]
        }
      }
    };

    return [
      t(summary),
      flex,
      t('1〜3営業日以内にLINEでお見積書をお送りします。')
    ];
  }
  return [ t('「カンタン見積りを依頼」と送信すると質問を開始します。') ];
}

/* ---------- Webhook ---------- */
app.post('/webhook', async (req,res)=>{
  const events = req.body.events || [];
  res.sendStatus(200);

  for(const ev of events){
    try{
      if(!ev.source?.userId) continue;
      const uid = ev.source.userId;
      const s   = getState(uid);

      // 友だち追加など
      if(ev.type==='follow' || ev.type==='join'){
        reset(uid);
        const ns = getState(uid); ns.step=1;
        await reply(ev.replyToken, followupFor(ns)); continue;
      }

      if(ev.type==='message' && ev.message.type==='text'){
        const text=(ev.message.text||'').trim();

        // リセット（任意）
        if(text==='はじめからやり直す' || text==='リセット'){
          reset(uid); const ns=getState(uid); ns.step=1;
          await reply(ev.replyToken, followupFor(ns)); continue;
        }

        // トリガー完全一致
        if(text==='カンタン見積りを依頼' || text==='見積もりスタート'){
          reset(uid); const ns=getState(uid); ns.step=1;
          await reply(ev.replyToken, followupFor(ns)); continue;
        }

        // 回答ルーティング
        const A=(_)=>reply(ev.replyToken,[ t(`「${text}」で承りました。`), ...followupFor(s) ]);

        if(s.step===1 && ['1階建て','2階建て','3階建て'].includes(text)){ s.answers.q1_floors=text; s.step=2; await A(); continue; }
        if(s.step===2){
          const list=['1K','1DK','1LDK','2K','2DK','2LDK','3K','3DK','3LDK','4K','4DK','4LDK'];
          if(list.includes(text)){ s.answers.q2_layout=text; s.step=3; await A(); continue; }
        }
        if(s.step===3){
          const list=['新築','〜10年','〜20年','〜30年','〜40年','〜50年','51年以上'];
          if(list.includes(text)){ s.answers.q3_age=text; s.step=4; await A(); continue; }
        }
        if(s.step===4){
          const list=['ある','ない','わからない'];
          if(list.includes(text)){ s.answers.q4_painted=text; s.step=5; await A(); continue; }
        }
        if(s.step===5){
          const list=['〜5年','5〜10年','10〜20年','20〜30年','わからない'];
          // Q4=ある のときだけ有効。ない/わからない の場合は step=6 に自動スキップされるのでここは素通り
          if(s.answers.q4_painted==='ある' && list.includes(text)){ s.answers.q5_last=text; s.step=6; await A(); continue; }
        }
        if(s.step===6){
          const list=['外壁塗装','屋根塗装','外壁塗装+屋根塗装'];
          if(list.includes(text)){ s.answers.q6_work=text; s.step=7; await A(); continue; }
        }
        if(s.step===7){
          const needWall = (s.answers.q6_work==='外壁塗装' || s.answers.q6_work==='外壁塗装+屋根塗装');
          const list=['モルタル','サイディング','タイル','ALC'];
          if(needWall && list.includes(text)){ s.answers.q7_wall=text; s.step=8; await A(); continue; }
          if(!needWall){ s.step=8; await reply(ev.replyToken, followupFor(s)); continue; }
        }
        if(s.step===8){
          const needRoof = (s.answers.q6_work==='屋根塗装' || s.answers.q6_work==='外壁塗装+屋根塗装');
          const list=['瓦','スレート','ガルバリウム','トタン'];
          if(needRoof && list.includes(text)){ s.answers.q8_roof=text; s.step=9; await A(); continue; }
          if(!needRoof){ s.step=9; await reply(ev.replyToken, followupFor(s)); continue; }
        }
        if(s.step===9){
          const list=['雨の日に水滴が落ちる','天井にシミがある','ない'];
          if(list.includes(text)){ s.answers.q9_leak=text; s.step=10; await A(); continue; }
        }
        if(s.step===10){
          const list=['30cm以下','50cm以下','70cm以下','70cm以上'];
          if(list.includes(text)){ s.answers.q10_dist=text; s.step=11; await reply(ev.replyToken, followupFor(s)); continue; }
        }

        // その他の入力
        await reply(ev.replyToken, t('カードの「選ぶ」ボタンからお答えください。'));
        continue;
      }

      // 画像など
      if(ev.type==='message' && ev.message.type!=='text'){
        await reply(ev.replyToken, t('メッセージを受信しました。カードの「選ぶ」から操作してください。'));
      }
    }catch(e){ console.error('event error:', e?.response?.data || e); }
  }
});

/* ---------- Google Sheets 追記 ---------- */
async function appendToSheet(values){
  if(!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || !GSHEET_SPREADSHEET_ID) return;
  const jwt = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await jwt.authorize();
  const sheets = google.sheets('v4');
  await sheets.spreadsheets.values.append({
    auth: jwt,
    spreadsheetId: GSHEET_SPREADSHEET_ID,
    range: `${GSHEET_SHEET_NAME || 'Entries'}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
}

/* ---------- メール送信（Apps Script WebApp; base64添付可） ---------- */
async function sendMailViaAppsScript({ htmlBody, photosBase64 = [] }){
  if(!EMAIL_WEBAPP_URL || !EMAIL_TO) return;
  await axios.post(EMAIL_WEBAPP_URL, {
    to: EMAIL_TO,
    subject: '【外装工事】詳細見積り依頼（LIFF）',
    htmlBody,              // 本文（HTML）
    photosBase64,          // base64 添付（Apps Script 側で受理）
    photoUrls: []          // 互換のため残す（今回は未使用）
  }, { timeout: 25000 });
}

/* ---------- LIFF API（回答引き継ぎ & 送信） ---------- */
// LIFF AccessToken から userId を取得
async function getUserIdFromLiffToken(accessToken){
  const resp = await axios.get('https://api.line.me/v2/profile', {
    headers:{ Authorization: `Bearer ${accessToken}` }
  });
  return resp.data?.userId;
}

// 既回答の取得（プレビュー用）
app.get('/liff/prefill', express.json(), async (req,res)=>{
  try{
    const auth = req.get('Authorization') || '';
    const token = auth.startsWith('Bearer ')? auth.slice(7): '';
    if(!token) return res.status(401).json({ error:'no token' });

    const userId = await getUserIdFromLiffToken(token);
    if(!userId) return res.status(401).json({ error:'invalid token' });

    const s = sessions.get(userId);
    const answers = s?.answers || {};
    const price = estimateCost(answers || {});
    return res.json({ answers, price, priceYen: yen(price) });
  }catch(e){
    console.error('/liff/prefill', e?.response?.data || e);
    res.status(500).json({ error:'prefill failed' });
  }
});

// 送信（氏名/電話/住所/写真）
app.post('/liff/submit', express.json({ limit:'25mb' }), async (req,res)=>{
  try{
    const auth = req.get('Authorization') || '';
    const token = auth.startsWith('Bearer ')? auth.slice(7): '';
    if(!token) return res.status(401).json({ error:'no token' });

    const userId = await getUserIdFromLiffToken(token);
    if(!userId) return res.status(401).json({ error:'invalid token' });

    const s = sessions.get(userId) || { answers:{} };
    const a = s.answers || {};
    const {
      name, phone, postal, addr1, addr2, photosBase64 = []
    } = req.body || {};

    const price = estimateCost(a);
    const now = new Date();

    // 1) スプレッドシート（最終到達のみ）
    const row = [
      now.toISOString(), userId, name||'', postal||'', addr1||'', addr2||'',
      a.q1_floors||'', a.q2_layout||'', a.q3_age||'',
      a.q4_painted||'', a.q5_last||'',
      a.q6_work||'', a.q7_wall||'', a.q8_roof||'',
      a.q9_leak||'', a.q10_dist||'',
      photosBase64.length, price
    ];
    await appendToSheet(row);

    // 2) 管理者へメール（Apps Script, base64添付）
    const esc = (x)=> String(x??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    const html = `
      <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial">
        <h2>外装工事 — 詳細見積り依頼（LIFF）</h2>
        <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
          <tr><th align="left">LINEユーザーID</th><td>${esc(userId)}</td></tr>
          <tr><th align="left">お名前</th><td>${esc(name)}</td></tr>
          <tr><th align="left">電話番号</th><td>${esc(phone)}</td></tr>
          <tr><th align="left">郵便番号</th><td>${esc(postal)}</td></tr>
          <tr><th align="left">住所1</th><td>${esc(addr1)}</td></tr>
          <tr><th align="left">住所2</th><td>${esc(addr2)}</td></tr>
          <tr><th align="left">階数</th><td>${esc(a.q1_floors||'')}</td></tr>
          <tr><th align="left">間取り</th><td>${esc(a.q2_layout||'')}</td></tr>
          <tr><th align="left">築年数</th><td>${esc(a.q3_age||'')}</td></tr>
          <tr><th align="left">過去塗装</th><td>${esc(a.q4_painted||'')}</td></tr>
          <tr><th align="left">前回から</th><td>${esc(a.q5_last||'')}</td></tr>
          <tr><th align="left">工事内容</th><td>${esc(a.q6_work||'')}</td></tr>
          <tr><th align="left">外壁</th><td>${esc(a.q7_wall||'—')}</td></tr>
          <tr><th align="left">屋根</th><td>${esc(a.q8_roof||'—')}</td></tr>
          <tr><th align="left">雨漏り</th><td>${esc(a.q9_leak||'')}</td></tr>
          <tr><th align="left">距離</th><td>${esc(a.q10_dist||'')}</td></tr>
          <tr><th align="left">概算金額</th><td>${esc(yen(price))}</td></tr>
          <tr><th align="left">写真枚数</th><td>${photosBase64.length}</td></tr>
          <tr><th align="left">タイムスタンプ</th><td>${now.toLocaleString('ja-JP')}</td></tr>
        </table>
      </div>`;
    await sendMailViaAppsScript({ htmlBody: html, photosBase64 });

    // 3) ユーザーへ完了
    res.json({ ok:true });
  }catch(e){
    console.error('/liff/submit', e?.response?.data || e);
    res.status(500).json({ ok:false, error:'submit failed' });
  }
});

/* ---------- 起動 ---------- */
const p = PORT || 10000;
app.listen(p, ()=> console.log(`listening on ${p}`));
