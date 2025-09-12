// routes/webhook.js
import express from "express";
import { middleware as lineMiddleware, Client } from "@line/bot-sdk";
import { findLeadIdByUserId, getEstimateForLead } from "../store/linkStore.js";

const router = express.Router();

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
});

const mw = lineMiddleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET || "",
});

// LIFF の URL を統一的に生成（/liff.html をデフォルトに）
function resolveLiffUrl(leadId = "") {
  if (process.env.LIFF_ID) {
    const base = `https://liff.line.me/${process.env.LIFF_ID}`;
    return leadId ? `${base}?lead=${encodeURIComponent(leadId)}` : base;
  }
  const raw = process.env.LIFF_URL || "";
  if (!raw) return "";
  // /liff/index.html -> /liff.html に強制補正（存在しないディレクトリ対策）
  const fixed = raw.replace(/\/liff\/index\.html$/i, "/liff.html");
  return leadId ? `${fixed}${fixed.includes("?") ? "&" : "?"}lead=${encodeURIComponent(leadId)}` : fixed;
}

// /line/webhook（推奨）と /webhook（互換）
router.post(["/webhook", "/line/webhook"], mw, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (events.length === 0) return res.sendStatus(200);
    await Promise.all(events.map(handleEvent));
    res.sendStatus(200);
  } catch (e) {
    console.error("[WEBHOOK ERROR]", e);
    res.sendStatus(200);
  }
});

async function handleEvent(event) {
  const type = event?.type;
  const userId = event?.source?.userId;
  if (!userId) return;

  // 友だち追加時：概算 → LIFF の順で送る（紐付けがある場合）
  if (type === "follow") {
    try {
      const leadId = await findLeadIdByUserId(userId);

      if (!leadId) {
        // 未紐付けの場合は LIFF への誘導だけ（リンクは /liff.html ベース）
        const liffUrl = resolveLiffUrl();
        const msg = {
          type: "text",
          text:
            "友だち追加ありがとうございます。\n" +
            "お見積もりの内容を受け取るには、こちらから開いてください。",
          quickReply: liffUrl
            ? { items: [{ type: "action", action: { type: "uri", label: "見積内容を受け取る", uri: liffUrl } }] }
            : undefined,
        };
        await lineClient.pushMessage(userId, msg);
        return;
      }

      // 概算の取得（事前に保存されている想定）
      const estimate = await getEstimateForLead(leadId);
      const priceFmt =
        estimate?.price != null ? Number(estimate.price).toLocaleString("ja-JP") : "—";

      const liffUrl = resolveLiffUrl(leadId);

      const msgs = [
        {
          type: "text",
          text:
            "お見積もりのご依頼ありがとうございます。\n" +
            `概算お見積額は ${priceFmt} 円 です。\n` +
            "※ご回答内容をもとに算出した概算です。",
        },
        {
          type: "text",
          text: "より詳しいお見積もりをご希望の方はこちらからお進みください。",
          quickReply: liffUrl
            ? { items: [{ type: "action", action: { type: "uri", label: "詳しい見積もりを依頼する", uri: liffUrl } }] }
            : undefined,
        },
      ];

      await lineClient.pushMessage(userId, msgs);
    } catch (e) {
      console.error("[FOLLOW ERROR]", e);
    }
  }
}

export default router;
