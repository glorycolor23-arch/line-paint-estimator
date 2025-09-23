import { Router } from 'express';
import { middleware as lineMiddleware } from '@line/bot-sdk';
import estimateRouter from './estimate.js';
import detailsRouter from './details.js';
import lineLoginRouter from './lineLogin.js';
import { client, liffButtonMessage } from './lib/lineClient.js';
import { findLeadByUser, pickPending, getEstimate } from './lib/store.js';

export function registerBackendRoutes(app) {
  const webhookRouter = Router();
  const signatureMw = lineMiddleware({ channelSecret: process.env.LINE_CHANNEL_SECRET });
  webhookRouter.post('/webhook', signatureMw, async (req, res) => {
    const events = req.body?.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  });
  app.use('/line', webhookRouter);

  app.use('/api/estimate', estimateRouter);
  app.use('/api/details', detailsRouter);
  app.use('/auth/line', lineLoginRouter);

  app.use('/line', (err, req, res, _next) => {
    console.error('Webhook error:', err);
    res.status(200).end();
  });
}

async function handleEvent(event) {
  try {
    if (event.type === 'follow') {
      const userId = event.source.userId;
      let leadId = findLeadByUser(userId) || pickPending(userId);

      if (!leadId) {
        await client.pushMessage(userId, { type: 'text', text: '友だち追加ありがとうございます。はじめにアンケートへご回答ください。' });
        return;
      }

      const est = getEstimate(leadId);
      if (!est) {
        await client.pushMessage(userId, { type: 'text', text: '概算見積もりを計算しています。少々お待ちください。' });
        return;
      }

      await client.pushMessage(userId, { type: 'text', text: est.text });
      const url = `${process.env.LIFF_URL}?lead=${encodeURIComponent(leadId)}`;
      await client.pushMessage(userId, liffButtonMessage(url));
      return;
    }

    if (event.type === 'message' && event.message.type === 'text') {
      const txt = (event.message.text || '').trim();
      if (txt.includes('詳細')) {
        const userId = event.source.userId;
        const leadId = findLeadByUser(userId);
        const url = `${process.env.LIFF_URL}${leadId ? `?lead=${encodeURIComponent(leadId)}` : ''}`;
        await client.replyMessage(event.replyToken, [
          { type: 'text', text: 'こちらから詳細見積もりをご確認ください。' },
          liffButtonMessage(url),
        ]);
        return;
      }
    }
  } catch (e) {
    console.error('handleEvent error', e);
  }
}
