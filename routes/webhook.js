import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';
import { findLeadIdByUserId, getEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

if (!CHANNEL_ACCESS_TOKEN) console.warn('[WARN] LINE_CHANNEL_ACCESS_TOKEN is empty');
if (!CHANNEL_SECRET) console.warn('[WARN] LINE_CHANNEL_SECRET is empty');

const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

// 署名検証ミドルウェア（raw body 必須）
const mw = lineMiddleware({ channelSecret: CHANNEL_SECRET });

// 手動動作確認用（GET 200）
router.get('/webhook', (_req, res) => res.status(200).type('text').send('ok'));

// 本番：LINE からの POST（Console 検証もここに来る）
router.post('/webhook', mw, async (req, res, _next) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (events.length === 0) return res.sendStatus(200); // 検証は events:[] なので 200
    await Promise.all(events.map(handleEvent));
    res.sendStatus(200);
  } catch (e) {
    console.error('[WEBHOOK ERROR]', e);
    // 検証失敗で 500 を返すと Console がエラーになるため 200 で吸収
    res.sendStatus(200);
  }
});

/**
 * ★ 署名NG時は lineMiddleware が next(err) を呼ぶ。
 *   その場合でも 200 を返して Console「検証」を落とさないようにする。
 */
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
      let estimate = null;
      if (leadId) estimate = await getEstimateForLead(leadId); // { price, summaryText } 想定

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
