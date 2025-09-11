// routes/webhook.js
import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';

const router = express.Router();

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

// 署名検証＋JSON 解析は LINE ミドルウェアに任せる
const mw = lineMiddleware({ channelSecret: CHANNEL_SECRET });

// /line/webhook（推奨）と /webhook（互換）の両方で受ける
router.post(['/line/webhook', '/webhook'], mw, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    console.log('[WEBHOOK] events length:', events.length);

    // Verify（検証）時は events: [] が来る → 即 200
    if (events.length === 0) {
      return res.sendStatus(200);
    }

    await Promise.all(events.map(handleEvent));
    return res.sendStatus(200);
  } catch (err) {
    // 何があっても 200 を返す（検証を確実に通す）
    console.error('[WEBHOOK ERROR]', err);
    return res.sendStatus(200);
  }
});

async function handleEvent(event) {
  try {
    console.log('[EVENT]', JSON.stringify(event));

    const type = event.type;
    const userId = event?.source?.userId;

    // 友だち追加：LIFFへ誘導（最初の一歩を確実に）
    if (type === 'follow' && userId) {
      const liffUrl =
        process.env.LIFF_URL || (process.env.LIFF_ID ? `https://liff.line.me/${process.env.LIFF_ID}` : '');

      const msg = {
        type: 'text',
        text:
          '友だち追加ありがとうございます！\n' +
          '「見積額をLINEで受け取る」をタップしてLIFFを開いてください。\n' +
          (liffUrl ? `\n${liffUrl}` : ''),
        quickReply: liffUrl
          ? {
              items: [{ type: 'action', action: { type: 'uri', label: '見積額を受け取る', uri: liffUrl } }],
            }
          : undefined,
      };

      await lineClient.pushMessage(userId, msg);
      return;
    }

    // 以降、必要に応じて message / postback などの処理を追加
    // if (type === 'message' && event.message?.type === 'text') { ... }

  } catch (e) {
    console.error('[HANDLE EVENT ERROR]', e);
    // エラーでも他イベントには影響させない
  }
}

export default router;
