// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs";

// ルータ
import webhookRouter from "./routes/webhook.js";      // ← LINE Webhook（bodyParserより前にマウント）
import lineLoginRouter from "./routes/lineLogin.js";  // ← LINE Login 一式
import estimateRouter from "./routes/estimate.js";    // ← 初回アンケート & /api/link-line-user
import detailsRouter from "./routes/details.js";      // ← LIFF 詳細送信（ファイル添付）

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ------- 起動時に一時アップロード先を必ず作る（multerは自動作成しない）-------
try {
  fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
} catch (_) {
  // noop
}

// ------- CORS / ヘルスチェック -------
app.use(cors());
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// ------- 静的ファイル配信 -------
// /public/... というパスで public ディレクトリ内を配信（例: /public/styles.css, /public/app.js）
app.use("/public", express.static(path.join(__dirname, "public")));
// 互換: サービス直下に置いた liff.html 等も配信可能に（例: /liff.html）
app.use(express.static(__dirname));

// ------- 重要：Webhook は bodyParser より“前”にマウント -------
app.use("/line", webhookRouter); // /line/webhook（互換で /webhook も内部で受ける）

// ------- ログイン系（/auth/line/callback 等） -------
app.use(lineLoginRouter);

// ------- JSON ボディ（Webhook 以外の API 用） -------
app.use(bodyParser.json());

// ------- アンケート/見積 API・詳細送信 API -------
app.use(estimateRouter);
app.use(detailsRouter);

// ------- ルート: フロントの index.html を返す（/public/index.html 優先） -------
app.get("/", (_req, res) => {
  const file1 = path.join(__dirname, "public", "index.html");
  const fallback = path.join(__dirname, "index.html");
  res.sendFile(file1, (err) => {
    if (err) res.sendFile(fallback, (err2) => err2 && res.status(404).send("Not Found"));
  });
});

// ------- エラーハンドラ -------
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(500).send("Server Error");
});

// ------- ポート起動 -------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[INFO] Server listening on ${PORT}`);
});
