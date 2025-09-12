// webhook.js
import express from "express";
import line from "@line/bot-sdk";

const router = express.Router();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

// ベースURL（Renderの環境変数に設定推奨）
const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, "") || "https://line-paint.onrender.com";

// LIFF の誘導URLを決定
// 1) DETAILS_LIFF_URL（例: https://liff.line.me/<LIFF_ID>）
// 2) なければ自サイトの /liff.html
const DETAILS_LIFF_URL =
  process.env.DETAILS_LIFF_URL ||
  `${BASE_URL}/liff.html`;

// 受信エンドポイント
router.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body.events ?? [];
  await Promise.all(events.map(handleEvent));
  res.status(200).end();
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  // ここでは単純に「見積もり完了後に送る想定の2通」を例示
  if (event.message.text.trim() === "テスト:概算完了") {
    const messages = [
      {
        type: "text",
        text:
          "概算見積もりの金額をお届けしました。\n" +
          "より詳しいお見積もりをご希望の方は、下のボタンから詳細情報をご入力ください。",
      },
      {
        type: "template",
        altText: "詳細見積もりの入力",
        template: {
          type: "buttons",
          text: "詳細見積もりの入力",
          actions: [
            {
              type: "uri",
              label: "詳細見積もりを入力する",
              uri: DETAILS_LIFF_URL,
            },
          ],
        },
      },
    ];
    await client.replyMessage(event.replyToken, messages);
  }
}

export default router;
