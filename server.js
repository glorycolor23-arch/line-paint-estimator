// server.js
// ────────────────────────────────────────────────────────────
// 外壁塗装 見積もりBot + LIFF 連携（Render 用）
//  - LINE: 質問フロー / 画像保存(Supabase) / 最終でGSHEET & メール送信
//  - LIFF: 連絡先入力フォーム（/liff/index.html）
//  - 静的配信: /liff/* を配信, /liff/env.js を動的生成
// 環境変数（Render -> Environment）:
//   CHANNEL_SECRET
//   CHANNEL_ACCESS_TOKEN
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   ← 改行は \n ではなく原文でOK（下の replace で対応）
//   GSHEET_SPREADSHEET_ID
//   GSHEET_SHEET_NAME                    ← 例: Sheet1
//   EMAIL_TO                             ← 例: matsuo@graphity.co.jp
//   EMAIL_WEBAPP_URL                     ← Google Apps Script のWebApp URL
//   PUBLIC_BASE_URL                      ← 例: https://line-paint.onrender.com
//   LIFF_ID                              ← 例: 2007914959-XXXXXXXX
//   FRIEND_ADD_URL                       ← 友だち追加URL（必要なら）
// ────────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import axios from 'axios';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

// ------------------------------------------------------------------
// 基本セットアップ
// ------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// LINE 設定
const lineConfig = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!lineConfig.channelSecret || !lineConfig.channelAccessToken) {
  console.error('CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です。');
  process.exit(1);
}
const lineClient = new line.Client(lineConfig);

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ────────────────────────────────────────────────────────────
// 便利関数: Google Sheets 追記 / 管理者メール送信
// ────────────────────────────────────────────────────────────
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

async function sendAdminEmail({ htmlBody, photoUrls = [] }) {
  const endpoint = process.env.EMAIL_WEBAPP_URL;
  const to = process.env.EMAIL_TO;
  if (!endpoint || !to) {
    console.warn('EMAIL_WEBAPP_URL または EMAIL_TO が未設定のため、メール送信をスキップします。');
    return;
  }
  await axios.post(
    endpoint,
    {
      to,
      subject: '【外壁塗装】最終入力（概算＋回答＋写真）',
      htmlBody,
      photoUrls,
    },
    { timeout: 15000 }
  );
}

// ────────────────────────────────────────────────────────────
/** セッション（プロセス内） */
// ────────────────────────────────────────────────────────────
const sessions = new Map(); // userId → { step, answers, expectingPhoto, photoIndex, photoUrls }

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 1,
      answers: {},
      expectingPhoto: false,
      photoIndex: -1, // 次の askNextPhoto() で 0 から始める
      photoUrls: [],
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
  });
}

// ────────────────────────────────────────────────────────────
// LIFF 静的配信 & env.js
// ────────────────────────────────────────────────────────────
app.use('/liff', express.static(path.join(__dirname, 'liff')));

// LIFF ページが読み込む環境変数JS（/liff/env.js）
app.get('/liff/env.js', (req, res) => {
  const js = `
    window.ENV = {
      LIFF_ID: ${JSON.stringify(process.env.LIFF_ID || '')},
      API_BASE: ${JSON.stringify(process.env.PUBLIC_BASE_URL || '')}
    };
  `.trim();
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.send(js);
});

