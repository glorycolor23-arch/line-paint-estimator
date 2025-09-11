// server.js
import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import { fileURLToPath } from 'url';

// 環境設定（CONFIG がなければ process.env を直接使う）
import { CONFIG as CFG } from './config.js';

const CONFIG = {
  PORT: Number(CFG?.PORT || process.env.PORT || 3000),
  LIFF_ID: CFG?.LIFF_ID || process.env.LIFF_ID || '',
};

const app = express();

// ---- 基本設定 ----------------------------------------------------------
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors());
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

// ---- Health Check ------------------------------------------------------
// Render の Health Check で使います。/healthz 推奨、/health は互換用。
app.get('/healthz', (_req, res) => res.status(200).type('text').send('ok'));
app.get('/health',  (_req, res) => res.status(200).type('text').send('ok'));

// ---- LIFF HTML（動的に LIFF_ID を差し込み） ---------------------------
// public/liff.html 内の {{LIFF_ID_REPLACED_AT_RUNTIME}} を置換して返します。
// すでに liff.html を固定IDで書き換えている場合でも、そのまま返るため問題ありません。
app.get('/liff.html', (req, res, next) => {
  const filePath = path.join(publicDir, 'liff.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next(err);
    const id = CONFIG.LIFF_ID || '';
    const out = html.replace('{{LIFF_ID_REPLACED_AT_RUNTIME}}', id);
    res.set('Content-Type', 'text/html; charset=utf-8').send(out);
  });
});

// ---- liff.js の配置ゆらぎ対策 -----------------------------------------
// リポジトリ直下に liff.js がある場合と、public 配下にある場合の両方に対応。
app.get('/liff.js', (req, res, next) => {
  const pathInPublic = path.join(publicDir, 'liff.js');
  const pathInRoot   = path.join(__dirname, 'liff.js');
  const filePath = fs.existsSync(pathInPublic) ? pathInPublic
                 : fs.existsSync(pathInRoot)   ? pathInRoot
                 : null;
  if (!filePath) return res.status(404).type('text').send('Not Found');
  res.sendFile(filePath);
});

// ---- 静的ファイル（トップのフォームなど） ------------------------------
app.use(express.static(publicDir, { index: 'index.html', maxAge: '5m' }));

// ---- ルート（API / Webhook） -----------------------------------------
// 直下のファイルを前提に import。routes/ 配下にある構成の場合は import パスを調整してください。
import estimateRoutes from './estimate.js';
import detailsRoutes  from './details.js';
import webhookRoutes  from './webhook.js';

app.use(estimateRoutes); // /api/estimate, /api/link-line-user, /api/lead/:leadId ...
app.use(detailsRoutes);  // /api/details （詳細見積：ファイル受け取り→Sheets & Mail）
app.use(webhookRoutes);  // /line/webhook （Messaging API）

// ---- 404 / エラーハンドラ ---------------------------------------------
app.use((req, res) => {
  res.status(404).type('text').send('Not Found');
});

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).type('text').send('Internal Server Error');
});

// ---- 起動 --------------------------------------------------------------
app.listen(CONFIG.PORT, () => {
  console.log('[INFO] サーバーが起動しました');
  console.log('[INFO] ポート:', CONFIG.PORT);
  console.log('[INFO] 環境:', process.env.NODE_ENV || 'development');
  console.log('[INFO] ヘルスチェック:', `http://localhost:${CONFIG.PORT}/healthz`);
});
