// routes/webhook.js
import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';
import { findLeadIdByUserId, getEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const LIFF_ID = process.env.LIFF_ID || '';
const LIFF_URL_ENV = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';
const BASE_URL = (process.env.BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/,'');

const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });
const mw = lineMiddleware({ channelSecret: CHANNEL_SECRET });

function resolveLiffUrl(lead) {
  if (LIFF_ID) {
    const base = `https://liff.line.me/${LIFF_ID}`;
    return lead ? `${base}?leadId=${encodeURIComponent(lead)}` : base;
  }
  if (LIFF_URL_ENV) {
    return lead
      ? LIFF_URL_ENV + (LIFF_URL_ENV.includes('?') ? '&' : '?') + `leadId=${encodeURIComponent(lead)}`
      : LIFF_URL_ENV;
  }
  if (BASE_URL) {
    return `${BASE_URL}/liff.html${lead ? `?leadId=${encodeURIComponent(lead)}` : ''}`;
  }
  return '/liff.html';
}

// 手動確認用
router.get('/webhook', (_req, res) => res.status(200).type('text').send('ok'));

// 本番：/line/webhook
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

async function handleEvent(event) {
  const type = event?.type;
  const userId = event?.source?.userId;
  if (!userId) return;

  if (type === 'follow') {
    try {
      const leadId = await findLeadIdByUserId(userId);
      const liffUrl = resolveLiffUrl(leadId || '');

      if (leadId) {
        const est = await getEstimateForLead(leadId);
        if (est?.summaryText) {
          const msg1 = { type: 'text', text: est.summaryText };
          const msg2 = {
            type: 'template',
            altText: '詳細見積もりのご案内',
            template: {
              type: 'buttons',
              title: 'より詳しいお見積もりをご希望の方はこちらから。',
              text: '現地調査なしで無料の詳細見積もりが可能です。',
              actions: [
                { type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: liffUrl || 'https://line.me' },
              ],
            },
          };
          await lineClient.pushMessage(userId, [msg1, msg2]);
          return;
        }
      }

      // 概算がまだ無い/lead が無いときは LIFF ボタンのみ
      const msg = {
        type: 'template',
        altText: '詳細見積もりのご案内',
        template: {
          type: 'buttons',
          title: 'より詳しいお見積もりをご希望の方はこちらから。',
          text: '現地調査なしで無料の詳細見積もりが可能です。',
          actions: [
            { type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: liffUrl || 'https://line.me' },
          ],
        },
      };
      await lineClient.pushMessage(userId, msg);
    } catch (e) {
      console.error('[FOLLOW ERROR]', e);
    }
  }
}

export default router;
