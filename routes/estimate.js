// routes/estimate.js
import { Router } from "express";
import { computeEstimate } from "../lib/estimate.js";
import { saveEstimateForLead } from "../store/linkStore.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

/**
 * 旧フロント互換: /estimate は LINE Login 誘導のエンドポイントとして残す
 * ここはそのまま JSON {redirectUrl} を返すだけの役。
 */
router.post("/estimate", (req, res) => {
  const { LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_REDIRECT_URI } = process.env;
  if (!LINE_LOGIN_CHANNEL_ID || !LINE_LOGIN_REDIRECT_URI) {
    return res.json({ ok: true, redirectUrl: "https://lin.ee/XxmuVXt" });
  }
  const state = uuidv4(); // leadId ではなく state（互換）
  const authorizeUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", LINE_LOGIN_CHANNEL_ID);
  authorizeUrl.searchParams.set("redirect_uri", LINE_LOGIN_REDIRECT_URI);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", "openid profile");
  authorizeUrl.searchParams.set("bot_prompt", "normal");
  return res.json({ ok: true, redirectUrl: authorizeUrl.toString() });
});

/**
 * 新フロント本命: /api/estimate
 * - 概算を計算
 * - 必ず leadId を採番
 * - Webhook が拾えるように linkStore に {price, summaryText, answers} を保存
 * - 友だち追加URL と LIFF DeepLink を返す（フロントが案内に利用）
 */
router.post("/api/estimate", (req, res) => {
  try {
    const { desiredWork, ageRange, floors, wallMaterial } = req.body || {};
    if (!desiredWork || !ageRange || !floors || !wallMaterial) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const answers = { desiredWork, ageRange, floors, wallMaterial };
    const price = computeEstimate(answers);

    const leadId = uuidv4();

    // Webhook が参照できるよう保存（★これが無いと概算が送れない）
    const summaryText =
      `【概算見積もり】${price.toLocaleString("ja-JP")} 円\n` +
      `・見積もり内容：${desiredWork}\n` +
      `・築年数：${ageRange}\n` +
      `・階数：${floors}\n` +
      `・外壁材：${wallMaterial}`;
    saveEstimateForLead(leadId, { price, summaryText, answers });

    const addFriendUrl = process.env.LINE_ADD_FRIEND_URL || "https://lin.ee/XxmuVXt";
    const liffBase =
      process.env.LIFF_ID
        ? `https://liff.line.me/${process.env.LIFF_ID}`
        : (process.env.LIFF_URL || "/liff.html");
    const liffDeepLink = `${liffBase}${liffBase.includes("?") ? "&" : "?"}leadId=${encodeURIComponent(leadId)}`;

    return res.json({
      leadId,
      amount: price,
      addFriendUrl,
      liffDeepLink,
    });
  } catch (e) {
    console.error("[/api/estimate] error:", e);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
