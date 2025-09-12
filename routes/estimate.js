// routes/estimate.js
import { Router } from "express";
import crypto from "node:crypto";
import { computeEstimate } from "../lib/estimate.js";
import { putState } from "../store/linkStore.js";

const router = Router();

function newState() {
  return crypto.randomUUID();
}

/**
 * アンケート送信（既存フロント互換）
 * - POST /estimate
 * - POST /api/estimate
 * 受け取った回答を一時保存し、LINEログインの認可URLを返す（bot_prompt=normal）。
 * フロントはこのURLを使って認証する実装/非実装どちらでも動くよう、200だけ返してもOK。
 */
async function handler(req, res) {
  try {
    const answers = req.body?.answers || {};
    const amount  = computeEstimate(answers);

    // state に保存（ログイン後の /line|/auth コールバックで取り出す）
    const state = newState();
    await putState(state, { answers, amount, createdAt: Date.now() });

    // LINEログインの認可URLを生成（ログインチャネル）
    const clientId     = process.env.LINE_LOGIN_CHANNEL_ID || "";
    const redirectUri  = process.env.LINE_LOGIN_REDIRECT_URI || "";
    const authorizeUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("scope", "openid profile");
    // 友だち追加を促す（未フォロー時）
    authorizeUrl.searchParams.set("bot_prompt", "normal");

    return res.json({ ok: true, redirectUrl: authorizeUrl.toString() });
  } catch (e) {
    console.error("[POST /estimate] error", e);
    return res.status(500).json({ ok: false, message: "ESTIMATE_FAILED" });
  }
}

router.post("/estimate", handler);
router.post("/api/estimate", handler);

export default router;