// LIFF 送信API（フォームから最終送信）
app.use(express.json());
app.post('/api/liff/submit', async (req, res) => {
  try {
    const {
      userId,
      name,
      postal,
      addr1,
      addr2,
    } = req.body || {};

    if (!userId) return res.status(400).json({ ok: false, error: 'userId is required' });

    const s = getSession(userId);
    const a = s.answers || {};
    const est = estimateCost(a);
    const now = new Date();

    // スプレッドシート追記
    const row = [
      now.toISOString(),
      userId,
      name || '',
      postal || '',
      addr1 || '',
      addr2 || '',
      a.q1 || '',
      a.q2 || '',
      a.q3 || '',
      a.q4 || '',
      a.q5 || '',
      a.q6 || '',
      a.q7 || '',
      a.q8 || '',
      a.q9 || '',
      s.photoUrls.length,
      est,
    ];
    try {
      await appendToSheet(row);
    } catch (e) {
      console.error('appendToSheet error:', e?.response?.data || e);
    }

    // 管理者メール
    const html = `
      <div style="font-family:system-ui,Segoe UI,Helvetica,Arial">
        <h2>外壁塗装 — 最終入力</h2>
        <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
          <tr><th align="left">LINEユーザーID</th><td>${esc(userId)}</td></tr>
          <tr><th align="left">お名前</th><td>${esc(name)}</td></tr>
          <tr><th align="left">郵便番号</th><td>${esc(postal)}</td></tr>
          <tr><th align="left">住所1</th><td>${esc(addr1)}</td></tr>
          <tr><th align="left">住所2</th><td>${esc(addr2)}</td></tr>
          <tr><th align="left">階数</th><td>${esc(a.q1 || '')}</td></tr>
          <tr><th align="left">間取り</th><td>${esc(a.q2 || '')}</td></tr>
          <tr><th align="left">工事内容</th><td>${esc(a.q3 || '')}</td></tr>
          <tr><th align="left">過去塗装</th><td>${esc(a.q4 || '')}</td></tr>
          <tr><th align="left">前回から</th><td>${esc(a.q5 || '')}</td></tr>
          <tr><th align="left">外壁</th><td>${esc(a.q6 || '')}</td></tr>
          <tr><th align="left">屋根</th><td>${esc(a.q7 || '')}</td></tr>
          <tr><th align="left">雨漏り</th><td>${esc(a.q8 || '')}</td></tr>
          <tr><th align="left">距離</th><td>${esc(a.q9 || '')}</td></tr>
          <tr><th align="left">受領写真</th><td>${s.photoUrls.length} 枚</td></tr>
          <tr><th align="left">概算金額</th><td>${esc(yen(est))}</td></tr>
          <tr><th align="left">タイムスタンプ</th><td>${now.toLocaleString('ja-JP')}</td></tr>
        </table>
        ${s.photoUrls?.length ? `<p>写真リンク：</p><ol>${s.photoUrls.map(u=>`<li><a href="${u}">${u}</a></li>`).join('')}</ol>`:''}
      </div>
    `;
    try {
      await sendAdminEmail({ htmlBody: html, photoUrls: s.photoUrls });
    } catch (e) {
      console.error('sendAdminEmail error:', e?.response?.data || e);
    }

    // ユーザーへ確定通知（Push）
    await lineClient.pushMessage(userId, [
      {
        type: 'text',
        text:
          'お見積りのご依頼ありがとうございます。送信された内容を確認し、1〜2営業日程度で詳細なお見積りをLINEでご返信致します。',
      },
    ]);

    // セッションリセット
    resetSession(userId);

    res.json({ ok: true });
  } catch (err) {
    console.error('/api/liff/submit error:', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

// ヘルスチェック
app.get('/health', (_, res) => res.status(200).send('healthy'));

// ------------------------------------------------------------------
// LINE Webhook
// ------------------------------------------------------------------
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).send('Error');
  }
});

