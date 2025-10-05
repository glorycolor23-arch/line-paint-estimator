// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- ルーターを動的に読み込む（拡張子あり/なしどちらでもOK） ----------
async function loadRouter(moduleBasePath, humanName) {
  try {
    let mod;
    try {
      // まず拡張子あり
      mod = await import(`${moduleBasePath}.js`);
    } catch (e1) {
      try {
        // 拡張子なしのファイル名にフォールバック
        mod = await import(moduleBasePath);
      } catch (e2) {
        console.error(`[FATAL] Failed to import ${humanName} from "${moduleBasePath}.js" and "${moduleBasePath}"`);
        console.error("e1:", e1?.message);
        console.error("e2:", e2?.message);
        process.exit(1);
      }
    }
    const router = mod?.default || mod?.router || mod;
    if (!router || typeof router !== "function") {
      console.error(`[FATAL] ${humanName} did not export an Express router (default/router).`);
      process.exit(1);
    }
    return router;
  } catch (e) {
    console.error(`[FATAL] Unexpected error while loading ${humanName}:`, e);
    process.exit(1);
  }
}

// 必要な各ルーターをロード（ここで失敗すれば必ずどのモジュールかがログに出る）
const webhookRouter  = await loadRouter("./routes/webhook",   "webhook router");
const lineLoginRouter= await loadRouter("./routes/lineLogin", "lineLogin router");
const estimateRouter = await loadRouter("./routes/estimate",  "estimate router");
const detailsRouter  = await loadRouter("./routes/details",   "details router");

const app = express();

// ------- 起動時に一時アップロード先を必ず作る（multerは自動作成しない）-------
try {
  fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
} catch (_) { /* noop */ }

// ------- CORS / ヘルスチェック -------
app.use(cors());
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// ------- 静的ファイル配信 -------
// /public/... というパスで public ディレクトリ内を配信（例: /public/styles.css, /public/app.js）
app.use("/public", express.static(path.join(__dirname, "public")));
// 互換: サービス直下に置いた liff.html 等も配信可能に（例: /liff.html）
app.use(express.static(__dirname));

// ------- LIFF の古いエンドポイントへのフォールバック -------
// LINE 側の自動遷移で /liff/index.html になっても常に public/liff.html を返す
app.get(["/liff", "/liff/index.html"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "liff.html"));
});

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
  const main = path.join(__dirname, "public", "index.html");
  const fallback = path.join(__dirname, "index.html");
  res.sendFile(main, (err) => {
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
