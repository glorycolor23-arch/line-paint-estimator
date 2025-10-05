// routes/webhook.js
import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';
import { findLeadIdByUserId, getEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});
const mw = lineMiddleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
});

function resolveLiffUrl(lead) {
  const LIFF_ID = process.env.LIFF_ID || '';
  const LIFF_URL = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';
  if (LIFF_ID) {
    const base = `https://liff.line.me/${LIFF_ID}`;
    return lead ? `${base}?lead=${encodeURIComponent(lead)}` : base;
  }
  if (LIFF_URL) {
    return lead
      ? LIFF_URL + (LIFF_URL.includes('?') ? '&' : '?') + `lead=${encodeURIComponent(lead)}`
      : LIFF_URL;
  }
  const origin = process.env.BASE_URL || process.env.PUBLIC_BASE_URL || '';
  return origin ? `${origin.replace(/\/+$/, '')}/liff.html${lead ? `?lead=${encodeURIComponent(lead)}` : ''}` : '';
}

// /line/webhook（推奨）と /webhook（互換）
router.post(['/line/webhook', '/webhook'], mw, async (req, res) => {
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
  const type = event.type;
  const userId = event?.source?.userId;
  if (!userId) return;

  if (type === 'follow') {
    try {
      const leadId = await findLeadIdByUserId(userId);
      const liffUrl = resolveLiffUrl(leadId || '');

      if (leadId) {
        const estimate = await getEstimateForLead(leadId);
        if (estimate) {
          const priceFmt =
            estimate.price != null
              ? Number(estimate.price).toLocaleString('ja-JP')
              : '—';

          const msg1 = {
            type: 'text',
            text:
              `お見積もりのご依頼ありがとうございます。\n` +
              `概算お見積額は ${priceFmt} 円です。\n` +
              `※ご回答内容をもとに算出した概算です。`,
          };

          const msg2 = {
            type: 'template',
            altText: '詳細見積もりのご案内',
            template: {
              type: 'buttons',
              title: 'より詳しいお見積もりをご希望の方はこちらから。',
              text: '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
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
          text: '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
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

  // 任意：ユーザーのメッセージでLIFFを返す
  if (type === 'message' && event.message?.type === 'text') {
    const q = (event.message.text || '').trim();
    if (/詳細見積もり|見積もりを依頼|無料で詳細|現地調査なし/i.test(q)) {
      const leadId = await findLeadIdByUserId(userId);
      const liffUrl = resolveLiffUrl(leadId || '');
      const msg = {
        type: 'template',
        altText: '詳細見積もりのご案内',
        template: {
          type: 'buttons',
          title: 'より詳しいお見積もりをご希望の方はこちらから。',
          text: '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
          actions: [
            { type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: liffUrl || 'https://line.me' },
          ],
        },
      };
      try {
        await lineClient.replyMessage(event.replyToken, msg);
      } catch (e) {
        console.error('[MSG REPLY ERROR]', e);
      }
    }
  }
}

export default router;
