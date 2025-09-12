// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";
import webhookRouter from "./webhook.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ヘルスチェック
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// 静的ファイル配信（/public とプロジェクト直下の両方を見る）
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname)); // 直下に liff.html 等がある場合も拾える

// LINE Webhook
app.use("/line", webhookRouter);

// ルート（静的配信に任せても OK）
app.get("/", (req, res) => {
  // /public/index.html があればそれを、なければ直下 index.html
  const file1 = path.join(__dirname, "public", "index.html");
  const file2 = path.join(__dirname, "index.html");
  res.sendFile(file1, (err) => {
    if (err) res.sendFile(file2, (err2) => err2 && res.status(404).send("Not Found"));
  });
});

// エラーハンドラ（落ちにくくする）
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(500).send("Server Error");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[INFO] Server listening on ${PORT}`);
});