// メインハンドラ
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // 友だち追加
  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n' +
      '外壁・屋根塗装の【かんたん概算見積もり】をご案内します。\n' +
      '「見積もり」または「スタート」と送ってください。'
    );
  }

  // メッセージ
  if (event.type === 'message') {
    const msg = event.message;
    if (msg.type === 'text') {
      const text = (msg.text || '').trim();
      if (/^(最初から|リセット)$/i.test(text)) {
        resetSession(userId);
        return replyText(event.replyToken, '回答をリセットしました。\n「見積もり」または「スタート」と送ってください。');
      }
      if (/^(見積もり|スタート|start)$/i.test(text)) {
        resetSession(userId);
        return askQ1(event.replyToken, userId);
      }

      const s = getSession(userId);
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(text)) {
          return askNextPhoto(event.replyToken, userId, true);
        }
        if (/^(完了|終了|おわり)$/i.test(text)) {
          s.expectingPhoto = false;
          return askContact(event.replyToken, userId);
        }
        return replyText(event.replyToken, '画像を送ってください。スキップは「スキップ」、すべて終えたら「完了」と送信できます。');
      }

      // LIFF へ誘導した後の追加テキストにも対応
      if (/^(詳しい見積もりを依頼する)$/i.test(text)) {
        return askContact(event.replyToken, userId);
      }

      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。');
    }

    if (msg.type === 'image') {
      const s = getSession(userId);
      if (!s.expectingPhoto) {
        return replyText(event.replyToken, 'ありがとうございます。いま質問中です。ボタンから続きにお進みください。');
      }
      // 非同期保存（返信を待たせない）
      saveImageToSupabase(userId, msg.id).catch(e => console.error('saveImageToSupabase:', e));
      return askNextPhoto(event.replyToken, userId, false);
    }

    return;
  }

  // Postback（ボタン）
  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data || '');
    const s = getSession(userId);
    const q = Number(data.q);
    const v = data.v;

    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    s.answers[`q${q}`] = v;

    // 次の質問へ（工事内容によって分岐）
    switch (q) {
      case 1: return askQ2(event.replyToken, userId);
      case 2: return askQ3(event.replyToken, userId);
      case 3: {
        // 外壁/屋根/両方 によって Q6/Q7 の出し分けを制御するため、フラグを入れておく
        // 以降は Q4 → Q5 → Q6 or Q7 → Q8 → Q9 → 写真 → 連絡先
        return askQ4(event.replyToken, userId);
      }
      case 4: {
        // Q4=ある の場合のみ Q5（前回から）を聞く。ない/わからない なら Q5=該当なし でスキップ。
        if (v === 'ある') return askQ5(event.replyToken, userId);
        s.answers.q5 = '該当なし';
        return askQ6or7(event.replyToken, userId); // ここで Q6 or Q7
      }
      case 5: return askQ6or7(event.replyToken, userId);
      case 6: {
        // Q6 を聞いた場合 → 工事内容により Q7 を聞くかそのまま Q8
        const needRoof = s.answers.q3.includes('屋根');
        if (needRoof) return askQ7(event.replyToken, userId);
        return askQ8(event.replyToken, userId);
      }
      case 7: return askQ8(event.replyToken, userId);
      case 8: return askQ9(event.replyToken, userId);
      case 9: return askPhotoBegin(event.replyToken, userId);
      default:
        return askContact(event.replyToken, userId);
    }
  }
}

// ────────────────────────────────────────────────────────────
// 質問 UI（シンプルなテキスト + 画像付きクイックリプライ）
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
};

function qr(items) { return { items }; }
function pb(label, data, imageUrl) {
  return { type: 'action', imageUrl, action: { type: 'postback', label, data, displayText: label } };
}

