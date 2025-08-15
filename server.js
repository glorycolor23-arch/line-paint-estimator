/****************************************************
 * 外装工事オンライン見積もり — 完全版（postback化）
 *  - すべての選択を postback に統一（表記ゆれ撲滅）
 *  - 「いいえ」→ 現在の質問を必ず再提示
 *  - 途中発話＝停止確認を出すが、続行なら即再提示
 *  - 最終は reply 一発で【概算＋LIFFボタン】を返す
 ****************************************************/

import express from 'express';
import crypto from 'crypto';
import * as line from '@line/bot-sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { google } from 'googleapis';

/* ---------- 基本設定 ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  PORT,
  LIFF_ID,
  EMAIL_WEBAPP_URL,
  EMAIL_TO,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  GSHEET_SPREADSHEET_ID,
  GSHEET_SHEET_NAME,
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error('CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET is required');
  process.exit(1);
}
const LIFF_BUTTON_URL = `https://line-paint.onrender.com/liff/index.html`;

const client = new line.Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* ---------- Express ---------- */
const app = express();
app.use('/liff', express.static(path.join(__dirname, 'liff')));

app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/liff/env.js', (_req, res) => {
  res.type('application/javascript')
     .send(`window.__LIFF_ENV__=${JSON.stringify({ LIFF_ID })};`);
});

/* Webhook: 署名検証＋生ボディ → JSON化 */
app.use('/webhook', express.raw({ type: '*/*' }), (req, res, next) => {
  const signature = req.get('x-line-signature');
  const bodyBuf   = req.body;
  const calc = crypto.createHmac('sha256', CHANNEL_SECRET).update(bodyBuf).digest('base64');
  if (calc !== signature) return res.status(403).send('bad signature');
  try { req.body = JSON.parse(bodyBuf.toString()); }
  catch { return res.status(400).send('invalid body'); }
  next();
});

/* ---------- セッション ---------- */
const sessions = new Map();                 // userId -> { step, answers, updated }
const TTL = 60 * 60 * 1000;                 // 60分

function getState(uid){
  const now = Date.now();
  const s = sessions.get(uid);
  if (!s || now - s.updated > TTL) {
    const ns = { step: 0, answers: {}, updated: now };
    sessions.set(uid, ns);
    return ns;
  }
  s.updated = now; return s;
}
function reset(uid){ sessions.set(uid, { step:0, answers:{}, updated: Date.now() }); }

const t = (text)=>({ type:'text', text });
const log = (...args)=> console.log('[BOT]', ...args);

/* ---------- 汎用テンプレート ---------- */
function confirmStopTemplate(){
  return {
    type:'template',
    altText:'見積りを停止しますか？',
    template:{
      type:'confirm',
      text:'見積りを停止しますか？',
      actions:[
        { type:'postback', label:'はい',  displayText:'はい',  data:'cmd=stop&v=yes' },
        { type:'postback', label:'いいえ',displayText:'いいえ',data:'cmd=stop&v=no'  }
      ]
    }
  };
}
function img(label,color='2ecc71'){
  return `https://placehold.jp/30/${color}/ffffff/600x400.png?text=${encodeURIComponent(label)}`;
}
function toCarousel(title, key, options){
  // options: [{label,value,color}]
  const pages=[];
  for(let i=0;i<options.length;i+=10) pages.push(options.slice(i,i+10));
  return pages.map(page=>({
    type:'template',
    altText:title,
    template:{
      type:'carousel',
      columns: page.map(o=>({
        thumbnailImageUrl: img(o.label, o.color||'2ecc71'),
        title, text: '下のボタンから選択してください',
        actions:[{
          type:'postback',
          label:'選ぶ',
          displayText:o.label,
          data:`cmd=answer&key=${encodeURIComponent(key)}&val=${encodeURIComponent(o.value)}`
        }]
      }))
    }
  }));
}

