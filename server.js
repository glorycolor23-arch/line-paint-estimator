// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";

import webhookRouter from "./routes/webhook.js";      // ← LINE Webhook
import lineLoginRouter from "./routes/lineLogin.js";  // ← 既存のログインルータ（そのまま）

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// CORS は先でOK
app.use(cors());

// ヘルスチェック
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// 静的配信（フロントの UI はそのまま）
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname)); // 直下に liff.html などがある想定のまま

// ✅ 重要：LINE Webhook を「最初に」マウントする（bodyParser より前）
app.use("/line", webhookRouter);

// 既存のログイン系ルート（/login, /auth/line/callback など）
app.use(lineLoginRouter);

// それ以外の API 用（Webhook より後ろに置くのがポイント）
app.use(bodyParser.json());

// ルート（フロントの index）
app.get("/", (req, res) => {
  const file1 = path.join(__dirname, "public", "index.html");
  const file2 = path.join(__dirname, "index.html");
  res.sendFile(file1, (err) => {
    if (err) {
      res.sendFile(file2, (err2) => err2 && res.status(404).send("Not Found"));
    }
  });
});

// エラーハンドラ（落ちにくく）
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(500).send("Server Error");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[INFO] Server listening on ${PORT}`);
});
