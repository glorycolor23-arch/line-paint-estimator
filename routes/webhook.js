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

function resolveLiffUrl(leadId) {
  const LIFF_ID = process.env.LIFF_ID || "";
  const LIFF_URL = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || "";
  if (LIFF_ID) {
    const base = `https://liff.line.me/${LIFF_ID}`;
    return leadId ? `${base}?leadId=${encodeURIComponent(leadId)}` : base;
  }
  if (LIFF_URL) {
    return leadId
      ? `${LIFF_URL}${LIFF_URL.includes("?") ? "&" : "?"}leadId=${encodeURIComponent(leadId)}`
      : LIFF_URL;
  }
  const origin = process.env.BASE_URL || process.env.PUBLIC_BASE_URL || "";
  const base = origin ? `${origin.replace(/\/+$/, "")}/liff.html` : "/liff.html";
  return leadId ? `${base}?leadId=${encodeURIComponent(leadId)}` : base;
}

// 手動確認 GET
router.get("/webhook", (_req, res) => res.status(200).type("text").send("ok"));

// 本番 Webhook
router.post("/webhook", mw, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (!events.length) return res.sendStatus(200);
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

  if (type === "follow") {
    try {
      const leadId = await findLeadIdByUserId(userId);
      const liffUrl = resolveLiffUrl(leadId || "");

      if (leadId) {
        const estimate = await getEstimateForLead(leadId);
        if (estimate) {
          await lineClient.pushMessage(userId, { type: "text", text: estimate.text });
          await lineClient.pushMessage(userId, {
            type: "template",
            altText: "詳細見積もりのご案内",
            template: {
              type: "buttons",
              text: "さらに詳しい見積もりをご確認ください。",
              actions: [{ type: "uri", label: "詳細見積もりを開く", uri: liffUrl }],
            },
          });
          return;
        }
      }

      // まだ概算が無い／lead 不明でも、LIFF ボタンのみ案内
      await lineClient.pushMessage(userId, {
        type: "template",
        altText: "詳細見積もりのご案内",
        template: {
          type: "buttons",
          text: "さらに詳しい見積もりをご確認ください。",
          actions: [{ type: "uri", label: "詳細見積もりを開く", uri: liffUrl }],
        },
      });
    } catch (e) {
      console.error("[FOLLOW ERROR]", e);
    }
  }
}

export default router;
