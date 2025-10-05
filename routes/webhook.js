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

// LIFF への遷移先を決定（常に leadId クエリで統一）
function resolveLiffUrl(leadId) {
  const LIFF_ID  = process.env.LIFF_ID || '';
  const LIFF_URL = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';
  if (LIFF_ID) {
    const base = `https://liff.line.me/${LIFF_ID}`;
    return leadId ? `${base}?leadId=${encodeURIComponent(leadId)}` : base;
  }
  if (LIFF_URL) {
    return leadId
      ? LIFF_URL + (LIFF_URL.includes('?') ? '&' : '?') + `leadId=${encodeURIComponent(leadId)}`
      : LIFF_URL;
  }
  const origin = process.env.BASE_URL || process.env.PUBLIC_BASE_URL || '';
  return origin
    ? `${origin.replace(/\/+$/, '')}/liff.html${leadId ? `?leadId=${encodeURIComponent(leadId)}` : ''}`
    : '';
}

// 手動確認用
router.get('/webhook', (_req, res) => res.status(200).type('text').send('ok'));

// 本番：/line/webhook（互換で /webhook も受ける）
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
  const type = event?.type;
  const userId = event?.source?.userId;
  if (!userId) return;

  if (type === 'follow') {
    try {
      // 事前に login/LIFF で保存済みなら leadId が取れる
      const leadId = await findLeadIdByUserId(userId);
      const liffUrl = resolveLiffUrl(leadId || '');

      if (leadId) {
        const estimate = await getEstimateForLead(leadId);
        if (estimate) {
          const priceFmt =
            estimate.price != null
              ? Number(estimate.price).toLocaleString('ja-JP')
              : '—';
          const detail =
            estimate.summaryText
              ? `\n— ご回答内容 —\n${estimate.summaryText}`
              : '';

          const msg1 = {
            type: 'text',
            text:
              `お見積もりのご依頼ありがとうございます。\n` +
              `概算お見積額は ${priceFmt} 円です。${detail}`,
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

      // まだマッピング/概算が無い場合は LIFF ボタンのみ
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
}

export default router;