async function askQ1(rt, userId) {
  getSession(userId).step = 1;
  const items = [
    pb('1階建て', qs.stringify({ q: 1, v: '1階建て' }), ICONS.floor),
    pb('2階建て', qs.stringify({ q: 1, v: '2階建て' }), ICONS.floor),
    pb('3階建て', qs.stringify({ q: 1, v: '3階建て' }), ICONS.floor),
  ];
  return lineClient.replyMessage(rt, { type: 'text', text: '1/9 階数を選んでください', quickReply: qr(items) });
}
async function askQ2(rt) {
  const L = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  return lineClient.replyMessage(rt, { type:'text', text:'2/9 間取りを選んでください', quickReply: qr(L.map(v => pb(v, qs.stringify({q:2,v}), ICONS.layout))) });
}
async function askQ3(rt) {
  const A = [
    pb('外壁塗装', qs.stringify({ q:3, v:'外壁塗装' }), ICONS.paint),
    pb('屋根塗装', qs.stringify({ q:3, v:'屋根塗装' }), ICONS.paint),
    pb('外壁塗装＋屋根塗装', qs.stringify({ q:3, v:'外壁塗装＋屋根塗装' }), ICONS.paint),
  ];
  return lineClient.replyMessage(rt, { type:'text', text:'3/9 希望する工事内容を選んでください', quickReply: qr(A) });
}
async function askQ4(rt) {
  const A = [
    pb('ある', qs.stringify({q:4,v:'ある'}), ICONS.yes),
    pb('ない', qs.stringify({q:4,v:'ない'}), ICONS.no),
    pb('わからない', qs.stringify({q:4,v:'わからない'}), ICONS.no),
  ];
  return lineClient.replyMessage(rt, { type:'text', text:'4/9 これまで外壁塗装をしたことはありますか？', quickReply: qr(A) });
}
async function askQ5(rt) {
  const L = ['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  return lineClient.replyMessage(rt, { type:'text', text:'5/9 前回の外壁塗装からどれくらい？', quickReply: qr(L.map(v=>pb(v, qs.stringify({q:5,v}), ICONS.years))) });
}
async function askQ6or7(rt, userId) {
  const s = getSession(userId);
  const wantWall  = s.answers.q3.includes('外壁');
  const wantRoof  = s.answers.q3.includes('屋根');

  if (wantWall) {
    return askQ6(rt);
  }
  // 外壁が不要なら屋根へ
  if (wantRoof) {
    return askQ7(rt);
  }
  // どちらも無ければ Q8
  return askQ8(rt);
}
async function askQ6(rt) {
  const L = ['モルタル','サイディング','タイル','ALC'];
  return lineClient.replyMessage(rt, { type:'text', text:'6/9 外壁の種類は？', quickReply: qr(L.map(v=>pb(v, qs.stringify({q:6,v}), ICONS.wall))) });
}
async function askQ7(rt) {
  const L = ['瓦','スレート','ガルバリウム','トタン'];
  return lineClient.replyMessage(rt, { type:'text', text:'(次) 屋根の種類は？', quickReply: qr(L.map(v=>pb(v, qs.stringify({q:7,v}), ICONS.roof))) });
}
async function askQ8(rt) {
  const L = ['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'];
  return lineClient.replyMessage(rt, { type:'text', text:'7/9 雨漏りの状況は？', quickReply: qr(L.map(v=>pb(v, qs.stringify({q:8,v}), ICONS.leak))) });
}
async function askQ9(rt) {
  const L = ['30cm以下','50cm以下','70cm以下','70cm以上'];
  return lineClient.replyMessage(rt, { type:'text', text:'8/9 周辺との最短距離（足場の目安）', quickReply: qr(L.map(v=>pb(v, qs.stringify({q:9,v}), ICONS.distance))) });
}

const PHOTO_STEPS = [
  { key: 'front', label: '外観写真：正面' },
  { key: 'right', label: '外観写真：右側' },
  { key: 'left',  label: '外観写真：左側' },
  { key: 'back',  label: '外観写真：後ろ側' },
  { key: 'damage',label: '損傷箇所（任意）' },
];

async function askPhotoBegin(rt, userId) {
  const s = getSession(userId);
  s.expectingPhoto = true;
  s.photoIndex = -1;
  return askNextPhoto(rt, userId, false, true);
}
async function askNextPhoto(rt, userId, skipped=false, first=false) {
  const s = getSession(userId);
  if (!first) s.photoIndex += 1; else s.photoIndex = 0;

  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    return askContact(rt, userId);
  }
  const cur = PHOTO_STEPS[s.photoIndex];

  const items = [
    { type:'action', imageUrl: ICONS.camera, action:{ type:'camera', label:'カメラを起動' } },
    { type:'action', imageUrl: ICONS.camera, action:{ type:'cameraRoll', label:'アルバムから選択' } },
    { type:'action', imageUrl: ICONS.no,     action:{ type:'message', label:'スキップ', text:'スキップ' } },
    { type:'action', imageUrl: ICONS.yes,    action:{ type:'message', label:'完了',     text:'完了' } },
  ];
  return lineClient.replyMessage(rt, {
    type:'text',
    text:`9/9 写真アップロード\n「${cur.label}」を送ってください。\n（送れない場合は「スキップ」、すべて終えたら「完了」と送信できます）`,
    quickReply: { items }
  });
}

