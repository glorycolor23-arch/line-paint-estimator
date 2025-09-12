// routes/webhook.js
import express from "express";
import { middleware as lineMiddleware, Client } from "@line/bot-sdk";

const router = express.Router();

const channelAccessToken =
  process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.CHANNEL_ACCESS_TOKEN || "";
const channelSecret = process.env.LINE_CHANNEL_SECRET || "";

const lineConfig = {
  channelAccessToken,
  channelSecret,
};

const client = channelAccessToken ? new Client(lineConfig) : null;

// LINE Messaging API Webhook
// - 既読性のため follow 時だけ軽い案内を返す
// - それ以外は 200 を即返し、後段の処理を邪魔しない
router.post("/line/webhook", lineMiddleware(lineConfig), async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  try {
    for (const ev of events) {
      if (!client) continue;

      // 友だち追加時の簡易案内（任意）
      if (ev.type === "follow") {
        await client.replyMessage(ev.replyToken, {
          type: "text",
          text:
            "友だち追加ありがとうございます。\n" +
            "Webのアンケートに回答後、表示される連携ボタンからログインすると、LINEに概算と詳細入力リンクをお送りします。",
        });
      }

      // 任意：ユーザーが「見積」と送ってきたらWebを案内
      if (ev.type === "message" &&
          ev.message?.type === "text" &&
          ev.message.text?.trim() === "見積") {
        await client.replyMessage(ev.replyToken, {
          type: "text",
          text: "こちらからアンケートを開始してください：\nhttps://line-paint.onrender.com/",
        });
      }
    }
  } catch (e) {
    console.error("[/line/webhook] error:", e);
  } finally {
    // 必ず 200 を返す
    res.status(200).end();
  }
});

export default router;
