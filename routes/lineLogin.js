// routes/lineLogin.js
import express from "express";
import axios from "axios";
import { Client } from "@line/bot-sdk";

const router = express.Router();

/* =========================
 *  既存の環境変数（増やしません）
 * ========================= */
const CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN ||
  process.env.CHANNEL_ACCESS_TOKEN ||
  "";

const CHANNEL_SECRET =
  process.env.LINE_CHANNEL_SECRET || process.env.CHANNEL_SECRET || "";

const LOGIN_CHANNEL_ID =
  process.env.LINE_LOGIN_CHANNEL_ID || process.env.LOGIN_CHANNEL_ID || "";

const LOGIN_CHANNEL_SECRET =
  process.env.LINE_LOGIN_CHANNEL_SECRET ||
  process.env.LOGIN_CHANNEL_SECRET ||
  "";

const LOGIN_REDIRECT_URI =
  process.env.LINE_LOGIN_REDIRECT_URI ||
  process.env.LOGIN_REDIRECT_URI ||
  "";

// LIFF は未設定でも既定URLで必ず送れるように
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://line-paint.onrender.com";
const LIFF_URL =
  process.env.LIFF_URL ||
  process.env.DETAIL_LIFF_URL ||
  `${PUBLIC_BASE_URL.replace(/\/$/, "")}/liff.html`;

// Messaging API クライアント（プッシュ用）
const client =
  CHANNEL_ACCESS_TOKEN && CHANNEL_SECRET
    ? new Client({
        channelAccessToken: CHANNEL_ACCESS_TOKEN,
        channelSecret: CHANNEL_SECRET,
      })
    : null;

/* -------------------------------------------------
 * ログイン開始
 * （既存導線を壊さない。複数パスで受ける）
 *  - /login         （このルータを /line マウント → /line/login になる）
 *  - /line/login    （ルートマウントの場合に備えた絶対パス）
 *  - /auth/line/login（運用中の設定に合わせる保険）
 * ------------------------------------------------- */
const loginPaths = ["/login", "/line/login", "/auth/line/login"];
router.get(loginPaths, (req, res) => {
  const state =
    (typeof req.query.state === "string" && req.query.state) ||
    Math.random().toString(36).slice(2);

  const authUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", LOGIN_CHANNEL_ID);
  authUrl.searchParams.set("redirect_uri", LOGIN_REDIRECT_URI);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "openid profile"); // メール不要

  return res.redirect(authUrl.toString());
});

/* -------------------------------------------------
 * コールバック
 * （複数パスで必ず拾う）
 *  - /callback
 *  - /line/callback
 *  - /auth/line/callback
 * ------------------------------------------------- */
const callbackPaths = ["/callback", "/line/callback", "/auth/line/callback"];
router.get(callbackPaths, async (req, res) => {
  console.info("[CALLBACK] hit:", req.originalUrl, req.query);

  const code = req.query.code;
  if (!code) {
    console.error("[CALLBACK] missing code");
    return res.redirect("/after-login.html");
  }

  try {
    // ① 認可コードをトークンへ交換
    const tokenRes = await axios.post(
      "https://api.line.me/oauth2/v2.1/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: LOGIN_REDIRECT_URI,
        client_id: LOGIN_CHANNEL_ID,
        client_secret: LOGIN_CHANNEL_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const idToken = tokenRes.data?.id_token;
    if (!idToken) {
      console.error("[CALLBACK] no id_token in token response");
      return res.redirect("/after-login.html");
    }

    // ② id_token 検証 → userId(sub) 取得
    const verifyRes = await axios.post(
      "https://api.line.me/oauth2/v2.1/verify",
      new URLSearchParams({
        id_token: idToken,
        client_id: LOGIN_CHANNEL_ID,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const userId = verifyRes.data?.sub;
    console.info("[CALLBACK] verified userId:", userId);

    if (!userId) {
      console.error("[CALLBACK] verify ok but no sub(userId)");
      return res.redirect("/after-login.html");
    }

    // ③ 見積り連携の成否に関わらず、LIFFリンクは必ず送る
    if (client) {
      const link = LIFF_URL;
      const messages = [
        {
          type: "template",
          altText: "詳細見積もりの入力",
          template: {
            type: "buttons",
            text: "より詳しいお見積もりをご希望の方はこちらから入力してください。",
            actions: [{ type: "uri", label: "詳細見積もりを入力する", uri: link }],
          },
        },
      ];

      try {
        await client.pushMessage(userId, messages);
        console.info("[PUSH] LIFF link sent:", link);
      } catch (e) {
        console.error(
          "[PUSH] failed to send LIFF link:",
          e?.response?.data || e
        );
      }
    } else {
      console.warn(
        "[PUSH] client not initialized (CHANNEL_ACCESS_TOKEN/SECRET missing)."
      );
    }
  } catch (e) {
    console.error("[CALLBACK] error:", e?.response?.data || e);
  }

  // ④ 既存の完了画面へ
  return res.redirect("/after-login.html");
});

export default router;