/* ---------- 質問テンプレ ---------- */
const Q1  = ()=> toCarousel('1/10 工事物件の階数は？','q1_floors',[
  {label:'1階建て',value:'1階建て'},
  {label:'2階建て',value:'2階建て'},
  {label:'3階建て',value:'3階建て'},
]);
const Q2  = ()=> toCarousel('2/10 物件の間取りは？','q2_layout',[
  {label:'1K',value:'1K'},{label:'1DK',value:'1DK'},{label:'1LDK',value:'1LDK'},
  {label:'2K',value:'2K'},{label:'2DK',value:'2DK'},{label:'2LDK',value:'2LDK'},
  {label:'3K',value:'3K'},{label:'3DK',value:'3DK'},{label:'3LDK',value:'3LDK'},
  {label:'4K',value:'4K'},{label:'4DK',value:'4DK'},{label:'4LDK',value:'4LDK'},
]);
const Q3  = ()=> toCarousel('3/10 物件の築年数は？','q3_age',[
  {label:'新築',value:'新築',color:'3498db'},
  {label:'〜10年',value:'〜10年'},{label:'〜20年',value:'〜20年'},
  {label:'〜30年',value:'〜30年'},{label:'〜40年',value:'〜40年'},
  {label:'〜50年',value:'〜50年'},{label:'51年以上',value:'51年以上'},
]);
const Q4  = ()=> toCarousel('4/10 過去に塗装をした経歴は？','q4_painted',[
  {label:'ある',value:'ある',color:'2ecc71'},
  {label:'ない',value:'ない',color:'e74c3c'},
  {label:'わからない',value:'わからない',color:'e67e22'},
]);
const Q5  = ()=> toCarousel('5/10 前回の塗装はいつ頃？','q5_last',[
  {label:'〜5年',value:'〜5年'},
  {label:'5〜10年',value:'5〜10年'},
  {label:'10〜20年',value:'10〜20年'},
  {label:'20〜30年',value:'20〜30年'},
  {label:'わからない',value:'わからない'},
]);
const Q6  = ()=> toCarousel('6/10 ご希望の工事内容は？','q6_work',[
  {label:'外壁塗装',value:'外壁塗装'},
  {label:'屋根塗装',value:'屋根塗装'},
  {label:'外壁塗装+屋根塗装',value:'外壁塗装+屋根塗装'},
]);
const Q7  = ()=> toCarousel('7/10 外壁の種類は？','q7_wall',[
  {label:'モルタル',value:'モルタル'},
  {label:'サイディング',value:'サイディング'},
  {label:'タイル',value:'タイル'},
  {label:'ALC',value:'ALC'},
]);
const Q8  = ()=> toCarousel('8/10 屋根の種類は？','q8_roof',[
  {label:'瓦',value:'瓦'},{label:'スレート',value:'スレート'},
  {label:'ガルバリウム',value:'ガルバリウム'},{label:'トタン',value:'トタン'},
]);
const Q9  = ()=> toCarousel('9/10 雨漏りや漏水の症状はありますか？','q9_leak',[
  {label:'雨の日に水滴が落ちる',value:'雨の日に水滴が落ちる'},
  {label:'天井にシミがある',value:'天井にシミがある'},
  {label:'ない',value:'ない'},
]);
const Q10 = ()=> toCarousel('10/10 隣や裏の家との距離は？','q10_dist',[
  {label:'30cm以下',value:'30cm以下'},
  {label:'50cm以下',value:'50cm以下'},
  {label:'70cm以下',value:'70cm以下'},
  {label:'70cm以上',value:'70cm以上'},
]);

