// routes/estimate.js
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Client } from "@line/bot-sdk";
import { computeEstimate } from "../lib/estimate.js";
import {
  saveEstimateForLead,
  saveLink,
  getEstimateForLead,
} from "../store/linkStore.js";

const router = Router();

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
});

function resolveLiffUrl(lead) {
  const LIFF_ID = process.env.LIFF_ID || "";
  const LIFF_URL = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || "";
  if (LIFF_ID) {
    const base = `https://liff.line.me/${LIFF_ID}`;
    return lead ? `${base}?leadId=${encodeURIComponent(lead)}` : base;
  }
  if (LIFF_URL) {
    return lead
      ? `${LIFF_URL}${LIFF_URL.includes("?") ? "&" : "?"}leadId=${encodeURIComponent(lead)}`
      : LIFF_URL;
  }
  // フォールバック：ホストの /liff.html
  return `/liff.html${lead ? `?leadId=${encodeURIComponent(lead)}` : ""}`;
}

function buildAuthorizeUrl(leadId) {
  const id = process.env.LINE_LOGIN_CHANNEL_ID || "";
  const redirect = process.env.LINE_LOGIN_REDIRECT_URI || "";
  const url = new URL("https://access.line.me/oauth2/v2.1/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", leadId);
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("bot_prompt", "normal");
  return url.toString();
}

async function handleEstimate(req, res) {
  try {
    const body = req.body || {};
    const answers =
      body.answers && typeof body.answers === "object" ? body.answers : body;

    const required = ["desiredWork", "ageRange", "floors", "wallMaterial"];
    const missing = required.filter((k) => !answers[k]);
    // 入力が欠けていてもフェイルセーフで進む（概算は計算可能）

    // 1) 採番 & 概算
    const leadId = String(body.leadId || randomUUID());
    const amount = computeEstimate(answers);

    // 2) 保存（webhook / login コールバックで参照される）
    const estimateObj = {
      price: amount,
      text:
        `概算見積もり：${Number(amount).toLocaleString("ja-JP")}円\n` +
        `・見積内容: ${answers.desiredWork || "-"}\n` +
        `・築年数: ${answers.ageRange || "-"}\n` +
        `・階数: ${answers.floors || "-"}\n` +
        `・外壁材: ${answers.wallMaterial || "-"}`,
      answers,
    };
    await saveEstimateForLead(leadId, estimateObj);

    // 3) LINE Login の authorize URL を返す（state=leadId）
    const haveLogin =
      !!process.env.LINE_LOGIN_CHANNEL_ID &&
      !!process.env.LINE_LOGIN_REDIRECT_URI;
    const redirectUrl = haveLogin
      ? buildAuthorizeUrl(leadId)
      : process.env.LINE_ADD_FRIEND_URL || "https://line.me";

    return res.json({
      ok: true,
      leadId,
      redirectUrl,
      ...(missing.length ? { note: "MISSING_FIELDS", missing } : {}),
    });
  } catch (e) {
    console.error("[POST /estimate] error", e);
    return res.json({
      ok: true,
      redirectUrl: process.env.LINE_ADD_FRIEND_URL || "https://line.me",
    });
  }
}

// フロントの第1候補
router.post("/estimate", handleEstimate);
// 互換フォールバック
router.post("/api/estimate", handleEstimate);

// LIFF 起動直後に userId をひもづけ、概算＋ボタンを push
router.post("/api/link-line-user", async (req, res) => {
  try {
    const { leadId, lineUserId } = req.body || {};
    if (!leadId || !lineUserId) {
      return res.status(400).json({ ok: false, error: "leadId and lineUserId required" });
    }

    await saveLink(lineUserId, leadId);

    // 概算が既に保存済みなら push
    const est = await getEstimateForLead(leadId);
    const msgs = [];

    if (est?.text) {
      msgs.push({ type: "text", text: est.text });
    }
    msgs.push({
      type: "template",
      altText: "詳細見積もりのご案内",
      template: {
        type: "buttons",
        text: "さらに詳しい見積もりをご確認ください。",
        actions: [
          { type: "uri", label: "詳細見積もりを開く", uri: resolveLiffUrl(leadId) },
        ],
      },
    });

    try {
      await lineClient.pushMessage(lineUserId, msgs);
    } catch (e) {
      console.warn("[push skipped]", e.message);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[/api/link-line-user] error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
