// server.js
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import bodyParser from "body-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 静的ファイル（フロントは変更しない）
app.use(express.static(path.join(__dirname, "public")));

// 健康チェック
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));

// ルーター
import estimateRouter from "./routes/estimate.js";
import lineLoginRouter from "./routes/lineLogin.js";
import detailsRouter from "./routes/details.js";
import webhookRouter from "./routes/webhook.js";

app.use(estimateRouter);
app.use(lineLoginRouter);
app.use(detailsRouter);
app.use(webhookRouter);

// 明示的にトップを配信（/public の index.html を固定で返す）
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// エラーハンドラ
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(500).send("Server Error");
});

const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log(`[INFO] Server listening on ${PORT}`);
});