// 概算提示 & LIFFへ
async function askContact(rt, userId) {
  const s = getSession(userId);
  const a = s.answers;
  const est = estimateCost(a);

  const liffUrl = `https://liff.line.me/${process.env.LIFF_ID}`;

  await lineClient.replyMessage(rt, [
    { type:'text', text: summaryText(a, s.photoUrls.length) },
    {
      type:'flex',
      altText:'詳しい見積りをご希望の方へ',
      contents:{
        type:'bubble',
        body:{
          type:'box',layout:'vertical',spacing:'md',contents:[
            { type:'text', text:'詳しい見積もりをご希望の方へ', weight:'bold', size:'lg' },
            { type:'text', text:'現地調査なしで、詳細な見積りをLINEでお知らせします。', wrap:true },
            { type:'separator', margin:'md' },
            { type:'box', layout:'vertical', spacing:'sm', contents:[
              { type:'text', text:`概算金額：${yen(est)}`, weight:'bold', size:'lg' },
              { type:'text', text:'上記はご入力内容を元に算出した概算です。', size:'sm', color:'#666666', wrap:true }
            ]}
          ]
        },
        footer:{
          type:'box',layout:'vertical',contents:[
            { type:'button',style:'primary',
              action:{ type:'uri', label:'現地調査なしで見積を依頼', uri:liffUrl } }
          ]
        }
      }
    }
  ]);
}

// 画像保存（Supabase Storage）
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
async function saveImageToSupabase(userId, messageId) {
  const s = getSession(userId);
  const stream = await lineClient.getMessageContent(messageId);
  const buf = await streamToBuffer(stream);
  const cur = PHOTO_STEPS[Math.min(Math.max(s.photoIndex,0), PHOTO_STEPS.length-1)];
  const filename = `${cur?.key || 'photo'}_${Date.now()}.jpg`;
  const filepath = `line/${userId}/${filename}`;

  const { error } = await supabase.storage.from('photos')
    .upload(filepath, buf, { contentType:'image/jpeg', upsert:true });
  if (error) throw error;

  const { data: pub } = supabase.storage.from('photos').getPublicUrl(filepath);
  const publicUrl = pub?.publicUrl;
  if (publicUrl) s.photoUrls.push(publicUrl);
}

// ────────────────────────────────────────────────────────────
// 見積り計算・文言
// ────────────────────────────────────────────────────────────
function estimateCost(a) {
  const base  = { '外壁塗装':700000, '屋根塗装':300000, '外壁塗装＋屋根塗装':900000 };
  const floor = { '1階建て':1.0, '2階建て':1.2, '3階建て':1.4 };
  const layout= { '1DK':0.9,'1LDK':0.95,'2DK':1.0,'2LDK':1.05,'3DK':1.1,'3LDK':1.15,'4DK':1.2,'4LDK':1.25,'5DK':1.3,'5LDK':1.35 };
  const wall  = { 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof  = { '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak  = { '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.1,'雨漏りはない':1.0 };
  const dist  = { '30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.1,'70cm以上':1.0 };
  const years = { '1〜5年':0.95,'5〜10年':1.0,'10〜15年':1.05,'15〜20年':1.1,'20〜30年':1.15,'30〜40年':1.2,'40年以上':1.25,'0年（新築）':0.9 };

  let cost = base[a.q3] || 600000;
  cost *= floor[a.q1] || 1.0;
  cost *= layout[a.q2] || 1.0;
  if (a.q3.includes('外壁')) cost *= wall[a.q6] || 1.0;
  if (a.q3.includes('屋根')) cost *= roof[a.q7] || 1.0;
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
function esc(s){ return String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

function replyText(rt, text){ return lineClient.replyMessage(rt, { type:'text', text }); }

// ------------------------------------------------------------------
// サーバ起動
// ------------------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
  console.log(`LIFF static: ${process.env.PUBLIC_BASE_URL || '<your-base-url>'}/liff/index.html`);
});
