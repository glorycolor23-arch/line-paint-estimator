import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import crypto from "crypto";
import axios from "axios";
import line from "@line/bot-sdk";

dotenv.config();

const app = express();

// ---------- 基本設定 ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  CHANNEL_SECRET = "",
  CHANNEL_ACCESS_TOKEN = "",
  LIFF_ID = "",
  FRIEND_ADD_URL = "",
  SUPABASE_URL = "",
  SUPABASE_SERVICE_ROLE_KEY = "",
  GOOGLE_SERVICE_ACCOUNT_EMAIL = "",
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "",
  GSHEET_SPREADSHEET_ID = "",
  GSHEET_SHEET_NAME = "Entries",
  EMAIL_TO = "",
  EMAIL_WEBAPP_URL = ""
} = process.env;

// LINE SDK クライアント
const lineClient = new line.Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN
});

// 署名検証に必要な生バイトを保持
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

// ---------- ヘルスチェック ----------
app.get("/health", (_req, res) => {
  res.type("text/plain").send("ok");
});

// ---------- LIFF 用の環境JS（動的に返す） ----------
app.get("/liff/env.js", (_req, res) => {
  const payload = {
    LIFF_ID: LIFF_ID || "",
    FRIEND_ADD_URL: FRIEND_ADD_URL || ""
  };
  res
    .type("application/javascript")
    .send(`window.__LIFF_ENV__=${JSON.stringify(payload)};`);
});

// ---------- LIFF の静的配信 ----------
app.use("/liff", express.static(path.join(__dirname, "liff"), { index: "index.html" }));

// ---------- ルート ----------
app.get("/", (_req, res) => res.redirect("/liff/index.html"));

// =============================================================
// Webhook（署名検証 → イベント分岐）
// =============================================================
function validateLineSignature(req) {
  const signature = req.get("x-line-signature");
  if (!signature) return false;
  const body = req.rawBody || Buffer.from(JSON.stringify(req.body), "utf8");
  const hmac = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hmac));
}

// 簡易ステート（本番は永続化推奨）
const sessions = new Map();

function startSession(userId, scope) {
  const base = {
    step: 0,
    scope, // 'wall' | 'roof' | 'both'
    answers: {},
    asking: []
  };
  if (scope === "wall") {
    base.asking = [
      { k: "wallMaterial", q: "外壁の種類は？", img: "https://i.imgur.com/5QS0v7S.png", choices: ["モルタル", "サイディング", "ALC"] },
      { k: "wallDamage", q: "外壁の損傷状況は？", img: "https://i.imgur.com/g9hOqV6.png", choices: ["ひび割れ", "チョーキング", "欠損", "軽微"] }
    ];
  } else if (scope === "roof") {
    base.asking = [
      { k: "roofType", q: "屋根の種類は？", img: "https://i.imgur.com/V1V2P2E.png", choices: ["スレート", "瓦", "ガルバリウム"] },
      { k: "roofLeak", q: "雨漏りの状況は？", img: "https://i.imgur.com/M1h7yQk.png", choices: ["なし", "シミ有り", "漏れている"] }
    ];
  } else {
    // both
    base.asking = [
      { k: "roofType", q: "屋根の種類は？", img: "https://i.imgur.com/V1V2P2E.png", choices: ["スレート", "瓦", "ガルバリウム"] },
      { k: "roofLeak", q: "雨漏りの状況は？", img: "https://i.imgur.com/M1h7yQk.png", choices: ["なし", "シミ有り", "漏れている"] },
      { k: "wallMaterial", q: "外壁の種類は？", img: "https://i.imgur.com/5QS0v7S.png", choices: ["モルタル", "サイディング", "ALC"] },
      { k: "wallDamage", q: "外壁の損傷状況は？", img: "https://i.imgur.com/g9hOqV6.png", choices: ["ひび割れ", "チョーキング", "欠損", "軽微"] }
    ];
  }
  sessions.set(userId, base);
  return base;
}

function buildFlexImageButtons(title, heroUrl, buttons) {
  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: heroUrl,
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: title, weight: "bold", size: "lg" },
          ...buttons.map((b) => ({
            type: "button",
            style: "secondary",
            color: "#f0f0f0",
            action: {
              type: "postback",
              label: b.label,
              data: b.data,
              displayText: b.displayText || b.label
            }
          }))
        ]
      }
    }
  };
}

function buildQuestionFlex(question, choices) {
  return {
    type: "flex",
    altText: question.q,
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: question.img,
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: question.q, weight: "bold", wrap: true },
          ...choices.map((c) => ({
            type: "button",
            style: "primary",
            color: "#00b900",
            action: {
              type: "postback",
              label: c,
              data: `ans=${encodeURIComponent(question.k)}&v=${encodeURIComponent(c)}`,
              displayText: c
            }
          }))
        ]
      }
    }
  };
}

