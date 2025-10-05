// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";

import webhookRouter from "./routes/webhook.js";      // LINE Webhook
import lineLoginRouter from "./routes/lineLogin.js";  // LINE Login（コールバックで after-login に遷移）
import estimateRouter from "./routes/estimate.js";    // /estimate, /api/estimate, /api/link-line-user
import detailsRouter from "./routes/details.js";      // /api/details

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());

// ヘルス
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// 静的（フロントはそのまま）
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname)); // 直下の liff.html / after-login.html も出す

// ✅ Webhook は bodyParser より前
app.use("/line", webhookRouter);

// ✅ API は JSON パーサ後に
app.use(bodyParser.json());
app.use(estimateRouter);
app.use(detailsRouter);
app.use(lineLoginRouter);

// ルート
app.get("/", (req, res) => {
  const a = path.join(__dirname, "public", "index.html");
  const b = path.join(__dirname, "index.html");
  res.sendFile(a, (err) => { if (err) res.sendFile(b, (err2) => err2 && res.status(404).send("Not Found")); });
});

// エラーハンドラ
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(500).send("Server Error");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`[INFO] Server listening on ${PORT}`));
