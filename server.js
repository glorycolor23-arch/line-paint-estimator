/**
 * 外壁塗装オンライン相談（安定版）
 * - QAはクイックリプライ（写真＝カメラ/アルバムボタン付き）
 * - 連絡先は【名前→郵便番号→住所1→住所2】で確実に保存
 * - 「詳しい見積もりを依頼する」の誤登録ガード
 * - 質問中は管理者通知なし／最終確定時のみメール＋写真添付
 * - スプレッドシートは最後だけ追記（行構成は下のコメント）
 *
 * 必須環境変数（Render 等）
 *  CHANNEL_SECRET
 *  CHANNEL_ACCESS_TOKEN
 *  SUPABASE_URL
 *  SUPABASE_SERVICE_ROLE_KEY
 *  GOOGLE_SERVICE_ACCOUNT_EMAIL
 *  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 *  GSHEET_SPREADSHEET_ID
 *  GSHEET_SHEET_NAME            // 例: Sheet1（存在しないと自動作成されません）
 *  EMAIL_WEBAPP_URL             // 下のGASをWebアプリ公開したURL
 *  EMAIL_TO                     // 例: matsuo@graphity.co.jp
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import axios from 'axios';
import qs from 'qs';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ───────────────── LINE 基本 ─────────────────
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('CHANNEL_* が未設定です'); process.exit(1);
}
const client = new line.Client(config);
const app = express();
app.use(express.json());

app.get('/health', (_,res)=>res.status(200).send('healthy'));
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body?.events ?? [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error('webhook error:', e?.response?.data || e);
    res.status(200).send('OK'); // エラーでLINEの再送を誘発しない
  }
});
const PORT = process.env.PORT || 10000;
app.listen(PORT,()=>console.log('listening', PORT));

// ──────────────── 外部サービス ────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function appendToSheet(valuesRow) {
  // 行構成:
  // [ A:Timestamp(ISO), B:LINE_USER_ID, C:氏名, D:郵便番号, E:住所1, F:住所2,
  //   G:Q1, H:Q2, I:Q3, J:Q4, K:Q5, L:Q6, M:Q7, N:Q8, O:Q9, P:受領写真枚数, Q:概算金額 ]
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
    requestBody: { values: [valuesRow] },
  });
}

// 管理者メール（Apps Script WebApp 経由／写真添付はWebApp側でダウンロードして添付）
async function sendAdminEmail({ htmlBody, photoUrls = [] }) {
  const url = process.env.EMAIL_WEBAPP_URL;
  const to  = process.env.EMAIL_TO;
  if (!url || !to) return;
  await axios.post(url, { to, subject: '【外壁塗装】最終入力', htmlBody, photoUrls }, { timeout: 20000 });
}

// 郵便番号→住所（ZipCloud）
async function lookupAddr(zip7) {
  try {
    const z = (zip7||'').replace(/[^\d]/g,'');
    if (z.length !== 7) return null;
    const { data } = await axios.get('https://zipcloud.ibsnet.co.jp/api/search',{ params:{ zipcode:z }, timeout: 8000 });
    const r = data?.results?.[0];
    if (!r) return null;
    return `${r.address1}${r.address2}${r.address3}`;
  } catch { return null; }
}

// ──────────────── セッション ────────────────
const sessions = new Map(); // userId → { step, answers, expectingPhoto, photoIndex, photoUrls, contact }

function newSession() {
  return {
    step: 1,
    answers: {},
    expectingPhoto: false,
    photoIndex: -1,
    photoUrls: [],
    contact: { name:'', postal:'', addr1:'', addr2:'' },
  };
}
function getSession(uid){
  if(!sessions.has(uid)) sessions.set(uid, newSession());
  return sessions.get(uid);
}
function resetSession(uid){ sessions.set(uid, newSession()); }

// ──────────────── UI 素材 ────────────────
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
  skip:'https://cdn-icons-png.flaticon.com/512/1828/1828665.png',
};
const PHOTO_STEPS = [
  { key:'front',  label:'外観写真：正面' },
  { key:'right',  label:'外観写真：右側' },
  { key:'left',   label:'外観写真：左側' },
  { key:'back',   label:'外観写真：後ろ側' },
  { key:'damage', label:'損傷箇所（任意）' },
];

// ──────────────── メイン ────────────────
async function handleEvent(event){
  const uid = event.source?.userId;
  if(!uid) return;

  if (event.type === 'follow') {
    resetSession(uid);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n' +
      '外壁・屋根塗装の【かんたん概算見積もり】をご案内します。\n' +
      '「見積もり」または「スタート」と送ってください。');
  }

  // メッセージ
  if (event.type === 'message') {
    const s = getSession(uid);
    if (event.message.type === 'image') {
      if (!s.expectingPhoto) {
        return replyText(event.replyToken, 'ただいま質問中です。ボタンから続きへお進みください。');
      }
      await saveImageToSupabase(uid, event.message.id, s);
      return askNextPhoto(event.replyToken, uid); // 返信内で次の指示を出す
    }

    if (event.message.type === 'text') {
      const raw = (event.message.text || '').trim();
      const normalized = raw.replace(/\s/g,''); // 全角・空白除去

      // グローバル操作
      if (/^(最初から|リセット)$/i.test(raw)) {
        resetSession(uid);
        return replyText(event.replyToken, 'リセットしました。\n「見積もり」または「スタート」と送ってください。');
      }
      // スタートトリガ（見積・見積もり・見積り・スタート・開始 等）
      if (/(見積|ﾐﾂﾓﾘ)/i.test(normalized) || /(スタート|開始|start)/i.test(normalized)) {
        resetSession(uid);
        return askQ1(event.replyToken, uid);
      }
      // 連絡先フロー
      if (s.step === 'contact_name') {
        // ボタン文言の誤登録ガード
        if (/詳しい見積もり?を依頼する/.test(raw)) {
          return replyText(event.replyToken, 'ボタンは不要です。お名前をご入力ください。');
        }
        s.contact.name = raw;
        s.step = 'contact_postal';
        return replyText(event.replyToken, '郵便番号（7桁・ハイフン可）を入力してください');
      }
      if (s.step === 'contact_postal') {
        const z = raw.replace(/[^\d]/g,'').slice(0,7);
        s.contact.postal = z;
        const found = await lookupAddr(z);
        s.contact.addr1 = found || '';
        s.step = 'contact_addr1';
        return replyText(event.replyToken,
          found
           ? `住所候補: 「${found}」\n番地を含めて修正・追記してください。`
           : '住所（都道府県・市区町村・番地など）を入力してください'
        );
      }
      if (s.step === 'contact_addr1') {
        s.contact.addr1 = raw;
        s.step = 'contact_addr2';
        return replyText(event.replyToken, '建物名・部屋番号など（あれば）を入力。無ければ「なし」と入力');
      }
      if (s.step === 'contact_addr2') {
        s.contact.addr2 = (raw === 'なし') ? '' : raw;
        return finalizeAndNotify(event.replyToken, uid);
      }

      // 写真待ち時の補助テキスト
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(raw)) return askNextPhoto(event.replyToken, uid, true);
        if (/^(完了|終了|おわり)$/i.test(raw)) { s.expectingPhoto = false; return askContactIntro(event.replyToken, uid); }
        return replyText(event.replyToken, '画像を送信してください。送れない場合は「スキップ」、全て終えたら「完了」と送ってください。');
      }

      // それ以外
      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。');
    }
    return;
  }

  // ポストバック
  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data);
    const q = Number(data.q);
    const v = data.v;
    const s = getSession(uid);
    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力が読み取れませんでした。もう一度お試しください。');
    }
    s.answers[`q${q}`] = v;

    // Q4: 無い/わからない → Q5スキップ
    if (q === 4 && (v === 'ない' || v === 'わからない')) {
      s.answers.q5 = '該当なし';
      s.step = 6;
      return askQ6(event.replyToken, uid);
    }

    s.step = q + 1;
    switch (s.step) {
      case 2: return askQ2(event.replyToken, uid);
      case 3: return askQ3(event.replyToken, uid);
      case 4: return askQ4(event.replyToken, uid);
      case 5: return askQ5(event.replyToken, uid);
      case 6: return askQ6(event.replyToken, uid);
      case 7: return askQ7(event.replyToken, uid);
      case 8: return askQ8(event.replyToken, uid);
      case 9: return askQ9(event.replyToken, uid);
      case 10: return askQ10_Begin(event.replyToken, uid);
      case 11: return askContactIntro(event.replyToken, uid);
      default: return askContactIntro(event.replyToken, uid);
    }
  }
}

// ──────────────── 質問UI ────────────────
function qr(items){ return { items }; }
function pb(label, data, imageUrl){
  return { type:'action', imageUrl, action:{ type:'postback', label, data, displayText: label } };
}
async function askQ1(rt, uid){
  getSession(uid).step = 1;
  const items = [
    pb('1階建て', qs.stringify({q:1,v:'1階建て'}), ICONS.floor),
    pb('2階建て', qs.stringify({q:1,v:'2階建て'}), ICONS.floor),
    pb('3階建て', qs.stringify({q:1,v:'3階建て'}), ICONS.floor),
  ];
  return client.replyMessage(rt,{ type:'text', text:'1/10 階数を選んでください', quickReply: qr(items) });
}
async function askQ2(rt){ const L=['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  return client.replyMessage(rt,{ type:'text', text:'2/10 間取りを選んでください', quickReply: qr(L.map(v=>pb(v,qs.stringify({q:2,v}),ICONS.layout))) }); }
async function askQ3(rt){ const A=[
  pb('外壁塗装',qs.stringify({q:3,v:'外壁塗装'}),ICONS.paint),
  pb('屋根塗装',qs.stringify({q:3,v:'屋根塗装'}),ICONS.paint),
  pb('外壁＋屋根',qs.stringify({q:3,v:'外壁塗装＋屋根塗装'}),ICONS.paint),
]; return client.replyMessage(rt,{ type:'text', text:'3/10 希望する工事内容を選んでください', quickReply: qr(A) }); }
async function askQ4(rt){ const A=[
  pb('ある',qs.stringify({q:4,v:'ある'}),ICONS.yes),
  pb('ない',qs.stringify({q:4,v:'ない'}),ICONS.no),
  pb('わからない',qs.stringify({q:4,v:'わからない'}),ICONS.no),
]; return client.replyMessage(rt,{ type:'text', text:'4/10 これまで外壁塗装をしたことはありますか？', quickReply: qr(A) }); }
async function askQ5(rt){ const L=['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  return client.replyMessage(rt,{ type:'text', text:'5/10 前回の外壁塗装からどれくらい？', quickReply: qr(L.map(v=>pb(v,qs.stringify({q:5,v}),ICONS.years))) }); }
async function askQ6(rt){ const L=['モルタル','サイディング','タイル','ALC'];
  return client.replyMessage(rt,{ type:'text', text:'6/10 外壁の種類は？', quickReply: qr(L.map(v=>pb(v,qs.stringify({q:6,v}),ICONS.wall))) }); }
async function askQ7(rt){ const L=['瓦','スレート','ガルバリウム','トタン'];
  return client.replyMessage(rt,{ type:'text', text:'7/10 屋根の種類は？', quickReply: qr(L.map(v=>pb(v,qs.stringify({q:7,v}),ICONS.roof))) }); }
async function askQ8(rt){ const L=['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'];
  return client.replyMessage(rt,{ type:'text', text:'8/10 雨漏りの状況は？', quickReply: qr(L.map(v=>pb(v,qs.stringify({q:8,v}),ICONS.leak))) }); }
async function askQ9(rt){ const L=['30cm以下','50cm以下','70cm以下','70cm以上'];
  return client.replyMessage(rt,{ type:'text', text:'9/10 周辺との最短距離（足場の目安）', quickReply: qr(L.map(v=>pb(v,qs.stringify({q:9,v}),ICONS.distance))) }); }

// 写真開始
async function askQ10_Begin(rt, uid){
  const s = getSession(uid);
  s.expectingPhoto = true;
  s.photoIndex = -1; // ここから0に上げる
  return askNextPhoto(rt, uid);
}
async function askNextPhoto(rt, uid, skipped=false){
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
    text:`10/10 写真アップロード\n「${cur.label}」を送ってください。\n（送れない場合は「スキップ」、全て終えたら「完了」）`,
    quickReply: { items }
  });
}

// 連絡先（名前から）
async function askContactIntro(rt, uid){
  const s = getSession(uid);
  const a = s.answers;
  const est = estimateCost(a);
  // 先に状態をセット（このメッセージ自体を名前として誤登録しないため）
  s.step = 'contact_name';
  await client.replyMessage(rt, [
    { type:'text', text: summaryText(a, s.photoUrls.length) },
    { type:'text', text:`概算金額：${yen(est)}\n\n正式見積もりのため、まず「お名前」を入力してください。` }
  ]);
}

// 画像保存
async function streamToBuffer(stream){
  return new Promise((resolve,reject)=>{
    const bufs=[]; stream.on('data',c=>bufs.push(c));
    stream.on('end',()=>resolve(Buffer.concat(bufs)));
    stream.on('error',reject);
  });
}
async function saveImageToSupabase(uid, msgId, s){
  const stream = await client.getMessageContent(msgId);
  const buf = await streamToBuffer(stream);
  const name = `${PHOTO_STEPS[s.photoIndex]?.key || 'photo'}_${Date.now()}.jpg`;
  const path = `line/${uid}/${name}`;
  const { error } = await supabase.storage.from('photos').upload(path, buf, { contentType:'image/jpeg', upsert:true });
  if (error) throw error;
  const { data:pub } = supabase.storage.from('photos').getPublicUrl(path);
  const url = pub?.publicUrl; if (url) s.photoUrls.push(url);
}

// 見積り・最終確定
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
  cost *= wall[a.q6] || 1.0;
  cost *= leak[a.q8] || 1.0;
  cost *= dist[a.q9] || 1.0;
  if (a.q3==='屋根塗装' || a.q3==='外壁塗装＋屋根塗装') cost *= roof[a.q7] || 1.0;
  if (a.q4==='ある') cost *= years[a.q5] || 1.0;
  return Math.round(cost/1000)*1000;
}
function yen(n){ return n.toLocaleString('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}); }
function summaryText(a, cnt){
  return [
    '【回答の確認】',
    `・階数: ${a.q1||'-'} / 間取り: ${a.q2||'-'} / 工事: ${a.q3||'-'}`,
    `・過去塗装: ${a.q4||'-'} / 前回から: ${a.q5||'該当なし'}`,
    `・外壁: ${a.q6||'-'} / 屋根: ${a.q7||'-'} / 雨漏り: ${a.q8||'-'}`,
    `・最短距離: ${a.q9||'-'} / 受領写真: ${cnt}枚`
  ].join('\n');
}

async function finalizeAndNotify(rt, uid){
  const s = getSession(uid), a = s.answers;
  const est = estimateCost(a);
  const now = new Date();

  // スプレッドシート（列順ガチ固定）
  const row = [
    now.toISOString(), uid,
    s.contact.name, s.contact.postal, s.contact.addr1, s.contact.addr2,
    a.q1||'', a.q2||'', a.q3||'', a.q4||'', a.q5||'',
    a.q6||'', a.q7||'', a.q8||'', a.q9||'',
    s.photoUrls.length, est
  ];
  try { await appendToSheet(row); } catch(e){ console.error('sheet:', e?.response?.data || e); }

  // 管理者メール（写真はWebAppで添付）
  const html = `
    <div style="font-family:system-ui,Segoe UI,Helvetica,Arial">
      <h3>外壁塗装 — 最終入力</h3>
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
    </div>`;
  try { await sendAdminEmail({ htmlBody: html, photoUrls: s.photoUrls }); } catch(e){ console.error('mail:', e?.response?.data || e); }

  // ユーザーへ完了通知（友だち追加ボタンは出さない）
  await client.replyMessage(rt, { type:'text', text:'ありがとうございます。内容を受け付けました。1営業日以内に担当者がこのLINEでご連絡します。' });

  resetSession(uid);
}

function esc(x){ return String(x??'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[m])); }
function replyText(rt, text){ return client.replyMessage(rt, { type:'text', text }); }