function buildLiffCard() {
  const liffUrl = `https://liff.line.me/${LIFF_ID}`;
  return {
    type: "flex",
    altText: "詳しい見積もりをご希望の方へ",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "詳しい見積もりをご希望の方へ", weight: "bold", size: "lg" },
          { type: "box", layout: "vertical", backgroundColor: "#F6F6F6FF", cornerRadius: "md", paddingAll: "12px", contents: [
              { type: "text", text: "見積り金額", weight: "bold" },
              { type: "text", text: "¥ 000,000", size: "xl" },
              { type: "text", text: "上記はご入力内容を元に算出した概算金額です。", wrap: true, size: "sm" }
            ]
          },
          { type: "text", text: "正式なお見積りが必要な方は続けてご入力をお願いします。", wrap: true, size: "sm" },
          { type: "button", style: "primary", color: "#00B900", action: { type: "uri", label: "現地調査なしで見積を依頼", uri: liffUrl } }
        ]
      }
    }
  };
}

async function reply(replyToken, messages) {
  try {
    await lineClient.replyMessage(replyToken, Array.isArray(messages) ? messages : [messages]);
  } catch (e) {
    console.error("reply error", e?.response?.data || e);
  }
}

app.post("/webhook", async (req, res) => {
  if (!validateLineSignature(req)) {
    return res.status(403).end();
  }
  const events = req.body.events || [];
  for (const ev of events) {
    try {
      if (ev.type === "message" && ev.message?.type === "text") {
        const text = (ev.message.text || "").trim();
        if (/^(見積もり|スタート)$/i.test(text)) {
          const flex = buildFlexImageButtons(
            "どの工事をご希望ですか？",
            "https://i.imgur.com/a8J8Y8s.jpeg",
            [
              { label: "外壁塗装", data: "scope=wall", displayText: "外壁塗装" },
              { label: "屋根塗装", data: "scope=roof", displayText: "屋根塗装" },
              { label: "外壁+屋根", data: "scope=both", displayText: "外壁+屋根" }
            ]
          );
          await reply(ev.replyToken, [flex, buildLiffCard()]);
          continue;
        }
        if (/^リセット$/i.test(text)) {
          sessions.delete(ev.source.userId);
          await reply(ev.replyToken, { type: "text", text: "会話状態をリセットしました。もう一度「見積もり」と送信してください。" });
          continue;
        }
      }

      if (ev.type === "postback") {
        const data = new URLSearchParams(ev.postback.data || "");
        if (data.has("scope")) {
          const scope = data.get("scope");
          const sess = startSession(ev.source.userId, scope);
          const q = sess.asking[0];
          await reply(ev.replyToken, buildQuestionFlex(q, q.choices));
          continue;
        }
        if (data.has("ans")) {
          const k = data.get("ans");
          const v = data.get("v");
          const sess = sessions.get(ev.source.userId);
          if (!sess) {
            await reply(ev.replyToken, { type: "text", text: "最初からやり直します。「見積もり」と送信してください。" });
            continue;
          }
          sess.answers[k] = v;
          sess.step += 1;

          if (sess.step < sess.asking.length) {
            const q = sess.asking[sess.step];
            await reply(ev.replyToken, buildQuestionFlex(q, q.choices));
          } else {
            // すべての質問が終わり。メールやスプレッドシートへの通知は「完了」時に LIFF から送信される想定。
            await reply(ev.replyToken, [
              { type: "text", text: "回答ありがとうございました。続けて詳細見積りをご希望の方は、下のボタンから入力してください。" },
              buildLiffCard()
            ]);
          }
          continue;
        }
      }
    } catch (err) {
      console.error("event error", err?.response?.data || err);
    }
  }
  res.status(200).end();
});

// =============================================================
// 詳細見積り送信 API（LIFF から呼ばれる）
//  - QA中は管理者通知を送らず、送信完了時のみメール/スプレッドシート登録
// =============================================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post("/api/submit", async (req, res) => {
  try {
    const payload = req.body || {};
    // Google Apps Script WebAppへ転送（メール送信）
    if (EMAIL_WEBAPP_URL) {
      await axios.post(EMAIL_WEBAPP_URL, {
        ...payload,
        emailTo: EMAIL_TO
      });
    }

    // スプレッドシート（Apps Script側で同時書込している前提／ここで直接書く場合は Google API を利用）
    // ここでは最小限（Apps Script に集約推奨）
    // 必要であれば server 側で googleapis を使って append する処理を追加してください。

    res.json({ ok: true });
  } catch (e) {
    console.error("/api/submit error", e?.response?.data || e);
    res.status(500).json({ ok: false });
  }
});

// ---------- 起動 ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
