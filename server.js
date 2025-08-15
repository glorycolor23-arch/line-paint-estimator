/* =========================================================
 * server.js  完全版（署名検証・質問フロー・概算・LIFF配信）
 * ========================================================= */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client, middleware as lineMiddleware } from '@line/bot-sdk';
import axios from 'axios';

// ---------- パス補助 ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- LINE 設定 ----------
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[FATAL] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です。');
  process.exit(1);
}

const client = new Client(config);

// ---------- Express ----------
const app = express();

// (A) Health
app.get('/health', (_, res) => res.status(200).send('ok'));

// (B) LIFF 静的配信
app.use('/liff', express.static(path.join(__dirname, 'liff'), { index: 'index.html' }));

// (C) フロントから参照する LIFF の環境JS
app.get('/liff/env.js', (req, res) => {
  const liffId = process.env.LIFF_ID || '';
  const friendUrl = process.env.FRIEND_ADD_URL || '';
  const emailWebApp = process.env.EMAIL_WEBAPP_URL || '';
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.status(200).send(
    `window.ENV={LIFF_ID:${JSON.stringify(liffId)},FRIEND_ADD_URL:${JSON.stringify(friendUrl)},EMAIL_WEBAPP_URL:${JSON.stringify(emailWebApp)}};`
  );
});

/* ---------------------------------------------------------
 * (D) Webhook 専用 JSON パーサ（rawBody を必ず残す）
 * --------------------------------------------------------- */
app.use(
  '/webhook',
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
);

/* ---------------------------------------------------------
 * (E) LINE ミドルウェア（署名検証）
 * --------------------------------------------------------- */
app.post('/webhook', lineMiddleware(config), async (req, res) => {
  res.status(200).end('OK'); // 先に200

  try {
    const events = req.body.events || [];
    for (const ev of events) {
      await handleEvent(ev);
    }
  } catch (e) {
    console.error('[webhook handler error]', e);
  }
});

/* ---------------------------------------------------------
 * (F) それ以外の JSON API はここで定義（最後）
 * --------------------------------------------------------- */
app.use(express.json());

/* =========================================================
 * ここから下：質問フロー / 概算 / LIFF 誘導
 * ========================================================= */

const sessions = new Map(); // key: userId

// ダミー画像
const IMG = 'https://via.placeholder.com/1024x512.png?text=選択してください';

// トリガー
const TRIGGER_START = ['カンタン見積りを依頼'];
const CMD_RESET     = ['はじめからやり直す', 'リセット'];

// 質問定義
const QUESTIONS = [
  { id: 'q1_floors', title: '工事物件の階数は？', options: ['1階建て', '2階建て', '3階建て']},
  { id: 'q2_layout', title: '物件の間取りは？', options: ['1K','1DK','1LDK','2K','2DK','2LDK','3K','3DK','4K','4DK','4LDK']},
  { id: 'q3_age', title: '物件の築年数は？', options: ['新築','〜10年','〜20年','〜30年','〜40年','〜50年','51年以上']},
  { id: 'q4_painted', title: '過去に塗装をした経歴は？', options: ['ある','ない','わからない']},
  { id: 'q5_last', title: '前回の塗装はいつ頃？', options: ['〜5年','5〜10年','10〜20年','20〜30年','わからない']},
  { id: 'q6_work', title: 'ご希望の工事内容は？', options: ['外壁塗装','屋根塗装','外壁塗装+屋根塗装']},
  { id: 'q7_wall', title: '外壁の種類は？（外壁を選んだ場合）', options: ['モルタル','サイディング','タイル','ALC'], conditional: (ans)=>ans.q6_work?.includes('外壁')},
  { id: 'q8_roof', title: '屋根の種類は？（屋根を選んだ場合）', options: ['瓦','スレート','ガルバリウム','トタン'], conditional: (ans)=>ans.q6_work?.includes('屋根')},
  { id: 'q9_leak', title: '雨漏りや漏水の症状はありますか？', options: ['雨の日に水滴が落ちる','天井にシミがある','ない']},
  { id: 'q10_dist', title: '隣や裏の家との距離は？（周囲で一番近い距離）', options: ['30cm以下','50cm以下','70cm以下','70cm以上']},
];

// 概算金額のダミー計算
function calcRoughPrice(ans) {
  let base = 1000000;
  const floor = ans.q1_floors || '';
  if (floor.includes('2')) base += 150000;
  if (floor.includes('3')) base += 300000;
  if ((ans.q6_work || '').includes('屋根')) base += 180000;
  if ((ans.q6_work || '').includes('外壁')) base += 220000;
  if ((ans.q7_wall || '').includes('タイル')) base += 120000;
  if ((ans.q9_leak || '') !== 'ない') base += 90000;
  return Math.round(base / 1000) * 1000;
}

// 安全送信
async function safeReply(token, messages) {
  try {
    const arr = Array.isArray(messages) ? messages : [messages];
    await client.replyMessage(token, arr);
  } catch (err) {
    console.error('[safeReply error]', JSON.stringify(err?.response?.data || err?.message || err, null, 2));
  }
}
async function safePush(to, messages) {
  try {
    const arr = Array.isArray(messages) ? messages : [messages];
    await client.pushMessage(to, arr);
  } catch (err) {
    console.error('[safePush error]', JSON.stringify(err?.response?.data || err?.message || err, null, 2));
  }
}

