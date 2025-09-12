// routes/webhook.js
import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';
import { findLeadIdByUserId, getEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});
const mw = lineMiddleware({ channelSecret: process.env.LINE_CHANNEL_SECRET || '' });

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

  // 友だち追加：自動で概算をプッシュ
  if (type === 'follow') {
    try {
      // 1) 事前の LINE ログインで紐付いた leadId を取得
      const leadId = await findLeadIdByUserId(userId);
      if (!leadId) {
        // まだ未連携なら、LIFF で連携を促すメッセージ
        const liffUrl = process.env.LIFF_ID
          ? `https://liff.line.me/${process.env.LIFF_ID}`
          : (process.env.LIFF_URL || '');
        const msg = {
          type: 'text',
          text:
            '友だち追加ありがとうございます。\n' +
            'お見積もりの内容を受け取るには、こちらから開いてください。',
          quickReply: liffUrl
            ? { items: [{ type: 'action', action: { type: 'uri', label: '見積内容を受け取る', uri: liffUrl } }] }
            : undefined,
        };
        await lineClient.pushMessage(userId, msg);
        return;
      }

      // 2) 概算の取得（保存済みの回答→概算）
      const estimate = await getEstimateForLead(leadId); // { price, summaryText } を返す想定

      // 3) 概算をトークへ送信
      const priceFmt = estimate?.price != null
        ? estimate.price.toLocaleString('ja-JP')
        : '—';

      const liffUrl = process.env.LIFF_ID
        ? `https://liff.line.me/${process.env.LIFF_ID}?lead=${encodeURIComponent(leadId)}`
        : (process.env.LIFF_URL || '');

      const msgs = [
        {
          type: 'text',
          text:
            'お見積もりのご依頼ありがとうございます。\n' +
            `概算お見積額は **${priceFmt} 円** です。\n` +
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
    } catch (e) {
      console.error('[FOLLOW ERROR]', e);
    }
  }
}

export default router;
