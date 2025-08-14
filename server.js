/**
 * ============================================
 * 外壁塗装オンライン見積もり - 完全版サーバ
 * ============================================
 * - ESM ("type":"module")
 * - Render Health Check: /health
 * - LIFF env injection  : /liff/env.js
 * - LINE Webhook        : /webhook
 * - Flex Message 質問カード & 画像アップロード
 * - セッション（メモリ）で質問フローを管理
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import cors from 'cors';

// ★ default import ではなく「名前付き import」
import { Client, middleware as lineMiddleware } from '@line/bot-sdk';

// ===============================
// 0) 基本セットアップ
// ===============================
dotenv.config();

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(bodyParser.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/static', express.static(path.join(__dirname, 'public')));

// ===============================
// 1) LINE SDK 設定
// ===============================
const lineConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
if (!lineConfig.channelAccessToken || !lineConfig.channelSecret) {
  console.error('[FATAL] CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET が未設定です。Render の Environment を確認してください。');
  process.exit(1);
}
const client = new Client(lineConfig);

// ===============================
// 2) セッション管理（メモリ）
// ===============================
const SESS_TTL_MS = 60 * 60 * 1000; // 60 分
const sessions = new Map(); // userId -> { index, answers, last, expectType, ... }

function getSession(userId) {
  const now = Date.now();
  const s = sessions.get(userId);
  if (!s) return null;
  if (now - s.last > SESS_TTL_MS) {
    sessions.delete(userId);
    return null;
  }
  return s;
}
function initSession(userId) {
  const s = {
    index: 0,
    last: Date.now(),
    answers: {},
    expectType: 'choice', // 'choice' | 'photo'
    awaitingImage: false,
  };
  sessions.set(userId, s);
  return s;
}
function updateSession(userId, patch) {
  const s = getSession(userId);
  if (!s) return null;
  Object.assign(s, patch);
  s.last = Date.now();
  sessions.set(userId, s);
  return s;
}
function resetSession(userId) {
  sessions.delete(userId);
}

// ===============================
// 3) 質問定義（仕様書準拠）
// ===============================
/**
 * type: "choice" | "photo"
 * key : 保存キー
 * title: 質問文
 * options: ["a","b",...]  // choice のみ
 * depends: (answers) => boolean // 出し分け（外壁/屋根による分岐など）
 */
const QUESTIONS = [
  {
    type: 'choice',
    key: 'floorCount',
    title: '1/19 工事物件の階数は？',
    options: ['1階建て', '2階建て', '3階建て'],
  },
  {
    type: 'choice',
    key: 'layout',
    title: '2/19 物件の間取りは？',
    options: ['1K', '1DK', '1LDK', '2K', '2DK', '2LDK', '3K', '3DK', '4K', '4DK', '4LDK'],
  },
  {
    type: 'choice',
    key: 'age',
    title: '3/19 物件の築年数は？',
    options: ['新築', '〜10年', '〜20年', '〜30年', '〜40年', '〜50年', '51年以上'],
  },
  {
    type: 'choice',
    key: 'paintHistory',
    title: '4/19 過去に塗装をした経歴は？',
    options: ['ある', 'ない', 'わからない'],
  },
  {
    type: 'choice',
    key: 'lastPaint',
    title: '5/19 前回の塗装はいつ頃？',
    options: ['〜5年', '5〜10年', '10〜20年', '20〜30年', 'わからない'],
  },
  {
    type: 'choice',
    key: 'workType',
    title: '6/19 ご希望の工事内容は？',
    options: ['外壁塗装', '屋根塗装', '外壁塗装+屋根塗装'],
  },
  {
    type: 'choice',
    key: 'wallType',
    title: '7/19 外壁の種類は？',
    options: ['モルタル', 'サイディング', 'タイル', 'ALC'],
    depends: (ans) => (ans.workType === '外壁塗装' || ans.workType === '外壁塗装+屋根塗装'),
  },
  {
    type: 'choice',
    key: 'roofType',
    title: '8/19 屋根の種類は？',
    options: ['瓦', 'スレート', 'ガルバリウム', 'トタン'],
    depends: (ans) => (ans.workType === '屋根塗装' || ans.workType === '外壁塗装+屋根塗装'),
  },
  {
    type: 'choice',
    key: 'leak',
    title: '9/19 雨漏りや漏水の症状はありますか？',
    options: ['雨の日に水滴が落ちる', '天井にシミがある', 'ない'],
  },
  {
    type: 'choice',
    key: 'distance',
    title: '10/19 隣や裏の家との距離は？（周囲で一番近い距離）',
    options: ['30cm以下', '50cm以下', '70cm以下', '70cm以上'],
  },
  // --- 写真アップロード（画像 or "スキップ"）---
  { type: 'photo', key: 'elevation', title: '11/19 立面図をアップロードしてください。（なければ「スキップ」）' },
  { type: 'photo', key: 'plan',      title: '12/19 平面図をアップロードしてください。（なければ「スキップ」）' },
  { type: 'photo', key: 'section',   title: '13/19 断面図をアップロードしてください。（なければ「スキップ」）' },
  { type: 'photo', key: 'front',     title: '14/19 正面の外観写真をアップロードしてください。（周囲の地面が写るように）' },
  { type: 'photo', key: 'right',     title: '15/19 右側の外観写真をアップロードしてください。' },
  { type: 'photo', key: 'left',      title: '16/19 左側の外観写真をアップロードしてください。' },
  { type: 'photo', key: 'back',      title: '17/19 後ろ側の外観写真をアップロードしてください。' },
  { type: 'photo', key: 'garage',    title: '18/19 車庫の位置がわかる写真をアップロードしてください。' },
  { type: 'photo', key: 'crack',     title: '19/19 外壁や屋根にヒビ/割れがある場合は写真をアップしてください。（なければ「スキップ」）' },
];

