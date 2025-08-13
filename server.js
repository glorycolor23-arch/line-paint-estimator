/**
 * 外壁塗装 見積もりBot（画像カード版＋分岐／通知最小化／リッチメニュー制御）
 * - 質問は全て Flex の画像カード（postback）→ 管理者通知が来にくい
 * - 分岐：外壁のみ→Q6のみ／屋根のみ→Q7のみ／外壁＋屋根→Q6→Q7
 * - 住所入力時の安心文言、郵便番号の自動補完（zipcloud）
 * - 連絡先入力開始でリッチメニューを一時的に非表示（完了時に再表示可）
 * - 写真は Supabase Storage（photos バケット）
 * - 最終確定のみ スプレッドシート＋メール送信（GAS WebApp、写真添付）
 *
 * 必要環境変数：
 *  CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN
 *  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *  GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 *  GSHEET_SPREADSHEET_ID / GSHEET_SHEET_NAME
 *  EMAIL_TO / EMAIL_WEBAPP_URL
 *  RICH_MENU_ID                // 任意：完了時に再リンクするリッチメニューID
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import axios from 'axios';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ───────────────────────────────── LINE 基本 ─────────────────────────────────
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('CHANNEL_* 未設定'); process.exit(1);
}
const client = new line.Client(config);
const app = express(); // ※ express.json() は付けない（署名検証へ影響させない）

app.get('/health', (_,res)=>res.status(200).send('healthy'));
app.post('/webhook', line.middleware(config), async (req,res)=>{
  try{
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  }catch(e){
    console.error('webhook error:', e?.response?.data || e);
    res.status(200).end(); // 再送防止
  }
});
const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=>console.log('listening', PORT));

// ──────────────────────────────── 外部サービス ────────────────────────────────
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function appendToSheet(valuesRow){
  const jwt = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY||'').replace(/\\n/g,'\n'),
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
    requestBody: { values: [valuesRow] }
  });
}
async function sendAdminEmail({ htmlBody, photoUrls=[] }){
  const url = process.env.EMAIL_WEBAPP_URL;
  const to  = process.env.EMAIL_TO;
  if(!url || !to) return;
  await axios.post(url, { to, subject:'【外壁塗装】最終入力', htmlBody, photoUrls }, { timeout: 20000 });
}
async function lookupAddr(zip7){
  try{
    const z = (zip7||'').replace(/[^\d]/g,'');
    if(z.length!==7) return null;
    const { data } = await axios.get('https://zipcloud.ibsnet.co.jp/api/search',{ params:{ zipcode:z }, timeout: 8000 });
    const r = data?.results?.[0];
    if(!r) return null;
    return `${r.address1}${r.address2}${r.address3}`;
  }catch{ return null; }
}

// ──────────────────────────────── セッション ────────────────────────────────
const sessions = new Map(); // userId → state
function newSession(){
  return {
    step: 1,
    answers: {},
    expectingPhoto: false,
    photoIndex: -1,
    photoUrls: [],
    contact: { name:'', postal:'', addr1:'', addr2:'' },
  };
}
function getSession(uid){ if(!sessions.has(uid)) sessions.set(uid, newSession()); return sessions.get(uid); }
function resetSession(uid){ sessions.set(uid, newSession()); }

// ──────────────────────────────── 素材 ────────────────────────────────
const ICONS = {
  floor:'https://cdn-icons-png.flaticon.com/512/8911/8911331.png',
  layout:'https://cdn-icons-png.flaticon.com/512/9193/9193091.png',
  paint:'https://cdn-icons-png.flaticon.com/512/992/992703.png',
  yes:'https://cdn-icons-png.flaticon.com/512/5610/5610944.png',
  no:'https://cdn-icons-png.flaticon.com/512/463/463612.png',
  years:'https://cdn-icons-png.flaticon.com/512/1827/1827370.png',
  wall:'https://cdn-icons-png.flaticon.com/512/2992/2992653.png',
  roof:'https://cdn-icons-png.flaticon.com/512/2933/2933922.png',
  leak:'https://cdn-icons-png.flaticon.com/512/415/415734.png',
  distance:'https://cdn-icons-png.flaticon.com/512/535/535285.png',
  camera:'https://cdn-icons-png.flaticon.com/512/685/685655.png',
  card:'https://images.unsplash.com/photo-1505691938895-1758d7feb511?q=80&w=1200&auto=format&fit=crop', // 汎用カード画像
};
const PHOTO_STEPS = [
  { key:'front',  label:'外観写真：正面' },
  { key:'right',  label:'外観写真：右側' },
  { key:'left',   label:'外観写真：左側' },
  { key:'back',   label:'外観写真：後ろ側' },
  { key:'damage', label:'損傷箇所（任意）' },
];

// ──────────────────────────────── ユーティリティ ────────────────────────────────
const START_WORDS = ['見積もり','見積り','見積','スタート','開始','start'];
const RESET_WORDS = ['リセット','最初から','やり直し','reset'];
const isStart = t => START_WORDS.some(w => (t||'').replace(/\s+/g,'').includes(w));
const isReset = t => RESET_WORDS.some(w => (t||'').replace(/\s+/g,'').includes(w));
const replyText = (rt, text) => client.replyMessage(rt, { type:'text', text });
const esc = s => String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const yen = n => n.toLocaleString('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0});

// リッチメニュー制御
async function hideRichMenu(uid){ try{ await client.unlinkRichMenuFromUser(uid); }catch{} }
async function showRichMenu(uid){
  const id = process.env.RICH_MENU_ID;
  if(!id) return;
  try{ await client.linkRichMenuToUser(uid, id); }catch{}
}

// Flexカード（画像＋ボタン）
function buildCard(title, imageUrl, actionLabel, data){
  return {
    type:'bubble',
    hero:{ type:'image', url:imageUrl||ICONS.card, size:'full', aspectRatio:'16:9', aspectMode:'cover' },
    body:{ type:'box', layout:'vertical', spacing:'sm', contents:[
      { type:'text', text:title, weight:'bold', wrap:true }
    ]},
    footer:{ type:'box', layout:'vertical', contents:[
      { type:'button', style:'primary', action:{ type:'postback', label: actionLabel, data, displayText: actionLabel } }
    ]}
  };
}
function sendCardChoices(replyToken, headline, cards){
  const chunks = [];
  for (let i=0;i<cards.length;i+=10) chunks.push(cards.slice(i,i+10));
  const msgs = chunks.map(group => ({
    type:'flex',
    altText: headline,
    contents: { type:'carousel', contents: group }
  }));
  msgs.unshift({ type:'text', text: headline });
  return client.replyMessage(replyToken, msgs);
}

// ──────────────────────────────── メイン ────────────────────────────────
async function handleEvent(event){
  const uid = event.source?.userId;
  if(!uid) return;

  if(event.type==='follow'){
    resetSession(uid);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n' +
      '外壁・屋根塗装の【かんたん概算見積もり】をご案内します。\n' +
      '「見積もり」または「スタート」と送ってください。');
  }

  if(event.type==='message'){
    const s = getSession(uid);
    const m = event.message;

    if(m.type==='text'){
      const text = (m.text||'').trim();

      if(isReset(text)){ resetSession(uid); return replyText(event.replyToken,'リセットしました。「見積もり」または「スタート」と送ってください。'); }

      // 連絡先ステップ
      if(s.step==='contact_name'){
        s.contact.name = text;
        s.step = 'contact_postal';
        return replyText(event.replyToken, '郵便番号（7桁・数字のみ／例: 1234567）をご入力ください。\n\n※お住まいの区画を確認するためのご入力です。現地調査や営業訪問は致しませんのでご安心ください。');
      }
      if(s.step==='contact_postal'){
        const z = text.replace(/[^\d]/g,'').slice(0,7);
        s.contact.postal = z;
        const found = await lookupAddr(z);
        if(found){
          s.contact.addr1 = found;
          s.step = 'contact_addr2';
          return replyText(event.replyToken,
            `住所を自動入力しました：\n${found}\n\n` +
            '番地など以降の住所や建物名・部屋番号などを入力してください。無ければ「なし」を入力してください。\n\n' +
            '※お住まいの区画を確認するためのご入力です。現地調査や営業訪問は致しません。');
        }
        s.step = 'contact_addr1';
        return replyText(event.replyToken,
          '住所（都道府県・市区町村・番地など）を入力してください。\n\n' +
          '※お住まいの区画を確認するためのご入力です。現地調査や営業訪問は致しませんのでご安心ください。');
      }
      if(s.step==='contact_addr1'){
        s.contact.addr1 = text;
        s.step = 'contact_addr2';
        return replyText(event.replyToken, '番地など以降の住所や建物名・部屋番号などを入力してください。無ければ「なし」を入力してください。');
      }
      if(s.step==='contact_addr2'){
        s.contact.addr2 = (text==='なし')?'':text;
        return finalizeAndNotify(event.replyToken, uid);
      }

      // 写真待ち（スキップ/完了）
      if(s.expectingPhoto){
        if(/^スキップ$/i.test(text)) return askNextPhoto(event.replyToken, uid, true);
        if(/^(完了|終了|おわり)$/i.test(text)){ s.photoIndex = PHOTO_STEPS.length-1; return askNextPhoto(event.replyToken, uid, false); }
        return replyText(event.replyToken,'画像を送信してください。送れない場合は「スキップ」、全て終えたら「完了」と送ってください。');
      }

      // 見積もり開始
      if(isStart(text)){ resetSession(uid); return askQ1(event.replyToken, uid); }

      return replyText(event.replyToken,'「見積もり」または「スタート」と送ってください。');
    }

    if(m.type==='image'){
      if(!s.expectingPhoto){ return replyText(event.replyToken,'ありがとうございます。いま質問中です。ボタンで続きに進んでください。'); }
      saveImageToSupabase(uid, m.id, s).catch(e=>console.error('saveImage', e));
      return askNextPhoto(event.replyToken, uid, false);
    }
    return;
  }

  if(event.type==='postback'){
    const data = qs.parse(event.postback.data || '');
    const s = getSession(uid);

    // 連絡先開始（リッチメニューを隠す）
    if(data.contact==='start'){
      s.step='contact_name';
      await hideRichMenu(uid);
      return replyText(event.replyToken, 'お名前をご入力ください（フルネーム）');
    }

    // 通常QA
    const q = Number(data.q);
    const v = data.v;
    if(!q || typeof v==='undefined'){ return replyText(event.replyToken,'入力を受け取れませんでした。もう一度お試しください。'); }
    s.answers[`q${q}`] = v;

    // Q4が「ない／わからない」→ Q5スキップ
    if(q===4 && (v==='ない' || v==='わからない')){
      s.answers.q5 = '該当なし';
      return routeAfterQ5(event.replyToken, uid); // Q5をスキップした扱いで次へ
    }

    // 次の質問へ
    return routeNext(event.replyToken, uid, q);
  }
}

// ──────────────────────────────── 質問（Flexカード） ────────────────────────────────
function buildChoices(headline, list, img, qnum){
  const cards = list.map(v => buildCard(v, img, v, qs.stringify({q:qnum, v})));
  return { headline, cards };
}

async function askQ1(rt, uid){
  getSession(uid).step = 1;
  const { headline, cards } = buildChoices('1/10 住宅の階数を選んでください', ['1階建て','2階建て','3階建て'], ICONS.floor, 1);
  return sendCardChoices(rt, headline, cards);
}
async function askQ2(rt){
  const { headline, cards } = buildChoices('2/10 住宅の間取りを選んでください', ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'], ICONS.layout, 2);
  return sendCardChoices(rt, headline, cards);
}
async function askQ3(rt){
  const cards = [
    buildCard('外壁塗装', ICONS.paint, '外壁塗装', qs.stringify({q:3,v:'外壁塗装'})),
    buildCard('屋根塗装', ICONS.paint, '屋根塗装', qs.stringify({q:3,v:'屋根塗装'})),
    buildCard('外壁塗装＋屋根塗装', ICONS.paint, '外壁塗装＋屋根塗装', qs.stringify({q:3,v:'外壁塗装＋屋根塗装'})),
  ];
  return sendCardChoices(rt, '3/10 希望する工事内容を選んでください', cards);
}
async function askQ4(rt){
  const cards = [
    buildCard('これまで外壁塗装をしたことがある', ICONS.yes, 'ある', qs.stringify({q:4,v:'ある'})),
    buildCard('これまで外壁塗装をしたことはない', ICONS.no,  'ない', qs.stringify({q:4,v:'ない'})),
    buildCard('わからない', ICONS.no, 'わからない', qs.stringify({q:4,v:'わからない'})),
  ];
  return sendCardChoices(rt, '4/10 これまで外壁塗装をしたことはありますか？', cards);
}
async function askQ5(rt){
  const { headline, cards } = buildChoices('5/10 前回の外壁塗装からどれくらい経っていますか？', ['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'], ICONS.years, 5);
  return sendCardChoices(rt, headline, cards);
}
async function askQ6(rt){ // 外壁
  const { headline, cards } = buildChoices('6/10 外壁の種類を選んでください', ['モルタル','サイディング','タイル','ALC'], ICONS.wall, 6);
  return sendCardChoices(rt, headline, cards);
}
async function askQ7(rt){ // 屋根
  const { headline, cards } = buildChoices('7/10 屋根の種類を選んでください', ['瓦','スレート','ガルバリウム','トタン'], ICONS.roof, 7);
  return sendCardChoices(rt, headline, cards);
}
async function askQ8(rt){
  const { headline, cards } = buildChoices('8/10 雨漏りの状況を選んでください', ['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'], ICONS.leak, 8);
  return sendCardChoices(rt, headline, cards);
}
async function askQ9(rt){
  const { headline, cards } = buildChoices('9/10 周辺との最短距離を選んでください（足場の目安）', ['30cm以下','50cm以下','70cm以下','70cm以上'], ICONS.distance, 9);
  return sendCardChoices(rt, headline, cards);
}

async function askQ10_Begin(rt, uid){
  const s = getSession(uid);
  s.expectingPhoto = true;
  s.photoIndex = -1;
  return askNextPhoto(rt, uid, false);
}
async function askNextPhoto(rt, uid, skipped){
  const s = getSession(uid);
  s.photoIndex += 1;
  if(s.photoIndex >= PHOTO_STEPS.length){
    s.expectingPhoto = false;
    return askContact(rt, uid);
  }
  const cur = PHOTO_STEPS[s.photoIndex];
  const items = [
    { type:'action', imageUrl:ICONS.camera, action:{ type:'camera',     label:'カメラを起動' } },
    { type:'action', imageUrl:ICONS.camera, action:{ type:'cameraRoll', label:'アルバムから' } },
    { type:'action', imageUrl:ICONS.no,     action:{ type:'message',    label:'スキップ', text:'スキップ' } },
    { type:'action', imageUrl:ICONS.yes,    action:{ type:'message',    label:'完了',     text:'完了' } },
  ];
  const text = `10/10 写真アップロード\n「${cur.label}」を送ってください。\n（出ない端末では左下の「＋」から送信してください）`;
  return client.replyMessage(rt, { type:'text', text, quickReply:{ items } });
}

// 分岐制御
async function routeNext(rt, uid, justQ){
  const s = getSession(uid);
  const work = s.answers.q3; // 外壁塗装 / 屋根塗装 / 外壁塗装＋屋根塗装

  switch(justQ){
    case 1: return askQ2(rt);
    case 2: return askQ3(rt);
    case 3: return askQ4(rt);
    case 4: // 「ある」はここに来るので Q5 へ
      return askQ5(rt);
    case 5: // workに応じて外壁/屋根へ
      return routeAfterQ5(rt, uid);
    case 6: // 外壁回答後
      if(work==='外壁塗装＋屋根塗装') return askQ7(rt); // 両方 → 屋根へ
      return askQ8(rt); // 外壁のみ → 8へ
    case 7: // 屋根回答後
      return askQ8(rt);
    case 8: return askQ9(rt);
    case 9: return askQ10_Begin(rt, uid);
    default: return askContact(rt, uid);
  }
}
async function routeAfterQ5(rt, uid){
  const s = getSession(uid);
  const work = s.answers.q3;
  if(work==='外壁塗装') return askQ6(rt);
  if(work==='屋根塗装') return askQ7(rt);
  return askQ6(rt); // 外壁＋屋根 → まず外壁、次にQ7で屋根へ
}

// 連絡先導線（Flex／文言追加）
async function askContact(rt, uid){
  const s = getSession(uid);
  const a = s.answers;
  const estimate = estimateCost(a);
  const count = s.photoUrls.length;

  s.step = 'contact_name';

  await client.replyMessage(rt, [
    { type:'text', text: summaryText(a, count) },
    {
      type:'flex',
      altText:'詳しい見積もりをご希望の方へ',
      contents:{
        type:'bubble',
        body:{ type:'box', layout:'vertical', spacing:'md', contents:[
          { type:'text', text:'詳しい見積もりをご希望の方へ', weight:'bold', wrap:true },
          { type:'text', text:'現地調査なしで、詳細な見積りをLINEでお知らせします。', wrap:true, size:'sm' },
          { type:'text', text:`概算金額：${yen(estimate)}\nこのまま連絡先をご入力ください。`, wrap:true }
        ]},
        footer:{ type:'box', layout:'vertical', contents:[
          { type:'button', style:'primary', action:{ type:'postback', label:'連絡先を入力する', data:'contact=start', displayText:'連絡先を入力する' } }
        ]}
      }
    }
  ]);
}

// ──────────────────────────────── 保存／見積り ────────────────────────────────
async function streamToBuffer(stream){
  return new Promise((resolve,reject)=>{
    const bufs=[]; stream.on('data',c=>bufs.push(c));
    stream.on('end',()=>resolve(Buffer.concat(bufs)));
    stream.on('error',reject);
  });
}
async function saveImageToSupabase(uid, messageId, s){
  const stream = await client.getMessageContent(messageId);
  const buf = await streamToBuffer(stream);
  const name = PHOTO_STEPS[s.photoIndex]?.key || `photo${s.photoIndex}`;
  const filename = `${name}_${Date.now()}.jpg`;
  const filepath = `line/${uid}/${filename}`;
  const { error } = await supabase.storage.from('photos').upload(filepath, buf, { contentType:'image/jpeg', upsert:true });
  if(error) throw error;
  const { data:pub } = supabase.storage.from('photos').getPublicUrl(filepath);
  if(pub?.publicUrl) s.photoUrls.push(pub.publicUrl);
}

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
  if (a.q3!=='屋根塗装') cost *= wall[a.q6] || 1.0; // 外壁がある時のみ
  if (a.q3!=='外壁塗装') cost *= roof[a.q7] || 1.0; // 屋根がある時のみ
  cost *= leak[a.q8] || 1.0;
  cost *= dist[a.q9] || 1.0;
  if (a.q4==='ある') cost *= years[a.q5] || 1.0;
  return Math.round(cost/1000)*1000;
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

async function finalizeAndNotify(rt, uid){
  const s = getSession(uid), a = s.answers;
  const est = estimateCost(a);
  const now = new Date();

  // スプレッドシート（列順固定）
  const row = [
    now.toISOString(), uid,
    s.contact.name, s.contact.postal, s.contact.addr1, s.contact.addr2,
    a.q1||'', a.q2||'', a.q3||'', a.q4||'', a.q5||'',
    a.q6||'', a.q7||'', a.q8||'', a.q9||'',
    s.photoUrls.length, est
  ];
  try{ await appendToSheet(row); }catch(e){ console.error('sheet', e?.response?.data || e); }

  // 管理者メール
  const html = `
  <div style="font-family:system-ui,Segoe UI,Helvetica,Arial">
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
      <tr><th align="left">受領写真</th><td>${s.photoUrls.length} 枚</td></tr>
      <tr><th align="left">概算金額</th><td>${esc(yen(est))}</td></tr>
      <tr><th align="left">タイムスタンプ</th><td>${now.toLocaleString('ja-JP')}</td></tr>
    </table>
    ${s.photoUrls?.length ? `<p>写真リンク：</p><ol>${s.photoUrls.map(u=>`<li><a href="${u}">${u}</a></li>`).join('')}</ol>`:''}
  </div>`;
  try{ await sendAdminEmail({ htmlBody: html, photoUrls: s.photoUrls }); }catch(e){ console.error('mail', e?.response?.data || e); }

  // 完了カード（目立つメッセージ）
  await client.replyMessage(rt, {
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

  // リッチメニューを再表示（任意）
  await showRichMenu(uid);

  resetSession(uid);
}
