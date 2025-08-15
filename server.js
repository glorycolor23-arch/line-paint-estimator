/**
 * ============================================
 * 外壁塗装オンライン見積もり - 完全版サーバ (改修版)
 * ============================================
 * - ESM ("type":"module")
 * - Render Health Check: /health
 * - LIFF env injection  : /liff/env.js
 * - LINE Webhook        : /webhook
 * - Flex Message 質問カード & 画像アップロード
 * - セッション（メモリ）で質問フローを管理
 *
 * === 改修のポイント ===
 * 1. 応答トークン失効問題の解決:
 *    - `replyMessage` はユーザーアクションへの直接的な応答(1回)に限定。
 *    - 次の質問など、ボットから能動的に送るメッセージはすべて `pushMessage` を使用。
 *    - これにより「隣の家との距離」などの質問の後で処理が止まる問題を完全に解消。
 * 2. 非同期処理の安定化:
 *    - `sendNextQuestion` の呼び出しから `replyToken` の引き渡しを廃止。
 *    - `async/await` の使い方を整理し、処理の流れを明確化。
 * 3. セッション管理の厳密化と堅牢性向上:
 *    - `awaitingImage` フラグを廃止し `expectType` に状態管理を統一。
 *    - 意図しない入力に対するフォールバック応答を追加。
 */

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import cors from 'cors';
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
// LIFF 用の静的ファイル配信
app.use('/liff', express.static(path.join(__dirname, 'liff')));


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
const sessions = new Map(); // userId -> { index, answers, last, expectType }

function getSession(userId) {
  const now = Date.now();
  const s = sessions.get(userId);
  if (!s) return null;
  if (now - s.last > SESS_TTL_MS) {
    sessions.delete(userId);
    return null;
  }
  s.last = now; // アクセス時刻を更新
  return s;
}
function initSession(userId) {
  const s = {
    index: 0,
    last: Date.now(),
    answers: {},
    expectType: 'choice', // 'choice' | 'photo'
    questions: QUESTIONS_ROUGH_ESTIMATE, // デフォルトは概算見積もり用の質問
  };
  sessions.set(userId, s);
  return s;
}
function updateSession(userId, patch) {
  const s = getSession(userId);
  if (!s) return null;
  Object.assign(s, patch);
  sessions.set(userId, s);
  return s;
}
function resetSession(userId) {
  sessions.delete(userId);
}

// ===============================
// 3) 質問定義（仕様書準拠）
// ===============================
const QUESTIONS_ROUGH_ESTIMATE = [
  { type: 'choice', key: 'floorCount',   title: '1/10 工事物件の階数は？', options: ['1階建て', '2階建て', '3階建て'] },
  { type: 'choice', key: 'layout',       title: '2/10 物件の間取りは？', options: ['1K', '1DK', '1LDK', '2K', '2DK', '2LDK', '3K', '3DK', '4K', '4DK', '4LDK'] },
  { type: 'choice', key: 'age',          title: '3/10 物件の築年数は？', options: ['新築', '〜10年', '〜20年', '〜30年', '〜40年', '〜50年', '51年以上'] },
  { type: 'choice', key: 'paintHistory', title: '4/10 過去に塗装をした経歴は？', options: ['ある', 'ない', 'わからない'] },
  { type: 'choice', key: 'lastPaint',    title: '5/10 前回の塗装はいつ頃？', options: ['〜5年', '5〜10年', '10〜20年', '20〜30年', 'わからない'], depends: (ans) => ans.paintHistory === 'ある' },
  { type: 'choice', key: 'workType',     title: '6/10 ご希望の工事内容は？', options: ['外壁塗装', '屋根塗装', '外壁塗装+屋根塗装'] },
  { type: 'choice', key: 'wallType',     title: '7/10 外壁の種類は？', options: ['モルタル', 'サイディング', 'タイル', 'ALC'], depends: (ans) => ans.workType?.includes('外壁') },
  { type: 'choice', key: 'roofType',     title: '8/10 屋根の種類は？', options: ['瓦', 'スレート', 'ガルバリウム', 'トタン'], depends: (ans) => ans.workType?.includes('屋根') },
  { type: 'choice', key: 'leak',         title: '9/10 雨漏りや漏水の症状はありますか？', options: ['雨の日に水滴が落ちる', '天井にシミがある', 'ない'] },
  { type: 'choice', key: 'distance',     title: '10/10 隣や裏の家との距離は？（周囲で一番近い距離）', options: ['30cm以下', '50cm以下', '70cm以下', '70cm以上'] },
];

