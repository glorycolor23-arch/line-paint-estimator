// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs";

import webhookRouter from "./routes/webhook.js";      // LINE Webhook（follow で概算サマリー送付）
import lineLoginRouter from "./routes/lineLogin.js";  // LINE Login（callback でも概算サマリー送付）
import estimateRouter from "./routes/estimate.js";    // /estimate, /api/estimate, /api/link-line-user
import detailsRouter from "./routes/details.js";      // /api/details（LIFF 詳細送信）

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ===== 起動時に uploads/ を必ず作成（multer の保存先） =====
try { fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true }); } catch {}

// CORS
app.use(cors());

// ヘルスチェック
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// ---- 静的配信 ----
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));  // /index.html, /after-login.html, /styles.css, /liff.js など
app.use(express.static(__dirname));   // 互換（/public/... と直下の両方を拾える）

// ---- Webhook は bodyParser より前に（LINE署名検証のため）----
app.use("/line", webhookRouter);

// ---- Login / JSON 本文 / API ルータ ----
app.use(lineLoginRouter);
app.use(bodyParser.json());
app.use(estimateRouter);
app.use(detailsRouter);

// ---- 明示ルート（Cannot GET 対策）----
app.get(["/after-login", "/after-login.html"], (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "after-login.html"));
});

// /liff 系は /liff.html を正とし、/liff や /liff/index.html は転送
app.get("/liff.html", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "liff.html"));
});
app.get(["/liff", "/liff/", "/liff/index.html"], (req, res) => {
  const q = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect(302, `/liff.html${q}`);
});

// ルート（トップ）
app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
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
