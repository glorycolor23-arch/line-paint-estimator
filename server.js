// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fetch from "node-fetch"; // Node22 でも確実に使えるように
import { Client } from "@line/bot-sdk";

import { computeEstimate } from "./lib/estimate.js";
import { linkStore } from "./store/linkStore.js";
import cfg from "./config.js";

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

// ---- アンケートの概算計算 → LINEログインへ誘導 ----
app.post("/api/estimate", (req, res) => {
  const answers = req.body?.answers || {};
  const amount  = computeEstimate(answers);

  // state を発行して、結果を保存（ログイン後に取り出す）
  const state = crypto.randomUUID();
  linkStore.put(state, { amount, answers });

  // LINEログインURL作成
  const authorize = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", cfg.LINE_LOGIN_CHANNEL_ID);
  authorize.searchParams.set("redirect_uri", cfg.LINE_LOGIN_REDIRECT_URI);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", "openid profile");
  authorize.searchParams.set("prompt", "consent"); // 同意画面を出す

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

    if (!code || !state) {
      return res.status(400).send("invalid request");
    }

    // state から見積データを取得
    const payload = linkStore.take(state);
    if (!payload) {
      return res.status(400).send("state expired");
    }

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
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(`token error: ${t}`);
    }
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // プロフィール（userId取得）
    const profRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profRes.ok) {
      const t = await profRes.text();
      throw new Error(`profile error: ${t}`);
    }
    const profile = await profRes.json();
    const userId = profile.userId;

    // ユーザーに概算見積と LIFF リンクを送る
    const amount = payload.amount;
    const liffUrl = cfg.DETAILS_LIFF_URL?.trim();

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

    // 完了ページへ（手動でLINEに戻ってもらう運用）
    res.redirect("/after-login.html?ok=1");
  } catch (e) {
    console.error("[/line/callback] error:", e);
    res.status(500).send("callback error");
  }
});

// ---- （任意）Messaging API webhook 受け口（テスト用） ----
app.post("/line/webhook", (_req, res) => {
  // ここでは単に 200 を返すだけ。必要ならイベント処理を追加。
  res.status(200).json({ ok: true });
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`[INFO] Server started : http://localhost:${port}`);
});