const QUESTIONS_DETAILED_ESTIMATE = [
  { type: 'photo',  key: 'elevation',    title: '1/9 立面図をアップロードしてください。' },
  { type: 'photo',  key: 'plan',         title: '2/9 平面図をアップロードしてください。' },
  { type: 'photo',  key: 'section',      title: '3/9 断面図をアップロードしてください。' },
  { type: 'photo',  key: 'front',        title: '4/9 正面の外観写真をアップロードしてください。（周囲の地面が写るように）' },
  { type: 'photo',  key: 'right',        title: '5/9 右側の外観写真をアップロードしてください。' },
  { type: 'photo',  key: 'left',         title: '6/9 左側の外観写真をアップロードしてください。' },
  { type: 'photo',  key: 'back',         title: '7/9 後ろ側の外観写真をアップロードしてください。' },
  { type: 'photo',  key: 'garage',       title: '8/9 車庫の位置がわかる写真をアップロードしてください。' },
  { type: 'photo',  key: 'crack',        title: '9/9 外壁や屋根にヒビ/割れがある場合は写真をアップロードしてください。' },
];

const QUESTIONS = QUESTIONS_ROUGH_ESTIMATE;
const PLACEHOLDER_IMG = 'https://images.unsplash.com/photo-1501183638710-841dd1904471?q=80&w=1200&auto=format&fit=crop';

// ===============================
// 4) ユーティリティ
// ===============================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function toCurrency(n) { return '¥ ' + (Math.round(n / 1000) * 1000).toLocaleString(); }

function calcEstimate(ans) {
  let price = 300000;
  if (ans.floorCount === '2階建て') price += 150000;
  if (ans.floorCount === '3階建て') price += 300000;
  if (ans.workType === '外壁塗装') price += 200000;
  if (ans.workType === '屋根塗装') price += 150000;
  if (ans.workType === '外壁塗装+屋根塗装') price += 330000;
  if (ans.distance === '30cm以下') price += 50000;
  if (ans.distance === '50cm以下') price += 30000;
  if (ans.distance === '70cm以下') price += 10000;
  const ageMap = { '新築': 0, '〜10年': 1, '〜20年': 2, '〜30年': 3, '〜40年': 4, '〜50年': 5, '51年以上': 6 };
  price += (ageMap[ans.age] || 0) * 20000;
  return price;
}

function buildChoiceFlex(title, options) {
  const bubbles = options.map((op) => ({
    type: 'bubble',
    hero: { type: 'image', url: PLACEHOLDER_IMG, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' },
    body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: op, weight: 'bold', size: 'md', wrap: true }] },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [{ type: 'button', style: 'primary', color: '#00C853', action: { type: 'message', label: '選ぶ', text: op } }] }
  }));
  const chunks = [];
  for (let i = 0; i < bubbles.length; i += 12) { // Carouselは最大12個
    chunks.push({ type: 'flex', altText: title, contents: { type: 'carousel', contents: bubbles.slice(i, i + 12) } });
  }
  return chunks;
}

function buildEstimateFlex(amount, liffId) {
  const liffUrl = `https://liff.line.me/${liffId}`;
  return {
    type: 'flex',
    altText: '詳しい見積もりのご案内',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: '概算見積もり', weight: 'bold', size: 'lg' },
          { type: 'separator', margin: 'md' },
          { 
            type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
            contents: [
              { type: 'text', text: toCurrency(amount), weight: 'bold', size: 'xl', align: 'center' },
              { type: 'text', text: '※ご入力内容を元に算出した概算です。', wrap: true, size: 'xs', color: '#666666', margin: 'md' },
            ]
          }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{ type: 'button', style: 'primary', color: '#00C853', action: { type: 'uri', label: '詳細見積もりを依頼する', uri: liffUrl } }]
      }
    }
  };
}

