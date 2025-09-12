// webhook.js
import express from "express";
import * as line from "@line/bot-sdk";

const router = express.Router();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN, // Messaging API
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

const BASE_URL =
  (process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, "") : "") ||
  "https://line-paint.onrender.com";

const DETAILS_LIFF_URL =
  process.env.DETAILS_LIFF_URL || `${BASE_URL}/liff.html`;

router.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body?.events || [];
  await Promise.all(events.map(handleEvent));
  res.sendStatus(200);
});

async function handleEvent(event) {
  // 友だち追加直後に詳細ボタンを送る（push）
  if (event.type === "follow" && event.source?.userId) {
    await sendDetailsInvite(event.source.userId);
    return;
  }

  // テキストメッセージの簡易トリガー（「詳細」でボタン再送）
  if (event.type === "message" && event.message?.type === "text") {
    const t = event.message.text.trim();
    if (t === "詳細" || t === "詳細見積もり") {
      await client.replyMessage(event.replyToken, makeDetailsMessages());
    }
  }
}

function makeDetailsMessages() {
  return [
    {
      type: "text",
      text:
        "より詳しいお見積もりをご希望の方は、下のボタンから詳細情報をご入力ください。",
    },
    {
      type: "template",
      altText: "詳細見積もりの入力",
      template: {
        type: "buttons",
        text: "詳細見積もりの入力",
        actions: [{ type: "uri", label: "詳細見積もりを入力する", uri: DETAILS_LIFF_URL }],
      },
    },
  ];
}

async function sendDetailsInvite(userId) {
  try {
    await client.pushMessage(userId, makeDetailsMessages());
  } catch (e) {
    console.error("[pushMessage error]", e?.response?.data || e);
  }
}

export default router;
