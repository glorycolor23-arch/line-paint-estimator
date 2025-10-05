// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";

import webhookRouter from "./routes/webhook.js";      // LINE Webhook
import lineLoginRouter from "./routes/lineLogin.js";  // LINE Login
import estimateRouter from "./routes/estimate.js";    // ← 追加（/estimate, /api/estimate, /api/link-line-user）
import detailsRouter from "./routes/details.js";      // ← 追加（/api/details）

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// CORS
app.use(cors());

// ヘルスチェック
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// 静的配信（フロントの UI はそのまま）
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname)); // 直下に liff.html 等がある場合にも対応

// ✅ Webhook は bodyParser より前に
app.use("/line", webhookRouter);

// ✅ API は JSON パーサを有効化してから
app.use(bodyParser.json());
app.use(estimateRouter);   // /estimate, /api/estimate, /api/link-line-user
app.use(detailsRouter);    // /api/details
app.use(lineLoginRouter);  // /auth/line/*

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

// エラーハンドラ
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(500).send("Server Error");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[INFO] Server listening on ${PORT}`);
});
