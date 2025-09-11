// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import bodyParser from 'body-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

/** 1) Webhook を最優先登録（body-parser より前） */
import webhookRoutes from './routes/webhook.js';
app.use(webhookRoutes);

/** 2) 共通ミドルウェア */
app.use(cors());
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));

/** 3) 既存API（見積・詳細） */
import estimateRoutes from './routes/estimate.js';
import detailsRoutes from './routes/details.js';
app.use(estimateRoutes);
app.use(detailsRoutes);

/** 4) LINEログイン（★新規追加） */
import lineLoginRoutes from './routes/lineLogin.js';
app.use(lineLoginRoutes);

/** 5) 静的配信（/public） */
import fs from 'fs';
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) app.use(express.static(publicDir));

/** 6) ヘルスチェック */
app.get(['/healthz', '/health'], (_req, res) => res.type('text').send('ok'));

/** 404 / Error */
app.use((req, res, next) => {
  if (res.headersSent) return next();
  console.warn('[404]', req.method, req.originalUrl);
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});
app.use((err, req, res, _next) => {
  console.error('[UNCAUGHT ERROR]', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Internal Server Error' });
});

/** 起動 */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('[INFO] server started:', PORT);
  console.log('[INFO] health:', `http://localhost:${PORT}/healthz`);
});

export default app;
