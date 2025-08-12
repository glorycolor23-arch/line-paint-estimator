/**
 * server.js — LINE 外壁塗装 見積もりBot（完全版）
 * ------------------------------------------------------------
 * ✅ チャット常時オン対応（Webhookは必ず 200 を返す）
 * ✅ Quick Reply で質問 → 画像アップロード → 概算
 * ✅ 画像は Supabase Storage（photos バケット）へ保存
 * ✅ 最終確定で Googleスプレッドシートへ追記
 * ✅ 同時に Apps Script WebApp 経由で管理者へメール通知（本文＋写真URL）
 *
 * 必要な環境変数（Render → Environment）
 *  - CHANNEL_SECRET
 *  - CHANNEL_ACCESS_TOKEN
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - GOOGLE_SERVICE_ACCOUNT_EMAIL
 *  - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   ← 改行はそのままでOK（下の replace で対応）
 *  - GSHEET_SPREADSHEET_ID
 *  - GSHEET_SHEET_NAME                    ← 例: Entries
 *  - EMAIL_TO                             ← 例: matsuo@graphity.co.jp
 *  - EMAIL_WEBAPP_URL                     ← Apps Script WebアプリURL（POSTを受けて送信）
 *  - FRIEND_ADD_URL                       ← 例: https://line.me/R/ti/p/@004szogc
 *
 * package.json（抜粋）
 *  {
 *    "type": "module",
 *    "main": "server.js",
 *    "scripts": { "start": "node server.js" },
 *    "dependencies": {
 *      "@line/bot-sdk": "^9.0.3",
 *      "@supabase/supabase-js": "^2.45.0",
 *      "axios": "^1.7.2",
 *      "dotenv": "^16.4.5",
 *      "express": "^4.19.2",
 *      "googleapis": "^131.0.0",
 *      "qs": "^6.12.1"
 *    }
 *  }
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import axios from 'axios';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ────────────────────────────────────────────────────────────
// 基本
// ────────────────────────────────────────────────────────────
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[FATAL] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です。');
  process.exit(1);
}

const FRIEND_ADD_URL =
  process.env.FRIEND_ADD_URL || 'https://line.me/R/ti/p/@004szogc';

const client = new line.Client(config);
const app = express();

// Health（Render のヘルスチェック用）
app.get('/health', (_, res) => res.status(200).send('healthy'));

// 重要：line.middleware より前に body-parser（express.json）を置かない
app.post('/webhook', line.middleware(config), (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    Promise.all(
      events.map((ev) =>
        handleEvent(ev).catch((err) => {
          console.error('handleEvent error:', err);
        })
      )
    )
      .then(() => res.status(200).end()) // 何があっても 200 を返す
      .catch((err) => {
        console.error('Webhook top error:', err);
        res.status(200).end();
      });
  } catch (e) {
    console.error('Webhook catch error:', e);
    res.status(200).end();
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LINE bot listening on ${PORT}`));

// ────────────────────────────────────────────────────────────
// 外部サービス
// ────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const PHOTOS_BUCKET = 'photos';

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
    range: `${process.env.GSHEET_SHEET_NAME || 'Entries'}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

async function sendAdminEmail({ htmlBody, photoUrls = [] }) {
  const endpoint = process.env.EMAIL_WEBAPP_URL;
  const to = process.env.EMAIL_TO;
  if (!endpoint || !to) {
    console.warn('[WARN] EMAIL_WEBAPP_URL or EMAIL_TO is not set; skip email.');
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
// 簡易セッション（プロセス内）
// ────────────────────────────────────────────────────────────
const sessions = new Map(); // userId → { step, answers, photoIndex, expectingPhoto, photoUrls, contact }

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 1,
      answers: {},
      photoIndex: 0,
      expectingPhoto: false,
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
    photoIndex: 0,
    expectingPhoto: false,
    photoUrls: [],
    contact: { name: '', postal: '', addr1: '', addr2: '' },
  });
}

// ────────────────────────────────────────────────────────────
// UI 素材
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

// 写真ステップ
const PHOTO_STEPS = [
  { key: 'front', label: '外観写真：正面' },
  { key: 'right', label: '外観写真：右側' },
  { key: 'left', label: '外観写真：左側' },
  { key: 'back', label: '外観写真：後ろ側' },
  { key: 'damage', label: '損傷箇所（任意）' },
];

// ────────────────────────────────────────────────────────────
// メインイベント
// ────────────────────────────────────────────────────────────
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(
      event.replyToken,
      '友だち追加ありがとうございます！\n' +
        '外壁・屋根塗装の【かんたん概算見積もり】をご案内します。\n' +
        '「見積もり」または「スタート」と送ってください。'
    );
  }

  if (event.type === 'message') {
    const { message } = event;

    // テキスト
    if (message.type === 'text') {
      const text = (message.text || '').trim();
      const s = getSession(userId);

      if (/^(最初から|リセット)$/i.test(text)) {
        resetSession(userId);
        return replyText(
          event.replyToken,
          '回答をリセットしました。\n「見積もり」または「スタート」を送ってください。'
        );
      }

      if (/^(見積もり|スタート|start)$/i.test(text)) {
        resetSession(userId);
        return askQ1(event.replyToken, userId);
      }

      // 連絡先入力の開始ボタン
      if (text === '詳しい見積もりを依頼する') {
        s.step = 'contact_name';
        return replyText(event.replyToken, 'お名前をご入力ください。');
      }

      // 連絡先の段階入力
      if (s.step === 'contact_name') {
        s.contact.name = text;
        s.step = 'contact_postal';
        return replyText(
          event.replyToken,
          '郵便番号を入力してください（ハイフンなし7桁でもOK）'
        );
      }
      if (s.step === 'contact_postal') {
        s.contact.postal = text.replace(/[^\d]/g, '');
        s.step = 'contact_addr1';
        return replyText(
          event.replyToken,
          '住所（都道府県・市区町村・番地など）を入力してください'
        );
      }
      if (s.step === 'contact_addr1') {
        s.contact.addr1 = text;
        s.step = 'contact_addr2';
        return replyText(
          event.replyToken,
          '建物名・部屋番号など（あれば）を入力してください。無ければ「なし」と入力'
        );
      }
      if (s.step === 'contact_addr2') {
        s.contact.addr2 = text === 'なし' ? '' : text;
        return finalizeAndNotify(event.replyToken, userId);
      }

      // 写真待ちのときのテキスト（スキップ・完了）
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(text)) {
          s.photoIndex += 1;
          return askNextPhoto(event.replyToken, userId);
        }
        if (/^(完了|おわり|終了)$/i.test(text)) {
          s.expectingPhoto = false;
          s.photoIndex = PHOTO_STEPS.length;
          return askContact(event.replyToken, userId);
        }
        return replyText(
          event.replyToken,
          '画像を送信してください。スキップは「スキップ」と送ってください。'
        );
      }

      // それ以外は案内
      return replyText(
        event.replyToken,
        '「見積もり」または「スタート」と送ってください。'
      );
    }

    // 画像
    if (message.type === 'image') {
      const s = getSession(userId);
      if (!s.expectingPhoto) {
        return replyText(
          event.replyToken,
          'ありがとうございます。いま質問中です。ボタンから続きにお進みください。'
        );
      }

      // 保存は非同期で（返信を待たせない）
      saveImageToSupabase(userId, message.id, s).catch((err) =>
        console.error('saveImage error:', err)
      );

      // 次へ
      s.photoIndex += 1;
      return askNextPhoto(event.replyToken, userId);
    }

    return;
  }

  // Postback
  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data);
    const s = getSession(userId);
    const q = Number(data.q);
    const v = data.v;
    if (!q || typeof v === 'undefined') {
      return replyText(
        event.replyToken,
        '入力を受け取れませんでした。もう一度お試しください。'
      );
    }

    s.answers[`q${q}`] = v;

    // Q4 分岐
    if (q === 4 && (v === 'ない' || v === 'わからない')) {
      s.answers.q5 = '該当なし';
      s.step = 6;
      return askQ6(event.replyToken, userId);
    }

    s.step = q + 1;
    switch (s.step) {
      case 2:
        return askQ2(event.replyToken, userId);
      case 3:
        return askQ3(event.replyToken, userId);
      case 4:
        return askQ4(event.replyToken, userId);
      case 5:
        return askQ5(event.replyToken, userId);
      case 6:
        return askQ6(event.replyToken, userId);
      case 7:
        return askQ7(event.replyToken, userId);
      case 8:
        return askQ8(event.replyToken, userId);
      case 9:
        return askQ9(event.replyToken, userId);
      case 10:
        return askQ10_Begin(event.replyToken, userId);
      case 11:
      default:
        return askContact(event.replyToken, userId);
    }
  }
}

// ────────────────────────────────────────────────────────────
// 質問 UI
// ────────────────────────────────────────────────────────────
const qr = (items) => ({ items });
const pb = (label, data, imageUrl) => ({
  type: 'action',
  imageUrl,
  action: { type: 'postback', label, data, displayText: label },
});

async function askQ1(rt, userId) {
  const s = getSession(userId);
  s.step = 1;
  const items = [
    pb('1階建て', qs.stringify({ q: 1, v: '1階建て' }), ICONS.floor),
    pb('2階建て', qs.stringify({ q: 1, v: '2階建て' }), ICONS.floor),
    pb('3階建て', qs.stringify({ q: 1, v: '3階建て' }), ICONS.floor),
  ];
  return client.replyMessage(rt, {
    type: 'text',
    text: '1/10 住宅の階数を選んでください',
    quickReply: qr(items),
  });
}
async function askQ2(rt) {
  const L = [
    '1DK',
    '1LDK',
    '2DK',
    '2LDK',
    '3DK',
    '3LDK',
    '4DK',
    '4LDK',
    '5DK',
    '5LDK',
  ];
  return client.replyMessage(rt, {
    type: 'text',
    text: '2/10 住宅の間取りを選んでください',
    quickReply: qr(L.map((l) => pb(l, qs.stringify({ q: 2, v: l }), ICONS.layout))),
  });
}
async function askQ3(rt) {
  const A = [
    pb('外壁塗装', qs.stringify({ q: 3, v: '外壁塗装' }), ICONS.paint),
    pb('屋根塗装', qs.stringify({ q: 3, v: '屋根塗装' }), ICONS.paint),
    pb(
      '外壁＋屋根',
      qs.stringify({ q: 3, v: '外壁塗装＋屋根塗装' }),
      ICONS.paint
    ),
  ];
  return client.replyMessage(rt, {
    type: 'text',
    text: '3/10 希望する工事内容を選んでください',
    quickReply: qr(A),
  });
}
async function askQ4(rt) {
  const A = [
    pb('ある', qs.stringify({ q: 4, v: 'ある' }), ICONS.yes),
    pb('ない', qs.stringify({ q: 4, v: 'ない' }), ICONS.no),
    pb('わからない', qs.stringify({ q: 4, v: 'わからない' }), ICONS.no),
  ];
  return client.replyMessage(rt, {
    type: 'text',
    text: '4/10 これまで外壁塗装をしたことはありますか？',
    quickReply: qr(A),
  });
}
async function askQ5(rt) {
  const L = [
    '1〜5年',
    '5〜10年',
    '10〜15年',
    '15〜20年',
    '20〜30年',
    '30〜40年',
    '40年以上',
    '0年（新築）',
  ];
  return client.replyMessage(rt, {
    type: 'text',
    text: '5/10 前回の外壁塗装からどれくらい？',
    quickReply: qr(L.map((v) => pb(v, qs.stringify({ q: 5, v }), ICONS.years))),
  });
}
async function askQ6(rt) {
  const L = ['モルタル', 'サイディング', 'タイル', 'ALC'];
  return client.replyMessage(rt, {
    type: 'text',
    text: '6/10 外壁の種類は？',
    quickReply: qr(L.map((v) => pb(v, qs.stringify({ q: 6, v }), ICONS.wall))),
  });
}
async function askQ7(rt) {
  const L = ['瓦', 'スレート', 'ガルバリウム', 'トタン'];
  return client.replyMessage(rt, {
    type: 'text',
    text: '7/10 屋根の種類は？',
    quickReply: qr(L.map((v) => pb(v, qs.stringify({ q: 7, v }), ICONS.roof))),
  });
}
async function askQ8(rt) {
  const L = ['雨の日に水滴が落ちる', '天井にシミがある', '雨漏りはない'];
  return client.replyMessage(rt, {
    type: 'text',
    text: '8/10 雨漏りの状況は？',
    quickReply: qr(L.map((v) => pb(v, qs.stringify({ q: 8, v }), ICONS.leak))),
  });
}
async function askQ9(rt) {
  const L = ['30cm以下', '50cm以下', '70cm以下', '70cm以上'];
  return client.replyMessage(rt, {
    type: 'text',
    text: '9/10 周辺との最短距離（足場の目安）',
    quickReply: qr(L.map((v) => pb(v, qs.stringify({ q: 9, v }), ICONS.distance))),
  });
}

// 画像アップロード
async function askQ10_Begin(rt, userId) {
  const s = getSession(userId);
  s.expectingPhoto = true;
  s.photoIndex = 0;
  return askPhotoPrompt(rt, s);
}
async function askNextPhoto(rt, userId) {
  const s = getSession(userId);
  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    return askContact(rt, userId);
  }
  return askPhotoPrompt(rt, s);
}
function askPhotoPrompt(rt, s) {
  const cur = PHOTO_STEPS[s.photoIndex];
  const items = [
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'camera', label: 'カメラを起動' } },
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'cameraRoll', label: 'アルバムから選択' } },
    { type: 'action', imageUrl: ICONS.no, action: { type: 'message', label: 'スキップ', text: 'スキップ' } },
    { type: 'action', imageUrl: ICONS.yes, action: { type: 'message', label: '完了', text: '完了' } },
  ];
  return client.replyMessage(rt, {
    type: 'text',
    text: `10/10 写真アップロード\n「${cur.label}」を送ってください。`,
    quickReply: { items },
  });
}

// 連絡先入力スタート
async function askContact(rt, userId) {
  const s = getSession(userId);
  const a = s.answers;
  const estimate = estimateCost(a);

  await client.replyMessage(rt, [
    { type: 'text', text: summaryText(a, s.photoUrls.length) },
    {
      type: 'text',
      text:
        `概算金額：${yen(estimate)}\n\n` +
        'より詳しい見積もりをご希望の方は、下のボタンから連絡先をご入力ください。',
    },
    buildContactFlex(),
  ]);

  s.step = 'await_contact_button'; // ボタン押下後に contact_name へ
}

// ────────────────────────────────────────────────────────────
// 画像保存（Supabase Storage）
// ────────────────────────────────────────────────────────────
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
async function saveImageToSupabase(userId, messageId, session) {
  const stream = await client.getMessageContent(messageId);
  const buf = await streamToBuffer(stream);

  const idx = Math.min(session.photoIndex, PHOTO_STEPS.length - 1);
  const cur = PHOTO_STEPS[idx] || { key: 'photo', label: '写真' };

  const filename = `${cur.key}_${Date.now()}.jpg`; // 日本語回避
  const filepath = `line/${userId}/${filename}`;

  const { error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(filepath, buf, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;

  const { data: pub } = supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(filepath);
  const publicUrl = pub?.publicUrl;
  if (publicUrl) session.photoUrls.push(publicUrl);

  // ユーザーへ受付メッセージ
  await client.pushMessage(userId, { type: 'text', text: `受け取りました：${cur.label}` });
}

// ────────────────────────────────────────────────────────────
// 見積り・最終確定
// ────────────────────────────────────────────────────────────
function estimateCost(a) {
  const base = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装＋屋根塗装': 900000 };
  const floor = { '1階建て': 1.0, '2階建て': 1.2, '3階建て': 1.4 };
  const layout = {
    '1DK': 0.9, '1LDK': 0.95, '2DK': 1.0, '2LDK': 1.05,
    '3DK': 1.1, '3LDK': 1.15, '4DK': 1.2, '4LDK': 1.25,
    '5DK': 1.3, '5LDK': 1.35,
  };
  const wall = { 'モルタル': 1.05, 'サイディング': 1.0, 'タイル': 1.15, 'ALC': 1.1 };
  const roof = { '瓦': 1.1, 'スレート': 1.0, 'ガルバリウム': 1.05, 'トタン': 0.95 };
  const leak = { '雨の日に水滴が落ちる': 1.15, '天井にシミがある': 1.1, '雨漏りはない': 1.0 };
  const dist = { '30cm以下': 1.2, '50cm以下': 1.15, '70cm以下': 1.1, '70cm以上': 1.0 };
  const years = {
    '1〜5年': 0.95, '5〜10年': 1.0, '10〜15年': 1.05, '15〜20年': 1.1,
    '20〜30年': 1.15, '30〜40年': 1.2, '40年以上': 1.25, '0年（新築）': 0.9,
  };

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
const yen = (n) =>
  n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

function summaryText(a, count) {
  return [
    '【回答の確認】',
    `・階数: ${a.q1 || '-'} / 間取り: ${a.q2 || '-'} / 工事: ${a.q3 || '-'}`,
    `・過去塗装: ${a.q4 || '-'} / 前回から: ${a.q5 || '該当なし'}`,
    `・外壁: ${a.q6 || '-'} / 屋根: ${a.q7 || '-'} / 雨漏り: ${a.q8 || '-'}`,
    `・最短距離: ${a.q9 || '-'} / 受領写真: ${count}枚`,
  ].join('\n');
}
function buildContactFlex() {
  return {
    type: 'flex',
    altText: '連絡先の入力',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '詳しい見積もりをご希望の方へ', weight: 'bold', wrap: true },
          { type: 'text', text: 'ボタンを押して、連絡先（お名前・住所）を入力してください。', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: { type: 'message', label: '詳しい見積もりを依頼する', text: '詳しい見積もりを依頼する' },
          },
        ],
      },
    },
  };
}

async function finalizeAndNotify(replyToken, userId) {
  const s = getSession(userId);
  const a = s.answers;
  const est = estimateCost(a);
  const now = new Date();

  // 1) スプレッドシートに追記
  const row = [
    now.toISOString(),
    userId,
    s.contact.name,
    s.contact.postal,
    s.contact.addr1,
    s.contact.addr2,
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

  // 2) 管理者へメール（Apps Script）
  const html = `
  <div style="font-family:system-ui,Segoe UI,Helvetica,Arial">
    <h2>外壁塗装 — 最終入力</h2>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
      <tr><th align="left">LINEユーザーID</th><td>${esc(userId)}</td></tr>
      <tr><th align="left">お名前</th><td>${esc(s.contact.name)}</td></tr>
      <tr><th align="left">郵便番号</th><td>${esc(s.contact.postal)}</td></tr>
      <tr><th align="left">住所1</th><td>${esc(s.contact.addr1)}</td></tr>
      <tr><th align="left">住所2</th><td>${esc(s.contact.addr2)}</td></tr>
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
    ${
      s.photoUrls?.length
        ? `<p>写真リンク：</p><ol>${s.photoUrls
            .map((u) => `<li><a href="${u}">${u}</a></li>`)
            .join('')}</ol>`
        : ''
    }
  </div>`;
  try {
    await sendAdminEmail({ htmlBody: html, photoUrls: s.photoUrls });
  } catch (e) {
    console.error('sendAdminEmail error:', e?.response?.data || e);
  }

  // 3) ユーザーへ最終案内
  await client.replyMessage(replyToken, [
    {
      type: 'text',
      text:
        'ありがとうございます。連絡先を受け付けました。1営業日以内に正式なお見積もりをお送りします。',
    },
    {
      type: 'flex',
      altText: '友だち追加',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            { type: 'text', text: 'チャット相談をご希望の方', weight: 'bold' },
            {
              type: 'text',
              text: '下のボタンから担当アカウントを友だち追加してください。',
              wrap: true,
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              style: 'primary',
              action: {
                type: 'uri',
                label: '担当に相談（友だち追加）',
                uri: FRIEND_ADD_URL,
              },
            },
          ],
        },
      },
    },
  ]);

  resetSession(userId);
}

// ────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m]));
}
function replyText(rt, text) {
  return client.replyMessage(rt, { type: 'text', text });
}
