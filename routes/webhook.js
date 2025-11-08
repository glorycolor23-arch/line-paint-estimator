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

      if (est && est.answers) {
        // 新しいメッセージ形式
        const summaryText = '外壁塗装オンライン見積もりにご連絡ありがとうございます。\nご連絡いただいた内容の概算見積もりは以下の通りです。\n\n【回答内容】\n・お見積もり希望内容\n　' + (est.answers.desiredWork || '') + '\n・築年数\n　' + (est.answers.ageRange || '') + '\n・階数\n　' + (est.answers.floors || '') + '\n・外壁材\n　' + (est.answers.wallMaterial || '') + '\n\n概算見積もり金額\n¥' + Number(est.price).toLocaleString('ja-JP');
        
        const detailText = 'より詳しいお見積もりをご希望の方はこちら。\nこちらのフォームに回答いただくと、現地調査での訪問は行わず正確な工事金額をご提示いたします。\nご提示した見積額で発注も可能です。';
        
        await lineClient.pushMessage(userId, [
          { type: 'text', text: summaryText },
          { type: 'text', text: detailText },
          {
            type: 'template',
            altText: '詳細見積もりのご案内',
            template: {
              type: 'buttons',
              title: '詳細見積もりのご案内',
              text: '下記ボタンよりお進みください',
              actions: [
                { type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: liffUrl || 'https://line.me' }
              ]
            }
          }
        ]);
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

