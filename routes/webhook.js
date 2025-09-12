// routes/webhook.js
import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';
import { findLeadIdByUserId, getEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

if (!CHANNEL_ACCESS_TOKEN) console.warn('[WARN] LINE_CHANNEL_ACCESS_TOKEN is empty');
if (!CHANNEL_SECRET) console.warn('[WARN] LINE_CHANNEL_SECRET is empty');

const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

// 署名検証ミドルウェア（server.js 側で rawBody を保持しているので順序依存なし）
const mw = lineMiddleware({ channelSecret: CHANNEL_SECRET });

// 動作確認用 GET
router.get('/webhook', (_req, res) => res.status(200).type('text').send('ok'));

// LINE からの POST（検証時/例外時も必ず 200 を返す）
router.post('/webhook', mw, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (events.length === 0) return res.sendStatus(200);
    await Promise.all(events.map(handleEvent));
    res.sendStatus(200);
  } catch (e) {
    console.error('[WEBHOOK ERROR]', e);
    res.sendStatus(200);
  }
});

// 署名NGなどのエラーも 200 固定（Console 検証で失敗させない）
router.use('/webhook', (err, _req, res, _next) => {
  console.error('[WEBHOOK SIGNATURE ERROR]', err?.message || err);
  return res.sendStatus(200);
});

// ======================================================
// イベント処理
//  - follow: 友だち追加時に 概算 → LIFF リンク を送付
//  - message: 友だち追加済みでも同じ内容をフォールバック送付
// ======================================================
async function handleEvent(event) {
  const type = event?.type;
  const userId = event?.source?.userId;
  if (!userId) return;

  try {
    switch (type) {
      case 'follow':
        await sendEstimateAndLiff(userId);
        break;

      case 'message':
        // テキスト・スタンプ等どれでもフォールバックで案内
        await sendEstimateAndLiff(userId);
        break;

      default:
        // それ以外は無視
        break;
    }
  } catch (e) {
    console.error('[HANDLE EVENT ERROR]', type, e);
  }
}

// 概算があれば概算 + LIFF、なければ LIFF だけを送る
async function sendEstimateAndLiff(userId) {
  const leadId = await findLeadIdByUserId(userId).catch(() => null);
  const estimate = leadId ? await getEstimateForLead(leadId).catch(() => null) : null;

  const liffUrlBase =
    process.env.LIFF_ID
      ? `https://liff.line.me/${process.env.LIFF_ID}`
      : (process.env.LIFF_URL || '');

  const liffUrl = leadId && liffUrlBase
    ? `${liffUrlBase}?lead=${encodeURIComponent(leadId)}`
    : liffUrlBase;

  if (estimate && typeof estimate.price === 'number') {
    const priceFmt = estimate.price.toLocaleString('ja-JP');

    const msgs = [
      {
        type: 'text',
        text:
          'お見積もりのご依頼ありがとうございます。\n' +
          `概算お見積額は ${priceFmt} 円 です。\n` +
          '※ご回答内容をもとに算出した概算です。',
      },
      {
        type: 'text',
        text: 'より詳しいお見積もりをご希望の方はこちらからお進みください。',
        quickReply: liffUrl
          ? { items: [{ type: 'action', action: { type: 'uri', label: '詳しい見積もりを依頼する', uri: liffUrl } }] }
          : undefined,
      },
    ];

    await lineClient.pushMessage(userId, msgs);
  } else {
    const msg = {
      type: 'text',
      text:
        '友だち追加ありがとうございます。\n' +
        'お見積もりの続きはこちらから開いてください。',
      quickReply: liffUrl
        ? { items: [{ type: 'action', action: { type: 'uri', label: '見積もりを続ける', uri: liffUrl } }] }
        : undefined,
    };

    await lineClient.pushMessage(userId, msg);
  }
}

export default router;
