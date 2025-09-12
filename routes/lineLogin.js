// routes/lineLogin.js
import express from "express";
import axios from "axios";
import { Client } from "@line/bot-sdk";

const router = express.Router();

/** =========================
 *  既存の環境変数をそのまま利用
 *  - Messaging API（プッシュ送信用）
 *  - LINEログイン（認可コード → userId取得用）
 *  - LIFFリンク（未設定でも既定URLを使って必ず送る）
 * ========================= */
const CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN ||
  process.env.CHANNEL_ACCESS_TOKEN || "";

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

// LIFF の URL は未設定でも既定値で送信できるようにする
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://line-paint.onrender.com";
const LIFF_URL =
  process.env.LIFF_URL ||
  process.env.DETAIL_LIFF_URL ||
  `${PUBLIC_BASE_URL.replace(/\/$/, "")}/liff.html`;

/** LINE Messaging API クライアント（プッシュ送信用） */
const client =
  CHANNEL_ACCESS_TOKEN && CHANNEL_SECRET
    ? new Client({
        channelAccessToken: CHANNEL_ACCESS_TOKEN,
        channelSecret: CHANNEL_SECRET,
      })
    : null;

/** -------------------------------------------------
 *  /line/login
 *  既存の導線を壊さないよう、標準的な認可URLを生成
 *  （この導線は既に問題ないとのことなので、極力変更なし）
 * ------------------------------------------------- */
router.get("/line/login", (req, res) => {
  // state は既存実装があればそのまま使う（なければ乱数）
  const state =
    (typeof req.query.state === "string" && req.query.state) ||
    Math.random().toString(36).slice(2);

  const authUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", LOGIN_CHANNEL_ID);
  authUrl.searchParams.set("redirect_uri", LOGIN_REDIRECT_URI);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "openid profile"); // メール不要
  // 友だち追加は既存設定に依存。ここでは付けない/壊さない（必要なら bot_prompt=normal を追加）

  return res.redirect(authUrl.toString());
});

/** -------------------------------------------------
 *  /line/callback
 *  1) code→id_token 交換
 *  2) id_token 検証→ userId(sub) 取得
 *  3) 必ず LIFF リンクをプッシュ
 *  4) 既存の完了画面へ遷移（after-login.html）
 * ------------------------------------------------- */
router.get("/line/callback", async (req, res) => {
  const code = req.query.code;
  const state = req.query.state; // 既存実装が参照していてもOK、ここでは使わない
  if (!code) {
    console.error("[LOGIN] missing code");
    return res.redirect("/after-login.html"); // 既存の完了画面
  }

  try {
    // ① 認可コードを id_token 等へ交換
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
      console.error("[LOGIN] no id_token in token response");
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
    if (!userId) {
      console.error("[LOGIN] verify ok but no sub(userId)");
      return res.redirect("/after-login.html");
    }

    // ③ 概算メッセージの送信有無に関わらず、
    //    **必ず** LIFF リンクを続けて送る（既定URLでフォールバック）
    if (client) {
      const link = LIFF_URL;

      // 既存のUIを壊さないため、シンプルなボタンテンプレートで送信
      const messages = [
        {
          type: "template",
          altText: "詳細見積もりの入力",
          template: {
            type: "buttons",
            text: "より詳しいお見積もりをご希望の方はこちらから入力してください。",
            actions: [
              {
                type: "uri",
                label: "詳細見積もりを入力する",
                uri: link,
              },
            ],
          },
        },
      ];

      try {
        await client.pushMessage(userId, messages);
        console.info("[PUSH] LIFF link sent:", link);
      } catch (e) {
        // プッシュ失敗でもフロントの画面遷移は継続
        console.error("[PUSH] failed to send LIFF link:", e?.response?.data || e);
      }
    } else {
      console.warn(
        "[PUSH] client not initialized (CHANNEL_ACCESS_TOKEN/SECRET missing)."
      );
    }
  } catch (e) {
    console.error("[LOGIN] callback error:", e?.response?.data || e);
    // 失敗しても UX を壊さず完了画面へ
  }

  // ④ 既存の「送信しました。LINEをご確認ください。」画面へ
  return res.redirect("/after-login.html");
});

export default router;
