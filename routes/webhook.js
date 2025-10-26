// routes/webhook.js
import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';
import { findLeadIdByUserId, getEstimateForLead } from '../store/linkStore.js';

const router = express.Router();
const lineClient = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '' });
const mw = lineMiddleware({ channelSecret: process.env.LINE_CHANNEL_SECRET || '' });

function resolveLiffUrl(lead) {
  const LIFF_ID = process.env.LIFF_ID || '';
  const LIFF_URL = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';
  if (LIFF_ID) return `https://liff.line.me/${LIFF_ID}${lead ? `?leadId=${encodeURIComponent(lead)}` : ''}`;
  if (LIFF_URL) return LIFF_URL + (lead ? (LIFF_URL.includes('?') ? '&' : '?') + `leadId=${encodeURIComponent(lead)}` : '');
  return `/liff.html${lead ? `?leadId=${encodeURIComponent(lead)}` : ''}`;
}

router.post(['/line/webhook', '/webhook'], mw, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    await Promise.all(events.map(handleEvent));
  } catch (e) {
    console.error('[WEBHOOK ERROR]', e);
  }
  res.sendStatus(200);
});

async function handleEvent(event) {
  const type = event.type;
  const userId = event?.source?.userId;
  if (!userId) return;

  if (type === 'follow') {
    try {
      const leadId = await findLeadIdByUserId(userId);
      const est = leadId ? await getEstimateForLead(leadId) : null;
      const liffUrl = resolveLiffUrl(leadId || '');

      if (est) {
        const msg1 = { type: 'text', text: est.summaryText ||
          `概算お見積額は ${Number(est.price).toLocaleString('ja-JP')} 円です。` };
        const msg2 = {
          type: 'template',
          altText: '詳細見積もりのご案内',
          template: {
            type: 'buttons',
            title: 'より詳しいお見積もりをご希望の方はこちらから。',
            text: '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
            actions: [
              { type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: liffUrl || 'https://line.me' }
            ]
          }
        };
        await lineClient.pushMessage(userId, [msg1, msg2]);
      } else {
        await lineClient.pushMessage(userId, {
          type: 'template',
          altText: '詳細見積もりのご案内',
          template: {
            type: 'buttons',
            title: 'より詳しいお見積もりをご希望の方はこちらから。',
            text: '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
            actions: [{ type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: liffUrl || 'https://line.me' }]
          }
        });
      }
    } catch (e) {
      console.error('[FOLLOW ERROR]', e);
    }
  }
}

export default router;
