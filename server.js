// server.js（検証通過用の最小・安全版）
import express from 'express';
import * as line from '@line/bot-sdk';

const {
  CHANNEL_SECRET = '',
  CHANNEL_ACCESS_TOKEN = '',
  PORT,
} = process.env;

if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
  console.error('[BOOT] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です');
  process.exit(1);
}

const config = {
  channelSecret: CHANNEL_SECRET,
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
};
const client = new line.Client(config);

const app = express();

// health check（Render 用）
app.get('/health', (_, res) => res.status(200).send('ok'));

// LINE Webhook
// ※ ここでは bodyParser を使わず、LINE ミドルウェアだけを通す
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = Array.isArray(req.body.events) ? req.body.events : [];
    await Promise.all(events.map(async (ev) => {
      // 念のための簡易応答（検証時は events = [] のこともある）
      if (ev.type === 'message' && ev.message.type === 'text') {
        await client.replyMessage(ev.replyToken, { type: 'text', text: 'ok' });
      }
    }));
    // ★ ここで必ず 200 を返す（検証 OK の決め手）
    return res.status(200).end();
  } catch (e) {
    // 例外が出ても 200 を返して LINE 側の 502 を避ける
    console.error('[WEBHOOK ERROR]', e?.response?.data || e);
    return res.status(200).end();
  }
});

const listenPort = Number(PORT) || 10000;
app.listen(listenPort, () => console.log(`listening on ${listenPort}`));