// Flex のダミー画像（完成イメージ用）
const PLACEHOLDER_IMG = 'https://images.unsplash.com/photo-1501183638710-841dd1904471?q=80&w=1200&auto=format&fit=crop';

// ===============================
// 4) ユーティリティ
// ===============================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toCurrency(n) {
  return '¥ ' + (Math.round(n / 1000) * 1000).toLocaleString();
}

// --- 概算見積計算（簡易ロジック）---
function calcEstimate(ans) {
  let price = 300000; // base

  // 階数
  if (ans.floorCount === '2階建て') price += 150000;
  if (ans.floorCount === '3階建て') price += 300000;

  // 工事内容
  if (ans.workType === '外壁塗装') price += 200000;
  if (ans.workType === '屋根塗装') price += 150000;
  if (ans.workType === '外壁塗装+屋根塗装') price += 330000;

  // 距離（足場）
  if (ans.distance === '30cm以下') price += 50000;
  if (ans.distance === '50cm以下') price += 30000;
  if (ans.distance === '70cm以下') price += 10000;

  // 築年数（古いほど割増）
  const ageMap = { '新築': 0, '〜10年': 1, '〜20年': 2, '〜30年': 3, '〜40年': 4, '〜50年': 5, '51年以上': 6 };
  price += (ageMap[ans.age] || 0) * 20000;

  return price;
}

// --- Flex: 質問カード（選択肢）---
// 10 個を超える場合は分割送信
function buildChoiceFlex(title, options) {
  const bubbles = options.map((op) => ({
    type: 'bubble',
    hero: {
      type: 'image',
      url: PLACEHOLDER_IMG,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: op, weight: 'bold', size: 'md', wrap: true }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#00C853',
          action: { type: 'message', label: '選ぶ', text: op }
        }
      ]
    }
  }));

  const chunks = [];
  for (let i = 0; i < bubbles.length; i += 10) {
    chunks.push({
      type: 'flex',
      altText: title,
      contents: {
        type: 'carousel',
        contents: bubbles.slice(i, i + 10)
      }
    });
  }
  return chunks;
}

// --- Flex: 概算表示 + LIFF ボタン ---
function buildEstimateFlex(amount, liffId) {
  const liffUrl = liffId ? `https://liff.line.me/${liffId}` : 'https://liff.line.me/';
  return {
    type: 'flex',
    altText: '詳しい見積もりのご案内',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '詳しい見積もりをご希望の方へ', weight: 'bold', size: 'md' },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            contents: [
              { type: 'text', text: '見積り金額', weight: 'bold', size: 'sm', color: '#666666' },
              { type: 'text', text: toCurrency(amount), weight: 'bold', size: 'xl', color: '#000000' },
              { type: 'text', text: '上記はご入力内容を元に算出した概算金額です。', wrap: true, size: 'sm', color: '#666666', margin: 'md' },
              { type: 'text', text: '正式なお見積りが必要な方は続けてご入力をお願いします。', wrap: true, size: 'sm', color: '#666666' }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#00C853',
            action: { type: 'uri', label: '現地調査なしで見積を依頼', uri: liffUrl }
          }
        ]
      }
    }
  };
}

// --- 次の質問を送信 ---
async function sendNextQuestion(userId, replyToken, s) {
  // index が進むまでループ（depends でスキップされた場合）
  while (s.index < QUESTIONS.length) {
    const q = QUESTIONS[s.index];
    if (q.depends && !q.depends(s.answers)) {
      s.index += 1; // スキップ
      continue;
    }

    if (q.type === 'choice') {
      // 確認 + 遅延 → Flex 複数送信も安全に
      await client.replyMessage(replyToken, { type: 'text', text: `${q.title}` });
      await sleep(250);

      const flexes = buildChoiceFlex(q.title, q.options);
      for (const m of flexes) {
        await client.pushMessage(userId, m);
        await sleep(200);
      }
      updateSession(userId, { expectType: 'choice' });
      return;
    }

    if (q.type === 'photo') {
      await client.replyMessage(replyToken, {
        type: 'text',
        text: `${q.title}\n※写真が無い場合は「スキップ」と送信してください。`
      });
      updateSession(userId, { expectType: 'photo', awaitingImage: true });
      return;
    }
  }

  // ここまで来たら完了 → 概算表示
  const amount = calcEstimate(s.answers);
  const liffId = process.env.LIFF_ID || '';
  await client.replyMessage(replyToken, [
    { type: 'text', text: 'ありがとうございます。概算の計算が完了しました。' },
    buildEstimateFlex(amount, liffId)
  ]);

  // セッションは保持しておいても良いが、ここで破棄しておく
  resetSession(userId);
}

