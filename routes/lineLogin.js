// routes/lineLogin.js
import express from "express";
import { Client } from "@line/bot-sdk";
import { saveLink, getEstimateForLead } from "../store/linkStore.js";

const router = express.Router();

const LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || "";
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || "";
const LOGIN_REDIRECT_URI = process.env.LINE_LOGIN_REDIRECT_URI || "";
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const LIFF_ID = process.env.LIFF_ID || "";
const LIFF_URL_ENV = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || "";
const ADD_URL = process.env.LINE_ADD_FRIEND_URL || "";
const OA_BASIC_ID_ENV = process.env.LINE_OA_BASIC_ID || ""; // 任意：明示指定できる

const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

function resolveLiffUrl(leadId) {
  if (LIFF_ID) {
    const base = `https://liff.line.me/${LIFF_ID}`;
    return leadId ? `${base}?leadId=${encodeURIComponent(leadId)}` : base;
  }
  if (LIFF_URL_ENV) {
    return leadId
      ? `${LIFF_URL_ENV}${LIFF_URL_ENV.includes("?") ? "&" : "?"}leadId=${encodeURIComponent(leadId)}`
      : LIFF_URL_ENV;
  }
  return `/liff.html${leadId ? `?leadId=${encodeURIComponent(leadId)}` : ""}`;
}

function deriveBasicId() {
  if (OA_BASIC_ID_ENV) return OA_BASIC_ID_ENV;         // 明示渡し
  const m = ADD_URL.match(/\/p\/(@[A-Za-z0-9._-]+)/);  // /p/@xxxx から抽出
  return m ? m[1] : "";
}

// ログイン開始（任意）
const loginPaths = ["/auth/line/login", "/line/login", "/login"];
router.get(loginPaths, (req, res) => {
  const lead =
    (typeof req.query.lead === "string" && req.query.lead) ||
    (typeof req.query.state === "string" && req.query.state) || "";
  const state = lead || Math.random().toString(36).slice(2);

  const authUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", LOGIN_CHANNEL_ID);
  authUrl.searchParams.set("redirect_uri", LOGIN_REDIRECT_URI);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "openid profile");
  res.redirect(authUrl.toString());
});

// コールバック
const callbackPaths = ["/auth/line/callback", "/line/callback", "/callback"];
router.get(callbackPaths, async (req, res) => {
  try {
    const code = req.query.code;
    const leadId =
      (typeof req.query.lead === "string" && req.query.lead) ||
      (typeof req.query.state === "string" && req.query.state) || "";

    if (!code) return res.redirect("/after-login.html");

    // token exchange
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: LOGIN_REDIRECT_URI,
        client_id: LOGIN_CHANNEL_ID,
        client_secret: LOGIN_CHANNEL_SECRET,
      }),
    });
    if (!tokenRes.ok) {
      console.error("[LOGIN] token exchange failed", await tokenRes.text());
      return res.redirect("/after-login.html");
    }
    const { access_token } = await tokenRes.json();

    // profile
    const profRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!profRes.ok) {
      console.error("[LOGIN] profile fetch failed", await profRes.text());
      return res.redirect("/after-login.html");
    }
    const prof = await profRes.json();
    const userId = prof.userId;

    if (userId && leadId) {
      await saveLink(userId, leadId);

      // 概算があれば push（follow取りこぼし救済）
      const est = await getEstimateForLead(leadId);
      if (est) {
        const msg1 = { type: "text", text: est.text };
        const msg2 = {
          type: "template",
          altText: "詳細見積もりのご案内",
          template: {
            type: "buttons",
            text: "さらに詳しい見積もりをご確認ください。",
            actions: [{ type: "uri", label: "詳細見積もりを開く", uri: resolveLiffUrl(leadId) }],
          },
        };
        try { await lineClient.pushMessage(userId, [msg1, msg2]); }
        catch (e) { console.warn("[LOGIN] push failed", e.message); }
      }
    }

    // ✅ after-login に OA 情報を渡す（→ 公式サイトではなくトークを開く）
    const oa = deriveBasicId();
    const msg = "見積結果を確認したいです";
    const qs = new URLSearchParams();
    if (oa) qs.set("oa", oa);
    if (ADD_URL) qs.set("add", ADD_URL);
    qs.set("msg", msg);
    return res.redirect(`/after-login.html${qs.toString() ? "?" + qs.toString() : ""}`);
  } catch (e) {
    console.error("[LOGIN CALLBACK ERROR]", e);
    return res.redirect("/after-login.html");
  }
});

export default router;
