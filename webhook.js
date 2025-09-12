// routes/webhook.js
import express from "express";
import { middleware as lineMiddleware, Client } from "@line/bot-sdk";

const router = express.Router();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.CHANNEL_ACCESS_TOKEN || "",
  channelSecret: process.env.LINE_CHANNEL_SECRET || "",
};

const client = lineConfig.channelAccessToken ? new Client(lineConfig) : null;

// /line/webhook を受信（最低限の200応答）
router.post("/line/webhook", lineMiddleware(lineConfig), async (req, res) => {
  try {
    const events = req.body?.events || [];
    // 必要であれば follow 時の案内などを送る
    await Promise.all(events.map(async (ev) => {
      if (!client) return;
      if (ev.type === "follow") {
        await client.replyMessage(ev.replyToken, {
          type: "text",
          text: "友だち追加ありがとうございます。Webで回答後に表示されるボタンからLINE連携を完了してください。",
        });
      }
    }));
    res.status(200).end();
  } catch (e) {
    console.error("[/line/webhook] error", e);
    res.status(200).end();
  }
});

export default router;
