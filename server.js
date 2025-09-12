// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
// Node v18+ は fetch がグローバルにあります（追加ライブラリ不要）

import { Client } from "@line/bot-sdk";       // ★ named import に統一
import { computeEstimate } from "./lib/estimate.js";
import { linkStore } from "./store/linkStore.js";
// ★ config.js は named export 前提で一括読み込み
import * as cfg from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const lineClient = new Client({
  channelAccessToken: cfg.LINE_CHANNEL_ACCESS_TOKEN,
});

// ---- health ----
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// ---- 概算計算 → LINEログインへ誘導 ----
app.post("/api/estimate", (req, res) => {
  const answers = req.body?.answers || {};
  const amount  = computeEstimate(answers);

  // state を発行してログイン後に使うデータを保存
  const state = crypto.randomUUID();
  linkStore.put(state, { amount, answers });

  // LINEログインURL
  const authorize = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", cfg.LINE_LOGIN_CHANNEL_ID);
  authorize.searchParams.set("redirect_uri", cfg.LINE_LOGIN_REDIRECT_URI);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", "openid profile");
  authorize.searchParams.set("prompt", "consent");

  res.json({
    ok: true,
    amount,
    loginUrl: authorize.toString(),
  });
});

// ---- LINEログイン コールバック ----
app.get("/line/callback", async (req, res) => {
  try {
    const code  = req.query.code;
    const state = req.query.state;
    if (!code || !state) return res.status(400).send("invalid request");

    // state から見積データを取り出し
    const payload = linkStore.take(state);
    if (!payload) return res.status(400).send("state expired");

    // アクセストークン交換
    const tokenUrl = "https://api.line.me/oauth2/v2.1/token";
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.LINE_LOGIN_REDIRECT_URI,
      client_id: cfg.LINE_LOGIN_CHANNEL_ID,
      client_secret: cfg.LINE_LOGIN_CHANNEL_SECRET,
    });
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenRes.ok) throw new Error(`token error: ${await tokenRes.text()}`);
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // プロフィール取得（userId）
    const profRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profRes.ok) throw new Error(`profile error: ${await profRes.text()}`);
    const profile = await profRes.json();
    const userId = profile.userId;

    // 概算と LIFF リンクを送る
    const amount = payload.amount;
    const liffUrl = (cfg.DETAILS_LIFF_URL || "").trim();

    const messages = [
      {
        type: "text",
        text:
          `概算見積：${amount.toLocaleString()}円\n\n` +
          `※詳細条件によって前後します。続きの質問にお答えいただくと、より正確な見積もりが可能です。`,
      },
      liffUrl
        ? {
            type: "text",
            text: "より詳しいお見積もりをご希望の方は、以下から詳細情報をご入力ください。",
          }
        : {
            type: "text",
            text: "詳細見積もりの入力リンクが未設定です。管理者にご連絡ください。",
          },
    ];
    await lineClient.pushMessage(userId, messages);

    if (liffUrl) {
      await lineClient.pushMessage(userId, [
        {
          type: "template",
          altText: "詳細見積もり入力",
          template: {
            type: "buttons",
            text: "詳細見積もり入力",
            actions: [{ type: "uri", label: "入力をはじめる", uri: liffUrl }],
          },
        },
      ]);
    }

    // 完了ページへ（ここからはユーザーがLINEに戻る運用）
    res.redirect("/after-login.html?ok=1");
  } catch (e) {
    console.error("[/line/callback] error:", e);
    res.status(500).send("callback error");
  }
});

// ---- Webhook（必要なら後で実装） ----
app.post("/line/webhook", (_req, res) => {
  res.status(200).json({ ok: true });
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`[INFO] Server started : http://localhost:${port}`);
});