// Flex（3カラムカード）
function buildOptionsFlex(questionTitle, questionId, options) {
  const bubbles = options.map(opt => ({
    type: 'bubble',
    hero: { type: 'image', url: IMG, size: 'full', aspectRatio: '16:9', aspectMode: 'cover' },
    body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: opt, weight: 'bold', size: 'lg', wrap: true }] },
    footer: {
      type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary',
          action: { type: 'postback', label: '選ぶ', data: JSON.stringify({ t:'answer', q:questionId, v:opt }), displayText: opt } }
      ]
    }
  }));
  return { type: 'flex', altText: questionTitle, contents: { type: 'carousel', contents: bubbles } };
}

function summaryText(ans) {
  return [
    `・階数: ${ans.q1_floors || '—'} / 間取り: ${ans.q2_layout || '—'} / 築年数: ${ans.q3_age || '—'}`,
    `・過去塗装: ${ans.q4_painted || '—'} / 前回から: ${ans.q5_last || '—'}`,
    `・工事内容: ${ans.q6_work || '—'} / 外壁: ${ans.q7_wall || '—'} / 屋根: ${ans.q8_roof || '—'}`,
    `・雨漏り: ${ans.q9_leak || '—'} / 距離: ${ans.q10_dist || '—'}`
  ].join('\n');
}

function buildEstimateFlex(price) {
  return {
    type: 'flex',
    altText: '概算見積り',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '見積り金額', weight: 'bold', size: 'md' },
          { type: 'text', text: `￥${price.toLocaleString()}`, weight: 'bold', size: 'xl' },
          { type: 'text', text: '上記はご入力内容を元に算出した概算です。', wrap: true, size: 'sm', color: '#666' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'md', contents: [
          { type: 'text', text: '正式なお見積りが必要な方は続けてご入力ください。', size: 'sm', wrap: true },
          { type: 'button', style: 'primary',
            action: { type: 'uri', label: '現地調査なしで見積を依頼', uri: 'https://line-paint.onrender.com/liff/index.html' } }
        ]
      }
    }
  };
}

// 現在の出題インデックス（条件付き質問をスキップ）
function currentIndex(ans) {
  let idx = 0;
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    if (q.conditional && !q.conditional(ans)) continue;
    if (!ans[q.id]) return i;
    idx = i + 1;
  }
  return idx;
}

// 次の質問を送る
async function sendNextQuestion(userId, replyToken = null) {
  const sess = sessions.get(userId) || { answers: {}, step: 0 };
  const idx = currentIndex(sess.answers);

  if (idx >= QUESTIONS.length) {
    // ===== 最終：概算 + LIFF ⇒ pushMessage で必ず送る =====
    const price = calcRoughPrice(sess.answers);
    const msgs = [
      { type: 'text', text: 'ありがとうございます。概算を作成しました。' },
      { type: 'text', text: `【回答の確認】\n${summaryText(sess.answers)}` },
      buildEstimateFlex(price)
    ];
    await safePush(userId, msgs);   // ← replyToken を使わない
    sessions.delete(userId);
    return;
  }

  // 途中の質問は replyToken でレスポンス（見た目を早くする）
  const q = QUESTIONS[idx];
  const msgs = [
    { type: 'text', text: q.title },
    buildOptionsFlex(q.title, q.id, q.options)
  ];
  if (replyToken) {
    await safeReply(replyToken, msgs);
  } else {
    await safePush(userId, msgs);
  }
}

// 停止確認
async function sendStopConfirm(userId) {
  const template = {
    type: 'template',
    altText: '見積りを停止しますか？',
    template: {
      type: 'confirm',
      text: '見積りを停止しますか？',
      actions: [
        { type: 'postback', label: 'はい', data: JSON.stringify({ t:'stop', v:'yes' }), displayText:'はい' },
        { type: 'postback', label: 'いいえ', data: JSON.stringify({ t:'stop', v:'no' }), displayText:'いいえ' }
      ]
    }
  };
  await safePush(userId, template);
}

// イベントハンドラ
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (!sessions.has(userId)) sessions.set(userId, { answers: {}, step: 0 });

  if (event.type === 'postback') {
    let data = {};
    try { data = JSON.parse(event.postback.data || '{}'); } catch {}

    if (data.t === 'answer') {
      const sess = sessions.get(userId);
      sess.answers[data.q] = data.v;
      await sendNextQuestion(userId, event.replyToken);
      return;
    }
    if (data.t === 'stop') {
      if (data.v === 'yes') {
        sessions.delete(userId);
        await safeReply(event.replyToken, { type:'text', text:'見積りを停止しました。通常のトークができます。' });
      } else {
        await safeReply(event.replyToken, { type:'text', text:'見積りを継続します。' });
        await sendNextQuestion(userId);
      }
      return;
    }
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const text = (event.message.text || '').trim();

    if (CMD_RESET.includes(text)) {
      sessions.delete(userId);
      await safeReply(event.replyToken, { type:'text', text:'初期化しました。もう一度「カンタン見積りを依頼」と入力してください。' });
      return;
    }

    if (TRIGGER_START.includes(text)) {
      sessions.set(userId, { answers: {}, step: 0 });
      await safeReply(event.replyToken, { type:'text', text:'見積もりを開始します。以下の質問にお答えください。' });
      await sendNextQuestion(userId);
      return;
    }

    const sess = sessions.get(userId);
    if (sess && currentIndex(sess.answers) < QUESTIONS.length) {
      await safeReply(event.replyToken, { type:'text', text:'ボタンからお選びください。選択肢を再表示します。' });
      await sendStopConfirm(userId);
      return;
    }

    await safeReply(event.replyToken, { type:'text', text:'「カンタン見積りを依頼」と入力すると見積もりを開始します。' });
    return;
  }
}

// ===== 起動 =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`listening on ${PORT}`));
