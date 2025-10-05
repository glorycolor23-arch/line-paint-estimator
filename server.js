// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs";

import webhookRouter from "./routes/webhook.js";      // LINE Webhook
import lineLoginRouter from "./routes/lineLogin.js";  // LINE Login 一式
import estimateRouter from "./routes/estimate.js";    // 初回アンケート & link-line-user
import detailsRouter from "./routes/details.js";      // LIFF 詳細送信（ファイル付き）

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// --- 一時アップロード先を必ず作っておく（multer は自動作成しない） ---
try {
  fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
} catch (_) { /* noop */ }

// CORS は先でOK
app.use(cors());

// ヘルスチェック
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// 静的配信（フロントの UI はそのまま）
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname)); // 直下に liff.html などがある想定のまま

// ✅ 重要：Webhook を最初にマウント（署名検証のため bodyParser より前に置く）
app.use("/line", webhookRouter);

// ログイン系
app.use(lineLoginRouter);

// これ以降は JSON API
app.use(bodyParser.json());

// 初回アンケート API（/estimate と /api/estimate の両方を面倒を見る）
app.use(estimateRouter);

// LIFF からの詳細送信
app.use(detailsRouter);

// ルート（フロントの index）
app.get("/", (_req, res) => {
  const file1 = path.join(__dirname, "public", "index.html");
  const file2 = path.join(__dirname, "index.html");
  res.sendFile(file1, (err) => {
    if (err) res.sendFile(file2, (err2) => err2 && res.status(404).send("Not Found"));
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
