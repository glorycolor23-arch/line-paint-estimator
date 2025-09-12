// routes/lineLogin.js
import express from "express";
import { Client } from "@line/bot-sdk";
import {
  saveLink,
  getEstimateForLead,
} from "../store/linkStore.js";

const router = express.Router();

const LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || "";
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || "";
const LOGIN_REDIRECT_URI =
  process.env.LINE_LOGIN_REDIRECT_URI ||
  (process.env.BASE_URL
    ? `${process.env.BASE_URL.replace(/\/$/, "")}/auth/line/callback`
    : "");

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
});

// LIFF URL（/liff.html をデフォルトに。/liff/index.html は補正）
function resolveLiffUrl(leadId = "") {
  if (process.env.LIFF_ID) {
    const base = `https://liff.line.me/${process.env.LIFF_ID}`;
    return leadId ? `${base}?lead=${encodeURIComponent(leadId)}` : base;
  }
  const raw = process.env.LIFF_URL || "";
  if (!raw) return "";
  const fixed = raw.replace(/\/liff\/index\.html$/i, "/liff.html");
  return leadId ? `${fixed}${fixed.includes("?") ? "&" : "?"}lead=${encodeURIComponent(leadId)}` : fixed;
}

/* -------------------------------------------------
 * ログイン開始（/login, /start, /line/login）
 *  state に leadId を入れて渡す（?lead=xxx が来たらそれを使う）
 * ------------------------------------------------- */
const loginPaths = ["/login", "/start", "/line/login"];
router.get(loginPaths, (req, res) => {
  const leadFromQuery =
    typeof req.query.lead === "string" && req.query.lead ? req.query.lead : "";
  const state =
    leadFromQuery ||
    (typeof req.query.state === "string" && req.query.state) ||
    Math.random().toString(36).slice(2);

  const authUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", LOGIN_CHANNEL_ID);
  authUrl.searchParams.set("redirect_uri", LOGIN_REDIRECT_URI);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "openid profile");
  authUrl.searchParams.set("prompt", "consent");

  return res.redirect(authUrl.toString());
});

/* -------------------------------------------------
 * コールバック（/callback, /line/callback, /auth/line/callback）
 *  - code から token 取得
 *  - id_token を verify して userId（sub）取得
 *  - state を leadId として保存し、概算＋LIFF を push（可能なら）
 * ------------------------------------------------- */
const callbackPaths = ["/callback", "/line/callback", "/auth/line/callback"];
router.get(callbackPaths, async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state || ""; // leadId を入れている

    if (!code) {
      console.error("[CALLBACK] missing code");
      return res.redirect("/after-login.html");
    }

    // 1) token 交換
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: LOGIN_REDIRECT_URI,
        client_id: LOGIN_CHANNEL_ID,
        client_secret: LOGIN_CHANNEL_SECRET,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("[CALLBACK] token error:", tokenJson);
      return res.redirect("/after-login.html");
    }

    // 2) id_token verify -> userId(sub)
    const verifyRes = await fetch(
      "https://api.line.me/oauth2/v2.1/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          id_token: String(tokenJson.id_token || ""),
          client_id: LOGIN_CHANNEL_ID,
        }),
      }
    );
    const verifyJson = await verifyRes.json();
    if (!verifyRes.ok || !verifyJson.sub) {
      console.error("[CALLBACK] verify error:", verifyJson);
      return res.redirect("/after-login.html");
    }
    const userId = verifyJson.sub;

    // 3) ひもづけ保存（state を leadId として扱う）
    const leadId = typeof state === "string" ? state : "";
    if (leadId) {
      await saveLink(userId, leadId);

      // 概算が保存済みなら、ここで即 push（友だち済みなら届く）
      try {
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
        // 友だち前などで push 不可の場合は follow 時に送れるようにするだけで OK
        console.warn("[CALLBACK] push skipped:", e?.message || e);
      }
    }

    // 完了画面
    return res.redirect("/after-login.html");
  } catch (e) {
    console.error("[CALLBACK ERROR]", e);
    return res.redirect("/after-login.html");
  }
});

export default router;
