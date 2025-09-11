// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import line from '@line/bot-sdk';
import { randomUUID } from 'crypto';

// --- 必須環境変数（Render の Environment に設定） ---
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL || 'https://line-paint.onrender.com';
const FRIEND_ADD_URL = process.env.FRIEND_ADD_URL || 'https://lin.ee/XxmuVXt';
const LINE_BOT_BASIC_ID = process.env.LINE_BOT_BASIC_ID || '@004szogc';
const LIFF_ID = process.env.LIFF_ID || '';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// LINE クライアント
const lineConfig = {
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
};
const client = new line.Client(lineConfig);

// 送信待ちの見積データ（メモリ）: key=pendingId
const PENDING = new Map(); // { answers, amount, ts }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of PENDING.entries()) {
    if (now - v.ts > 30 * 60 * 1000) PENDING.delete(k); // 30分で破棄
  }
}, 5 * 60 * 1000);

// --- 概算計算（既存の lib/estimate.js がある場合はそれを利用） ---
function computeRoughQuote(a) {
  try {
    // 動的 import（存在すれば使う）
    return import('./lib/estimate.js').then(m => m.computeRoughQuote(a));
  } catch {
    // フォールバックの仮計算
    let base = 500_000;
    if (a.scope === '外壁') base += 0;
    else if (a.scope === '屋根') base -= 150_000;
    else if (a.scope === '外壁と屋根') base += 250_000;

    if (a.floors === '3階建て以上') base += 250_000;
    else if (a.floors === '2階建て') base += 100_000;

    const ageMap = { '1〜5年':0,'6〜10年':80_000,'11〜15年':120_000,'16〜20年':180_000,'21〜25年':240_000,'26〜30年':300_000,'31年以上':360_000 };
    base += ageMap[a.age] ?? 100_000;

    const matMap = { 'サイディング':120_000,'モルタル':100_000,'ALC':140_000,'ガルバリウム':160_000,'木':90_000,'RC':180_000,'その他':110_000,'わからない':110_000 };
    base += matMap[a.material] ?? 100_000;

    return Math.round(base / 10_000) * 10_000;
  }
}
const formatJPY = n => `¥${Number(n).toLocaleString('ja-JP')}`;

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// Web アンケートの最終送信 → pendingId を払い出す
app.post('/api/estimate', async (req, res) => {
  const answers = req.body || {};
  const amount = await computeRoughQuote(answers);

  const pendingId = randomUUID().slice(0, 8);
  PENDING.set(pendingId, { answers, amount, ts: Date.now() });

  // 友だち追加URL（指定のもの）と、トークを開く deep-link
  const talkUrl =
    `https://line.me/R/oaMessage/${encodeURIComponent(LINE_BOT_BASIC_ID)}/?` +
    encodeURIComponent(`見積受け取り ${pendingId}`);

  res.json({
    ok: true,
    amount,
    pendingId,
    addFriendUrl: FRIEND_ADD_URL,
    talkUrl,
    liffUrl: LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : null,
  });
});

// Webhook（LINE 側設定： https://line-paint.onrender.com/line/webhook ）
app.post('/line/webhook', line.middleware(lineConfig), async (req, res) => {
  const events = req.body.events || [];
  await Promise.all(events.map(handleEvent));
  res.status(200).end();
});

async function handleEvent(event) {
  // 友だち追加
  if (event.type === 'follow') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text:
        '友だち追加ありがとうございます。\n' +
        'Webでのアンケート送信後に表示される「LINEを開く」をタップすると、概算見積をお届けします。',
    });
  }

  // ユーザーからのメッセージ
  if (event.type === 'message' && event.message?.type === 'text') {
    const text = event.message.text.trim();
    const m = text.match(/^見積受け取り\s+([A-Za-z0-9_-]{6,})$/);
    if (m) {
      const id = m[1];
      const pending = PENDING.get(id);
      if (!pending) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '見積IDが見つかりませんでした。お手数ですが、Webからもう一度お試しください。',
        });
      }
      await pushQuote(event.source.userId, pending);
      PENDING.delete(id);

      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ありがとうございます。トークに概算見積をお送りしました。',
      });
    }

    // その他の発話
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'アンケート送信後に「LINEを開く」から「見積受け取り 〇〇」を送ると、概算見積をお届けします。',
    });
  }

  return null;
}

async function pushQuote(userId, pending) {
  const { amount, answers } = pending;

  const header = {
    type: 'text',
    text:
      `お見積もりのご依頼ありがとうございます。\n` +
      `ご希望の工事内容の概算見積額は ${formatJPY(amount)} です。\n\n` +
      `（※アンケート内容からの自動試算です。詳しいお見積もりは下のボタンからお進みください）`,
  };

  const detailText =
    `■見積もり希望内容: ${answers.scope}\n` +
    `■築年数: ${answers.age}\n` +
    `■階数: ${answers.floors}\n` +
    `■外壁材: ${answers.material}`;
  const details = { type: 'text', text: detailText };

  const actions = [];
  if (LIFF_ID) {
    actions.push({
      type: 'uri',
      label: '詳しい見積もりを依頼',
      uri: `https://liff.line.me/${LIFF_ID}`,
    });
  }

  const buttonTemplate =
    actions.length
      ? {
          type: 'template',
          altText: '詳しい見積もりを依頼',
          template: {
            type: 'buttons',
            title: '詳しい見積もり',
            text: '図面や写真のアップロードで正式見積をご提示します。',
            actions,
          },
        }
      : null;

  const messages = buttonTemplate ? [header, details, buttonTemplate] : [header, details];

  await client.pushMessage(userId, messages);
}

app.listen(PORT, () => {
  console.log('[INFO] server started', { PORT, BASE_URL });
});
