// server.js  — ESM対応・LINE連携・静的配信・概算API・Webhook

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import pkg from '@line/bot-sdk';            // ★ CommonJS を ESM から利用
const { Client, middleware } = pkg;

dotenv.config();

/* ===== 環境変数 ===== */
const {
  PORT = 10000,
  NODE_ENV = 'production',

  // LINE Messaging API（必須）
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,

  // 公式アカウントのベーシックID（@を含める）
  LINE_BASIC_ID = '@004szogc',

  // 友だち追加URL
  FRIEND_ADD_URL = 'https://lin.ee/XxmuVXt',

  // 公開URL（LIFFリンクなどで使用）
  PUBLIC_BASE_URL = 'https://line-paint.onrender.com',
} = process.env;

/* ===== LINE SDK ===== */
const lineConfig = {
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
};
const lineEnabled = !!(LINE_CHANNEL_ACCESS_TOKEN && LINE_CHANNEL_SECRET);
const lineClient = lineEnabled ? new Client(lineConfig) : null;

/* ===== Express 基本設定 ===== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/* ===== 監視用 ===== */
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

/* ===== ページ ===== */
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/liff', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'liff.html')));

/* ===== 概算見積 API ===== */
const pending = new Map(); // {id: {answers, amount, createdAt}}

app.post('/api/estimate', (req, res) => {
  try {
    const answers = req.body || {};
    const amount = calcAmount(answers);
    const pendingId = uuidv4().slice(0, 8);

    pending.set(pendingId, { answers, amount, createdAt: Date.now() });

    // ユーザーの入力欄が開いた状態でOAトークを開くリンク
    const talkUrl = `https://line.me/R/oaMessage/${encodeURIComponent(
      LINE_BASIC_ID
    )}/?${encodeURIComponent(`見積受け取り ${pendingId}`)}`;

    res.json({
      ok: true,
      amount,
      pendingId,
      addFriendUrl: FRIEND_ADD_URL,
      talkUrl,
    });
  } catch (e) {
    console.error('[API] /api/estimate error', e);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

/* ===== Webhook ===== */
if (lineEnabled) {
  app.post('/line/webhook', middleware(lineConfig), async (req, res) => {
    try {
      await Promise.all((req.body.events || []).map(handleEvent));
      res.sendStatus(200);
    } catch (e) {
      console.error('[Webhook] handler error', e);
      res.sendStatus(200);
    }
  });
} else {
  console.warn('[WARN] LINE credentials not set — /line/webhook is disabled.');
}

/* ===== イベント処理 ===== */
async function handleEvent(event) {
  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const text = (event.message.text || '').trim();
  const m = text.match(/^見積受け取り\s+([A-Za-z0-9-]+)/);

  if (m) {
    const id = m[1];
    const data = pending.get(id);

    if (!data) {
      return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: '申し訳ありません。IDが見つかりませんでした。もう一度フォームからお試しください。',
      });
    }

    pending.delete(id); // 1度使ったIDは破棄

    const detailUrl = `${PUBLIC_BASE_URL}/liff`;
    const messages = [
      { type: 'text', text: `概算見積額は ${formatYen(data.amount)} です。` },
      {
        type: 'text',
        text:
          `より詳しいお見積もりをご希望の方は、こちらから詳細情報をご入力ください。\n` +
          `${detailUrl}`,
      },
    ];
    return lineClient.replyMessage(event.replyToken, messages);
  }

  // ガイダンス
  return lineClient.replyMessage(event.replyToken, {
    type: 'text',
    text: 'フォーム送信後に届くIDを「見積受け取り ＊＊＊＊」の形式で送ってください。',
  });
}

/* ===== 見積計算（簡易ロジック） ===== */
function calcAmount(a) {
  let base = 180000;
  if (a.floors?.includes('2')) base += 120000;
  if (a.floors?.includes('3')) base += 260000;
  if (a.scope === '屋根') base += 90000;
  if (a.scope === '外壁と屋根') base += 190000;
  if (a.material?.includes('ALC')) base += 80000;
  if (a.material?.includes('ガルバリウム')) base += 120000;
  if (a.material?.includes('木')) base += 70000;
  if (a.age?.includes('21') || a.age?.includes('31')) base += 60000;
  return Math.max(base, 80000);
}

function formatYen(n) {
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(n);
}

/* ===== 起動 ===== */
app.listen(PORT, () => {
  console.log('[INFO] server started', {
    port: PORT,
    env: NODE_ENV,
    lineEnabled,
    baseUrl: PUBLIC_BASE_URL,
  });
});
