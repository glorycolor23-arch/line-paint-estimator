import express from 'express';
import { middleware, Client } from '@line/bot-sdk';
import { CONFIG } from '../config.js';

const router = express.Router();
const lineConfig = {
  channelAccessToken: CONFIG.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: CONFIG.LINE_CHANNEL_SECRET
};
const client = new Client(lineConfig);

// Webhook 受信（RenderのURLをLINE Developersに設定）
router.post('/line/webhook', middleware(lineConfig), async (req, res) => {
  const events = req.body.events || [];
  await Promise.all(events.map(handleEvent));
  res.status(200).end();
});

async function handleEvent(event) {
  if (event.type === 'follow') {
    // 友だち追加時の挨拶（lead未紐付けのため一般的な案内に留める）
    try {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '友だち追加ありがとうございます。Web上で回答後に表示される「LINEで見積額を受け取る」ボタンから続きへお進みください。'
      });
    } catch (e) {
      console.error(e);
    }
  }
  // 必要に応じて message/postback handlers を追加
}

export default router;