// ===============================
// 5) Health / LIFF ENV
// ===============================
app.get('/health', (_req, res) => res.status(200).send('ok'));

app.get('/liff/env.js', (_req, res) => {
  const LIFF_ID = process.env.LIFF_ID || '';
  const FRIEND_ADD_URL = process.env.FRIEND_ADD_URL || '';
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.status(200).send(
    `// Generated by server
window.__LIFF_ENV__ = { LIFF_ID: ${JSON.stringify(LIFF_ID)}, FRIEND_ADD_URL: ${JSON.stringify(FRIEND_ADD_URL)} };`
  );
});

// ===============================
// 6) Webhook
// ===============================
app.post('/webhook', lineMiddleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(e => handleEvent(e).catch(err => console.error('[handleEvent]', err))));
    res.status(200).end();
  } catch (e) {
    console.error('[webhook]', e);
    res.status(200).end();
  }
});

// ===============================
// 7) イベントハンドラ
// ===============================
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // 画像メッセージ処理
  if (event.type === 'message' && event.message.type === 'image') {
    const s = getSession(userId);
    if (!s || s.expectType !== 'photo') {
      await client.replyMessage(event.replyToken, { type: 'text', text: '写真を受け取りました。ありがとうございます。' });
      return;
    }
    // 実際の保存は省略（必要なら getMessageContent で取得）
    const q = QUESTIONS[s.index];
    s.answers[q.key] = '(画像受領)';
    s.index += 1;
    updateSession(userId, { awaitingImage: false, expectType: 'choice' });
    await client.replyMessage(event.replyToken, { type: 'text', text: '写真を受け取りました。次の質問へ進みます。' });
    await sleep(250);
    await sendNextQuestion(userId, event.replyToken, s);
    return;
  }

  // テキストメッセージ処理
  if (event.type === 'message' && event.message.type === 'text') {
    const text = (event.message.text || '').trim();
    const normalized = text.replace(/\s/g, '');

    // --- 強制リセット ---
    if (['はじめからやり直す', 'やり直し', 'リセット'].includes(text)) {
      resetSession(userId);
      await client.replyMessage(event.replyToken, { type: 'text', text: '会話をリセットしました。もう一度「カンタン見積りを依頼」と送信してください。' });
      return;
    }

    // --- スタート ---
    if (normalized === 'カンタン見積りを依頼') {
      const s0 = initSession(userId);
      await client.replyMessage(event.replyToken, { type: 'text', text: '見積もりを開始します。以下の質問にお答えください。' });
      await sleep(250);
      await sendNextQuestion(userId, event.replyToken, s0);
      return;
    }

    // --- 進行中か？ ---
    const s = getSession(userId);
    if (!s) {
      // 進行中でない → 案内
      await client.replyMessage(event.replyToken, { type: 'text', text: '「カンタン見積りを依頼」と送信すると、質問が始まります。' });
      return;
    }

    // --- 写真待ちで「スキップ」 ---
    if (s.expectType === 'photo') {
      if (['スキップ', 'skip', 'なし', '無'].includes(text.toLowerCase())) {
        const q = QUESTIONS[s.index];
        s.answers[q.key] = '(スキップ)';
        s.index += 1;
        updateSession(userId, { awaitingImage: false, expectType: 'choice' });
        await client.replyMessage(event.replyToken, { type: 'text', text: 'スキップしました。次の質問へ進みます。' });
        await sleep(250);
        await sendNextQuestion(userId, event.replyToken, s);
        return;
      }
      // 写真待ちだがテキスト → 案内
      await client.replyMessage(event.replyToken, { type: 'text', text: '写真を送信するか「スキップ」と入力してください。' });
      return;
    }

    // --- 選択肢の質問への回答 ---
    const q = QUESTIONS[s.index];
    if (q && q.type === 'choice') {
      if (q.options.includes(text)) {
        s.answers[q.key] = text;
        s.index += 1;
        updateSession(userId, {});
        await client.replyMessage(event.replyToken, { type: 'text', text: `「${text}」で承りました。次の質問へ進みます。` });
        await sleep(250);
        await sendNextQuestion(userId, event.replyToken, s);
        return;
      }
      // 不正入力
      await client.replyMessage(event.replyToken, { type: 'text', text: '候補からお選びください。' });
      return;
    }

    // それ以外
    await client.replyMessage(event.replyToken, { type: 'text', text: '入力を受け付けました。' });
  }
}

// ===============================
// 8) サーバ起動
// ===============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`server listening on ${PORT}`));