/* ---------- 概算計算 ---------- */
function estimateCost(a) {
  const base  = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装+屋根塗装': 900000 };
  const floor = { '1階建て':1.0, '2階建て':1.2, '3階建て':1.4 };
  const layout= { '1K':0.85,'1DK':0.9,'1LDK':0.95,'2K':0.98,'2DK':1.0,'2LDK':1.05,'3K':1.10,'3DK':1.15,'3LDK':1.20,'4K':1.22,'4DK':1.25,'4LDK':1.30 };
  const age   = { '新築':0.9,'〜10年':1.0,'〜20年':1.05,'〜30年':1.10,'〜40年':1.15,'〜50年':1.2,'51年以上':1.25 };
  const wall  = { 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof  = { '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak  = { '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.1,'ない':1.0 };
  const dist  = { '30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.1,'70cm以上':1.0 };

  let cost = base[a.q6_work] || 600000;
  cost *= floor[a.q1_floors] || 1.0;
  cost *= layout[a.q2_layout] || 1.0;
  cost *= age[a.q3_age] || 1.0;
  if (a.q6_work==='外壁塗装' || a.q6_work==='外壁塗装+屋根塗装') cost *= wall[a.q7_wall] || 1.0;
  if (a.q6_work==='屋根塗装' || a.q6_work==='外壁塗装+屋根塗装')  cost *= roof[a.q8_roof] || 1.0;
  cost *= leak[a.q9_leak] || 1.0;
  cost *= dist[a.q10_dist] || 1.0;
  if (a.q4_painted === 'ある') {
    const last = { '〜5年':0.98,'5〜10年':1.0,'10〜20年':1.05,'20〜30年':1.10,'わからない':1.0 };
    cost *= last[a.q5_last] || 1.0;
  }
  return Math.round(cost/1000)*1000;
}
const yen = (n)=> n.toLocaleString('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0});

/* ---------- 次の出題 ---------- */
function nextMessagesFor(s){
  const a=s.answers;
  if (s.step===1)  return [ t('見積もりを開始します。以下の質問にお答えください。'), ...Q1() ];
  if (s.step===2)  return [ ...Q2() ];
  if (s.step===3)  return [ ...Q3() ];
  if (s.step===4)  return [ ...Q4() ];
  if (s.step===5)  return a.q4_painted==='ある' ? [ ...Q5() ] : (s.step=6, nextMessagesFor(s));
  if (s.step===6)  return [ ...Q6() ];
  if (s.step===7)  return (a.q6_work==='外壁塗装' || a.q6_work==='外壁塗装+屋根塗装') ? [ ...Q7() ] : (s.step=8, nextMessagesFor(s));
  if (s.step===8)  return (a.q6_work==='屋根塗装' || a.q6_work==='外壁塗装+屋根塗装')  ? [ ...Q8() ] : (s.step=9, nextMessagesFor(s));
  if (s.step===9)  return [ ...Q9() ];
  if (s.step===10) return [ ...Q10() ];
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
      altText:'概算見積り',
      contents:{
        type:'bubble',
        body:{
          type:'box',layout:'vertical',spacing:'md',contents:[
            {type:'text',text:'見積り金額',weight:'bold',size:'md'},
            {type:'text',text:yen(price),weight:'bold',size:'xl'},
            {type:'text',text:'上記はご入力内容を元に算出した概算です。',wrap:true,size:'sm',color:'#666'}
          ]
        },
        footer:{
          type:'box',layout:'vertical',spacing:'md',contents:[
            {type:'text',text:'正式なお見積りが必要な方は続けてご入力ください。',wrap:true,size:'sm'},
            {type:'button',style:'primary',action:{type:'uri',label:'現地調査なしで見積を依頼',uri:LIFF_BUTTON_URL}}
          ]
        }
      }
    };
    return [ t('ありがとうございます。概算を作成しました。'), t(summary), flex ];
  }
  return [ t('「カンタン見積りを依頼」と送信すると質問を開始します。') ];
}

/* ---------- Google Sheets ---------- */
async function appendToSheet(values){
  if(!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || !GSHEET_SPREADSHEET_ID) return;
  const jwt = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g,'\n'),
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

/* ---------- メール送信（Apps Script） ---------- */
async function sendMailViaAppsScript({ htmlBody, photosBase64=[] }){
  if(!EMAIL_WEBAPP_URL || !EMAIL_TO) return;
  await axios.post(EMAIL_WEBAPP_URL, {
    to: EMAIL_TO, subject:'【外装工事】詳細見積り依頼（LIFF）',
    htmlBody, photosBase64, photoUrls:[]
  }, { timeout: 25000 });
}

/* ---------- LIFF 用API ---------- */
async function getUserIdFromLiffToken(accessToken){
  const resp = await axios.get('https://api.line.me/v2/profile', {
    headers:{ Authorization: `Bearer ${accessToken}` }
  });
  return resp.data?.userId;
}
app.get('/liff/prefill', express.json(), async (req,res)=>{
  try{
    const token = (req.get('Authorization')||'').replace(/^Bearer\s+/,'');
    if(!token) return res.status(401).json({ error:'no token' });
    const userId = await getUserIdFromLiffToken(token);
    if(!userId) return res.status(401).json({ error:'invalid token' });
    const s = sessions.get(userId) || { answers:{} };
    const price = estimateCost(s.answers||{});
    res.json({ answers:s.answers, price, priceYen: yen(price) });
  }catch(e){ console.error('/liff/prefill', e?.response?.data||e); res.status(500).json({ error:'prefill failed' }); }
});
app.post('/liff/submit', express.json({ limit:'25mb' }), async (req,res)=>{
  try{
    const token = (req.get('Authorization')||'').replace(/^Bearer\s+/,'');
    if(!token) return res.status(401).json({ error:'no token' });
    const userId = await getUserIdFromLiffToken(token);
    if(!userId) return res.status(401).json({ error:'invalid token' });

    const s = sessions.get(userId) || { answers:{} };
    const a = s.answers || {};
    const { name, phone, postal, addr1, addr2, photosBase64=[] } = req.body || {};
    const price = estimateCost(a);
    const now = new Date();

    await appendToSheet([
      now.toISOString(), userId, name||'', postal||'', addr1||'', addr2||'',
      a.q1_floors||'', a.q2_layout||'', a.q3_age||'',
      a.q4_painted||'', a.q5_last||'',
      a.q6_work||'', a.q7_wall||'', a.q8_roof||'',
      a.q9_leak||'', a.q10_dist||'',
      photosBase64.length, price
    ]);

    const esc = (x)=> String(x??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    const html = `
      <h2>外装工事 — 詳細見積り依頼（LIFF）</h2>
      <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:system-ui">
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
        <tr><th align="left">受領</th><td>${now.toLocaleString('ja-JP')}</td></tr>
      </table>`;
    await sendMailViaAppsScript({ htmlBody: html, photosBase64 });

    res.json({ ok:true });
  }catch(e){ console.error('/liff/submit', e?.response?.data||e); res.status(500).json({ ok:false }); }
});

/* ---------- Webhook メイン ---------- */
app.post('/webhook', async (req,res)=>{
  const events = req.body.events || [];
  res.sendStatus(200);

  for(const ev of events){
    try{
      if(!ev.source?.userId) continue;
      const uid = ev.source.userId;
      const s   = getState(uid);

      if(ev.type==='follow' || ev.type==='join'){
        reset(uid); const ns=getState(uid); ns.step=1;
        await client.pushMessage(uid, nextMessagesFor(ns));
        continue;
      }

      /* postback（選択 or 停止確認） */
      if(ev.type==='postback'){
        const p = new URLSearchParams(ev.postback.data||'');
        const cmd = p.get('cmd');

        if(cmd === 'stop'){
          const v = p.get('v');
          if(v === 'yes'){ reset(uid); await client.replyMessage(ev.replyToken, t('見積りを停止しました。通常のトークをどうぞ。')); }
          else { await client.replyMessage(ev.replyToken, t('見積りを継続します。')); await client.pushMessage(uid, nextMessagesFor(s)); }
          continue;
        }

        if(cmd === 'answer'){
          const key = p.get('key');     // 例: q1_floors
          const val = p.get('val');     // 例: "2階建て"
          log('POSTBACK answer', key, val, 'STEP', s.step);

          // 値を格納しステップを進める
          s.answers[key] = val;

          if      (key==='q1_floors') s.step=2;
          else if (key==='q2_layout') s.step=3;
          else if (key==='q3_age')    s.step=4;
          else if (key==='q4_painted')s.step=5;
          else if (key==='q5_last')   s.step=6;
          else if (key==='q6_work')   s.step=7;
          else if (key==='q7_wall')   s.step=8;
          else if (key==='q8_roof')   s.step=9;
          else if (key==='q9_leak')   s.step=10;
          else if (key==='q10_dist')  s.step=11;

          // 分岐（Q5/Q7/Q8 をスキップするケース）
          if (s.step===5 && s.answers.q4_painted!=='ある') s.step=6;
          if (s.step===7 && !(s.answers.q6_work==='外壁塗装' || s.answers.q6_work==='外壁塗装+屋根塗装')) s.step=8;
          if (s.step===8 && !(s.answers.q6_work==='屋根塗装'  || s.answers.q6_work==='外壁塗装+屋根塗装'))  s.step=9;

          // 最終は reply 一発で概算＋LIFF
          if(s.step===11){
            await client.replyMessage(ev.replyToken, nextMessagesFor(s));
          }else{
            await client.replyMessage(ev.replyToken, [ t(`「${val}」で承りました。次の質問です。`), ...nextMessagesFor(s) ]);
          }
          continue;
        }

        // それ以外の postback
        await client.replyMessage(ev.replyToken, t('操作が不正です。もう一度お試しください。'));
        continue;
      }

      /* テキストメッセージ：トリガー or 途中発話（停止確認） */
      if(ev.type==='message' && ev.message.type==='text'){
        const text = (ev.message.text||'').trim();
        log('TEXT', text, 'STEP', s.step);

        if(text === 'カンタン見積りを依頼'){
          reset(uid); const ns=getState(uid); ns.step=1;
          await client.replyMessage(ev.replyToken, nextMessagesFor(ns));
          return;
        }

        // 見積り進行中に自由発言 → 停止確認
        if(s.step>0 && s.step<11){
          await client.replyMessage(ev.replyToken, confirmStopTemplate());
          return;
        }
      }

      // 画像/その他：進行中なら停止確認
      if(ev.type==='message' && ev.message.type!=='text' && s.step>0 && s.step<11){
        await client.replyMessage(ev.replyToken, confirmStopTemplate());
      }
    }catch(e){ console.error('event error:', e?.response?.data||e); }
  }
});

/* ---------- 起動 ---------- */
const port = PORT || 10000;
app.listen(port, ()=> console.log(`listening on ${port}`));
