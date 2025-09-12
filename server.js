// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ヘルスチェック
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// 静的ファイル配信（/public とプロジェクト直下）
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.use(express.static(__dirname, { extensions: ["html"] }));

// LIFF 用設定を JS として配信（liff.html から読み込み）
app.get("/liff-config.js", (_req, res) => {
  const cfg = {
    LIFF_ID: process.env.LIFF_ID || "",
  };
  res.type("application/javascript").send(`window.LIFF_ID=${JSON.stringify(cfg.LIFF_ID)};`);
});

// /liff, /liff/ , /liff/index.html などは liff.html を返す
app.get(["/liff", "/liff/", "/liff/index.html", "/liff/*"], (_req, res) => {
  res.sendFile(path.join(__dirname, "liff.html"));
});

// 既存 API / Webhook を読み込み
import webhook from "./webhook.js";
app.use("/line", webhook);

// 最後のフォールバック（存在しないパスは 404）
app.use((req, res) => {
  res.status(404).type("text").send(`Not Found: ${req.originalUrl}`);
});

// 起動
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("[INFO] server running on", PORT);
  console.log("[INFO] health:", `http://localhost:${PORT}/healthz`);
});
