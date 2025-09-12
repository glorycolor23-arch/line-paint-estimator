// webhook.js
import express from "express";
// ✅ default ではなく名前空間 import を使う
import * as line from "@line/bot-sdk";

const router = express.Router();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

// Render の環境変数に設定推奨
const BASE_URL =
  (process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, "") : "") ||
  "https://line-paint.onrender.com";

// 詳細見積もりの LIFF へ飛ばすリンク
// 1) DETAILS_LIFF_URL（例: https://liff.line.me/<LIFF_ID>）
// 2) 未設定なら自サイトの /liff.html
const DETAILS_LIFF_URL =
  process.env.DETAILS_LIFF_URL || `${BASE_URL}/liff.html`;

// 受信エンドポイント
router.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body?.events || [];
  await Promise.all(events.map(handleEvent));
  res.sendStatus(200);
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  // 動作確認用：トークで「テスト:概算完了」と送ると下の2通を返信
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
