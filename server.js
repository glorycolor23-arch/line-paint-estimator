// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import bodyParser from 'body-parser';

// ルートのディレクトリ解決
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ------------------------------------
// 1) Webhook を最優先で登録（body-parser より前）
// ------------------------------------
import webhookRoutes from './routes/webhook.js';
app.use(webhookRoutes);

// ------------------------------------
// 2) 一般ミドルウェア（Webhook の後）
// ------------------------------------
app.use(cors());
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));

// ------------------------------------
// 3) アプリのAPIルートを登録（←これがないと送信に失敗）
//    ルータが /api/xxx を持っていても root マウントでOK
// ------------------------------------
import estimateRoutes from './routes/estimate.js';
import detailsRoutes from './routes/details.js';
app.use(estimateRoutes);
app.use(detailsRoutes);

// 静的ファイル（/public）
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// ヘルスチェック
app.get(['/healthz', '/health'], (_req, res) => res.type('text').send('ok'));

// 404
app.use((req, res, next) => {
  if (res.headersSent) return next();
  console.warn('[404]', req.method, req.originalUrl);
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// エラーハンドラ
app.use((err, req, res, _next) => {
  console.error('[UNCAUGHT ERROR]', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 起動
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('[INFO] サーバーが起動しました');
  console.log('[INFO] ポート:', PORT);
  console.log('[INFO] 環境:', process.env.NODE_ENV || 'development');
  console.log('[INFO] ヘルスチェック: http://localhost:' + PORT + '/healthz');
});

export default app;
