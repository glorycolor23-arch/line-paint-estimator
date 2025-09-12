// routes/lineLogin.js
import express from "express";
import * as line from "@line/bot-sdk";

const router = express.Router();

// --- LINE Login (認可コード) 用 ---
const LOGIN = {
  channelId: process.env.LINE_LOGIN_CHANNEL_ID,
  channelSecret: process.env.LINE_LOGIN_CHANNEL_SECRET,
  redirectUri:
    process.env.LINE_LOGIN_REDIRECT_URI ||
    "https://line-paint.onrender.com/auth/line/callback",
};

// --- Messaging API 用 ---
const MSG = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(MSG);

const BASE_URL =
  (process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, "") : "") ||
  "https://line-paint.onrender.com";
const DETAILS_LIFF_URL =
  process.env.DETAILS_LIFF_URL || `${BASE_URL}/liff.html`;

// 認証後のコールバック
router.get("/auth/line/callback", async (req, res) => {
  try {
    const { code, error, state } = req.query;
    if (error) return res.status(400).send(`Login error: ${error}`);
    if (!code) return res.status(400).send("Missing code");

    // アクセストークン取得
    const params = new URLSearchParams();
    params.set("grant_type", "authorization_code");
    params.set("code", code);
    params.set("redirect_uri", LOGIN.redirectUri);
    params.set("client_id", LOGIN.channelId);
    params.set("client_secret", LOGIN.channelSecret);

    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(`token error: ${JSON.stringify(tokenJson)}`);
    }

    // プロフィールから userId を取得
    const profRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const prof = await profRes.json();
    const userId = prof.userId;
    if (!userId) throw new Error("LINE userId not found");

    // （任意）state で概算金額テキストがあるなら一緒に送る
    let estimateText = null;
    try {
      const mod = await import("../store/linkStore.js").catch(() => ({}));
      if (mod?.getByState) {
        const data = await mod.getByState(state);