// --- 次の質問を送信 ---
async function sendNextQuestion(userId) {
  const s = getSession(userId);
  if (!s) return;

  while (s.index < s.questions.length) {
    const q = s.questions[s.index];
    if (q.depends && !q.depends(s.answers)) {
      s.index += 1;
      updateSession(userId, { index: s.index });
      continue;
    }

    updateSession(userId, { expectType: q.type });

    if (q.type === 'choice') {
      const flexes = buildChoiceFlex(q.title, q.options);
      await client.pushMessage(userId, { type: 'text', text: q.title });
      for (const m of flexes) {
        await client.pushMessage(userId, m);
        await sleep(200);
      }
      return;
    }

    if (q.type === 'photo') {
      await client.pushMessage(userId, {
        type: 'text',
        text: `${q.title}\n\n写真がない場合は「スキップ」と送信してください。`,
        quickReply: { items: [{ type: 'action', action: { type: 'message', label: 'スキップ', text: 'スキップ' } }] }
      });
      return;
    }
  }

  // --- 完了 ---
  const amount = calcEstimate(s.answers);
  const liffId = process.env.LIFF_ID || "";
  await client.pushMessage(userId, [
    { type: "text", text: "ありがとうございます。概算見積もりの質問が完了しました。" },
    buildEstimateFlex(amount, liffId),
    { type: "text", text: "より詳細な見積もりをご希望の場合は、以下のLIFFアプリから必要事項と写真をご登録ください。" },
    { type: "flex", altText: "詳細見積もり依頼", contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "詳細見積もり依頼", weight: "bold", size: "lg" },
          { type: "separator", margin: "md" },
          { type: "text", text: "名前、電話番号、住所、そして写真のアップロードをお願いします。", wrap: true, size: "sm", margin: "md" }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", style: "primary", color: "#00C853", action: { type: "uri", label: "LIFFアプリを開く", uri: `https://liff.line.me/${liffId}` } }
        ]
      }
    }}
  ]);
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
  res.status(200).send(`window.__LIFF_ENV__ = { LIFF_ID: ${JSON.stringify(LIFF_ID)}, FRIEND_ADD_URL: ${JSON.stringify(FRIEND_ADD_URL)} };`);
});

// ===============================
// 6) Webhook
// ===============================
app.post('/webhook', lineMiddleware(lineConfig), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(e => handleEvent(e).catch(err => {
        console.error(`[handleEvent Error] for user ${e.source?.userId}`, err)
    })));
    res.status(200).send('ok');
  } catch (err) {
    console.error('[Webhook Error]', err);
    res.status(500).send('error');
  }
});

// ===============================
// 7) イベントハンドラ
// ===============================
async function handleEvent(event) {
  if (event.type !== 'message' || !event.source?.userId) {
    return;
  }
  const userId = event.source.userId;
  const replyToken = event.replyToken;



  // --- テキストメッセージ ---
  if (event.message.type === 'text') {
    const text = (event.message.text || '').trim();

    if (['はじめから', 'リセット', 'やり直す'].includes(text)) {
      resetSession(userId);
      await client.replyMessage(replyToken, { type: 'text', text: '会話をリセットしました。「カンタン見積りを依頼」と入力して再開してください。' });
      return;
    }

    if (text === 'カンタン見積りを依頼') {
      initSession(userId);
      await client.replyMessage(replyToken, { type: 'text', text: 'オンライン見積もりを開始します。' });
      await sendNextQuestion(userId);
      return;
    }

    const s = getSession(userId);
    if (!s) {
      await client.replyMessage(replyToken, { type: 'text', text: '「カンタン見積りを依頼」と送信すると、質問が始まります。' });
      return;
    }

    const q = s.questions[s.index];
    if (!q) { // 完了しているはずなのにメッセージが来た場合
        resetSession(userId);
        await client.replyMessage(replyToken, { type: 'text', text: '見積もりは完了しています。もう一度始めるには「カンタン見積りを依頼」と送信してください。' });
        return;
    }



    if (s.expectType === 'choice' && q.options.includes(text)) {
      s.answers[q.key] = text;
      s.index += 1;
      updateSession(userId, s);
      await client.replyMessage(replyToken, { type: 'text', text: `「${text}」ですね。承知しました。` });
      await sendNextQuestion(userId);
      return;
    }

    // 意図しない入力へのフォールバック
    if (s.expectType === 'photo') {
        await client.replyMessage(replyToken, { type: 'text', text: '写真のアップロードはLIFFアプリからお願いします。' });
    } else if (s.expectType === 'choice') {
        await client.replyMessage(replyToken, { type: 'text', text: '画面に表示されている選択肢の中から、ボタンを押して回答してください。' });
    }
  }
}

// ===============================
// 8) サーバ起動
// ===============================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
