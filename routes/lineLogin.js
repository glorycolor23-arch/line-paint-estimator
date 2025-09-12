// routes/lineLogin.js
import { Router } from "express";
import { Client } from "@line/bot-sdk";
import { takeState } from "../store/linkStore.js";

const router = Router();

const CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.CHANNEL_ACCESS_TOKEN || "";

const LOGIN_CHANNEL_ID     = process.env.LINE_LOGIN_CHANNEL_ID     || "";
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || "";
const LOGIN_REDIRECT_URI   = process.env.LINE_LOGIN_REDIRECT_URI   || "";

const DETAILS_LIFF_URL =
  (process.env.DETAILS_LIFF_URL || process.env.LIFF_URL || "").trim();

const lineClient = CHANNEL_ACCESS_TOKEN
  ? new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN })
  : null;

async function handleCallback(req, res) {
  try {
    const { code, state, error, error_description } = req.query ?? {};
    if (error) {
      console.error("[LOGIN] error", error, error_description);
      return res.status(400).send("Login canceled");
    }
    if (!code) return res.status(400).send("Missing code");

    // 1) 認可コード→アクセストークン（ログインチャネル）
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: LOGIN_REDIRECT_URI,
        client_id: LOGIN_CHANNEL_ID,
        client_secret: LOGIN_CHANNEL_SECRET,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("[LOGIN] token error", tokenJson);
      return res.status(400).send("Login token error");
    }

    // 2) プロフィール取得
    const profRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const profile = await profRes.json();
    if (!profRes.ok || !profile?.userId) {
      console.error("[LOGIN] profile error", profile);
      return res.status(400).send("Login profile error");
    }
    const userId = profile.userId;

    // 3) state に保存された概算を取り出し → プッシュ送信
    const saved = state ? await takeState(state) : null;
    const amount = saved?.amount;
    const leadId = state; // LIFF 側へ引き継ぐため、state を leadId として渡す

    if (!lineClient) console.error("[PUSH] skipped: no access token");
    if (lineClient) {
      // 先に概算
      if (amount != null) {
        await lineClient.pushMessage(userId, {
          type: "text",
          text:
            `お見積もりのご依頼ありがとうございます。\n` +
            `概算見積額は ${amount.toLocaleString("ja-JP")} 円です。\n` +
            `※詳細条件で前後します。`,
        });
      } else {
        await lineClient.pushMessage(userId, {
          type: "text",
          text: "概算見積額の計算結果が見つかりませんでした。お手数ですが再度お試しください。",
        });
      }

      // 次に LIFF への導線（ボタン + テキスト保険）
      const liffUrl = DETAILS_LIFF_URL || ""; // フルURL推奨（https://liff.line.me/...）
      const finalUrl = leadId && liffUrl
        ? (liffUrl.includes("?") ? `${liffUrl}&leadId=${encodeURIComponent(leadId)}`
                                  : `${liffUrl}?leadId=${encodeURIComponent(leadId)}`)
        : liffUrl;

      if (finalUrl) {
        await lineClient.pushMessage(userId, [
          {
            type: "template",
            altText: "詳細見積もりの入力",
            template: {
              type: "buttons",
              text: "より詳しい見積もりをご希望の方は、こちらから詳細情報をご入力ください。",
              actions: [{ type: "uri", label: "詳細見積もりを入力", uri: finalUrl }],
            },
          },
          { type: "text", text: `詳細見積もりはこちら：\n${finalUrl}` },
        ]);
      } else {
        await lineClient.pushMessage(userId, {
          type: "text",
          text: "詳細見積もりの入力リンクが未設定です。管理者にご連絡ください。（DETAILS_LIFF_URL）",
        });
      }
    }

    // 完了画面へ戻す（UIは変更しない）
    res.redirect("/after-login.html?ok=1");
  } catch (e) {
    console.error("[LOGIN] callback exception", e);
    res.status(500).send("Callback error");
  }
}

// いろいろなパスで受け付ける
router.get("/line/callback", handleCallback);
router.get("/auth/line/callback", handleCallback);
router.get("/line/login/callback", handleCallback);

export default router;
