// server.js
import express from "express";
import path from "path";
import cors from "cors";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";

import webhookRouter from "./routes/webhook.js";
import lineLoginRouter from "./routes/lineLogin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(bodyParser.json());

// Health check
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// 静的ファイル配信（/public と直下の両方）
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname)); // liff.html など直下も配信

// ★ 重要: LINEログインのルーターを必ずマウント（/login, /start, /callback 等）
app.use(lineLoginRouter);

// ★ Webhook ルーター
app.use("/line", webhookRouter);  // /line/webhook
app.use(webhookRouter);           // /webhook（互換）

// ルート
app.get("/", (req, res) => {
  const f1 = path.join(__dirname, "public", "index.html");
  const f2 = path.join(__dirname, "index.html");
  res.sendFile(f1, (err) => {
    if (err) res.sendFile(f2, (err2) => err2 && res.status(404).send("Not Found"));
  });
});

// Safety error handler
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(500).send("Server Error");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[INFO] Server listening on ${PORT}`);
});
