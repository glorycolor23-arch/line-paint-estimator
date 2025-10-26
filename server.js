// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs";

// 既存ルータ
import webhookRouter from "./routes/webhook.js";     // /line/webhook（follow時の概算送付など）
import lineLoginRouter from "./routes/lineLogin.js"; // /auth/line/...（ログイン後の誘導）
import estimateRouter from "./routes/estimate.js";   // /estimate, /api/estimate, /api/link-line-user
import detailsRouter from "./routes/details.js";     // /api/details（LIFF詳細送信）

// ★ 追加：自己診断用
import selftestRouter from "./routes/selftest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ===== 起動時に uploads/ を必ず作成（multerの保存先）=====
try {
  fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
} catch { /* ignore */ }

// CORS（必要なら限定してください）
app.use(cors());

// 軽量ヘルスチェック & ping
app.get("/healthz", (_req, res) => res.type("text").send("ok"));
app.get("/__ping", (_req, res) => res.type("text").send("pong"));

// ★ 追加：自己診断ルータを最初にマウント
app.use(selftestRouter);
console.log("[BOOT] selftestRouter mounted");

// 静的配信（フロントUI）
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname)); // 直下に liff.html / after-login.html がある想定の互換

// LINE Webhook は bodyParser より前に置く
app.use("/line", webhookRouter);

// LINE ログイン系（/auth/line/callback 等）
app.use(lineLoginRouter);

// 以降は通常の JSON ボディを扱う API
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// 概算＆詳細API
app.use(estimateRouter);
app.use(detailsRouter);

// ルート（index.html を返す）
app.get("/", (req, res) => {
  const p1 = path.join(__dirname, "public", "index.html");
  const p2 = path.join(__dirname, "index.html");
  res.sendFile(p1, (err) => {
    if (err) res.sendFile(p2, (err2) => err2 && res.status(404).send("Not Found"));
  });
});

// エラーハンドラ
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(500).send("Server Error");
});

const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => console.log(`[INFO] Server listening on ${PORT}`));
