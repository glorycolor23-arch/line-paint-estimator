// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";

import webhookRouter from "./routes/webhook.js";
import lineLoginRouter from "./routes/lineLogin.js";
import estimateRouter from "./routes/estimate.js";
import detailsRouter from "./routes/details.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// ---- 共有ストア（初期アンケの一時保存）----
app.locals.pendingEstimates = new Map();

app.use(cors());

// ヘルスチェック
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// 静的配信
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname)); // 直下に liff.html などがある場合に備える

// ✅ Webhook は body-parser より前に
app.use("/line", webhookRouter);

// ログイン関連
app.use(lineLoginRouter);

// ここから API（JSON）
app.use(bodyParser.json());
app.use(estimateRouter);
app.use(detailsRouter);

// ルート
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`[INFO] Server listening on ${PORT}`));
