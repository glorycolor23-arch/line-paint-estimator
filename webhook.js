import express from 'express';
import { middleware as lineMiddleware } from '@line/bot-sdk';
import { client, liffButtonMessage } from './lib/lineClient.js';
import { findLeadByUser, pickPending, getEstimate } from './lib/store.js';

const router = express.Router();

// @line/bot-sdk の署名検証ミドルウェア
const middleware = lineMiddleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

// Webhook エンドポイント
router.post('/webhook', middleware, async (req, res, next) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    // LINE 側は 200 を期待
    res.status(200).end();
  } catch (e) {
    next(e);
  }
});

async function handleEvent(event) {
  try {
    // 友だち追加（follow）で概算 → LIFFボタンを順に送信
    if (event.type === 'follow') {
      const userId = event.source.userId;
      let leadId = findLeadByUser(userId) || pickPending(userId);

      if (!leadId) {
        await client.pushMessage(userId, {
          type: 'text',
          text: '友だち追加ありがとうございます。はじめにアンケートへご回答ください。',
        });
        return;
      }

      const est = getEstimate(leadId);
      if (!est) {
        await client.pushMessage(userId, {
          type: 'text',
          text: '概算見積もりを計算しています。少々お待ちください。',
        });
        return;
      }

      await client.pushMessage(userId, { type: 'text', text: est.text });
      const url = `${process.env.LIFF_URL}?lead=${encodeURIComponent(leadId)}`;
      await client.pushMessage(userId, liffButtonMessage(url));
      return;
    }

    // テキストメッセージで「詳細」キーワードに反応して LIFF を案内
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
    // 個別イベント処理中の例外はログのみ（Webhook全体を落とさない）
    console.error('handleEvent error', e);
  }
}

// （任意だが推奨）Webhook全体のエラーハンドラ：LINE 側の再送を避けるため 200 を返す
router.use((err, req, res, _next) => {
  console.error('Webhook error:', err);
  res.status(200).end();
});

export default router;
