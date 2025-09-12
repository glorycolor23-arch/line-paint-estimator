// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";      // named import

import { computeEstimate } from "./lib/estimate.js";
import { linkStore } from "./store/linkStore.js";
import * as cfg from "./config.js";          // ← ここを named import に

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const lineClient = new Client({
  channelAccessToken: cfg.LINE_CHANNEL_ACCESS_TOKEN,
});

app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// ---- 概算計算 → LINEログイン誘導 ----
app.post("/api/estimate", (req, res) => {
  const answers = req.body?.answers || {};
  const amount  = computeEstimate(answers);

  const state = crypto.randomUUID();
  linkStore.put(state, { amount, answers });

  const authorize = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", cfg.LINE_LOGIN_CHANNEL_ID);
  authorize.searchParams.set("redirect_uri", cfg.LINE_LOGIN_REDIRECT_URI);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", "openid profile");
  authorize.searchParams.set("prompt", "consent");

  res.json({ ok: true, amount, loginUrl: authorize.toString() });
});

// ---- LINEログイン コールバック ----
app.get("/line/callback", async (req, res) => {
  try {
    const code  = req.query.code;
    const state = req.query.state;
    if (!code || !state) return res.status(400).send("invalid request");

    const payload = linkStore.take(state);
    if (!payload) return res.status(400).send("state expired");

    // アクセストークン交換
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: cfg.LINE_LOGIN_REDIRECT_URI,
        client_id: cfg.LINE_LOGIN_CHANNEL_ID,
        client_secret: cfg.LINE_LOGIN_CHANNEL_SECRET,
      }),
    });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const { access_token } = await tokenRes.json();

    // プロフィール（userId）
    const profRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!profRes.ok) throw new Error(await profRes.text());
    const profile = await profRes.json();
    const userId = profile.userId;

    // 概算 + LIFFリンク送信
    const amount = payload.amount;
    const liffUrl = (cfg.DETAILS_LIFF_URL || "").trim();

    const messages = [
      {
        type: "text",
        text:
          `概算見積：${amount.toLocaleString()}円\n\n` +
          `※詳細条件で変動します。続きの質問にお答えいただくと、より正確な見積もりが可能です。`,
      },
      liffUrl
        ? { type: "text", text: "より詳しいお見積もりは下のボタンから入力してください。" }
        : { type: "text", text: "詳細見積もりの入力リンクが未設定です。管理者にご連絡ください。" },
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

    res.redirect("/after-login.html?ok=1");
  } catch (e) {
    console.error("[/line/callback] error:", e);
    res.status(500).send("callback error");
  }
});

// Webhook（必要に応じて実装）
app.post("/line/webhook", (_req, res) => res.status(200).json({ ok: true }));

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`[INFO] Server started : http://localhost:${port}`);
});
