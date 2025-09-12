import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';
import { findLeadIdByUserId, getEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

if (!CHANNEL_ACCESS_TOKEN) console.warn('[WARN] LINE_CHANNEL_ACCESS_TOKEN is empty');
if (!CHANNEL_SECRET) console.warn('[WARN] LINE_CHANNEL_SECRET is empty');

const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

// 署名検証ミドルウェア。server 側で req.rawBody を常時保持しているので順序依存なし
const mw = lineMiddleware({ channelSecret: CHANNEL_SECRET });

// 手動確認用（GET 200）
router.get('/webhook', (_req, res) => res.status(200).type('text').send('ok'));

// LINE からの POST。必ず 200 を返す（Console 検証で 500 を出さない）
router.post('/webhook', mw, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (events.length === 0) return res.sendStatus(200); // 検証時はここで 200

    await Promise.all(events.map(handleEvent));
    res.sendStatus(200);
  } catch (e) {
    console.error('[WEBHOOK ERROR]', e);
    res.sendStatus(200); // ここも 200 固定
  }
});

// mw 内の署名NGなどのエラーを 200 に変換（Console 検証が落ちないように）
router.use('/webhook', (err, _req, res, _next) => {
  console.error('[WEBHOOK SIGNATURE ERROR]', err?.message || err);
  return res.sendStatus(200);
});

async function handleEvent(event) {
  const type = event?.type;
  const userId = event?.source?.userId;
  if (!userId) return;

  if (type === 'follow') {
    try {
      const leadId = await findLeadIdByUserId(userId);
      const estimate = leadId ? await getEstimateForLead(leadId) : null;

      const liffUrl = process.env.LIFF_ID
        ? `https://liff.line.me/${process.env.LIFF_ID}${leadId ? `?lead=${encodeURIComponent(leadId)}` : ''}`
        : (process.env.LIFF_URL || '');

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
    } catch (e) {
      console.error('[FOLLOW ERROR]', e);
    }
  }
}

export default router;
