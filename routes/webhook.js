// routes/webhook.js
import express from 'express';
import { middleware, Client } from '@line/bot-sdk';

const router = express.Router();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

// LINE SDK クライアント
const client = new Client({
  channelAccessToken: config.channelAccessToken,
});

// 署名検証ミドルウェア
const lineMw = middleware({ channelSecret: config.channelSecret });

// どちらのパスでも受けるように（/line/webhook 推奨）
router.post(['/line/webhook', '/webhook'], lineMw, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    console.log('[WEBHOOK] events length:', events.length);

    // 検証(Verify)は events: [] が来る → すぐ 200 でOK
    if (events.length === 0) {
      res.sendStatus(200);
      return;
    }

    await Promise.all(events.map(handleEvent));
    res.sendStatus(200);
  } catch (err) {
    // 例外が出ても 200 を返す（Verify を通すため）＋ログ
    console.error('[WEBHOOK ERROR]', err);
    res.sendStatus(200);
  }
});

async function handleEvent(event) {
  console.log('[EVENT]', JSON.stringify(event));
  const type = event.type;
  const userId = event?.source?.userId;

  // 友だち追加時は LIFF へ誘導
  if (type === 'follow' && userId) {
    const liffUrl =
      process.env.LIFF_URL || `https://liff.line.me/${process.env.LIFF_ID || ''}`;

    const msg = {
      type: 'text',
      text:
        '友だち追加ありがとうございます！\n' +
        '「見積額をLINEで受け取る」をタップしてLIFFを開いてください。\n' +
        `${liffUrl ? `\n${liffUrl}` : ''}`,
      quickReply: liffUrl
        ? {
            items: [
              { type: 'action', action: { type: 'uri', label: '見積額を受け取る', uri: liffUrl } },
            ],
          }
        : undefined,
    };

    await client.pushMessage(userId, msg);
    return;
  }

  // ここに message / postback 等の処理を足していく
}

export default router;
