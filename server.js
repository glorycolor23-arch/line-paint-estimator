// server.js
import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { CONFIG } from './config.js';
import estimateRoutes from './routes/estimate.js';
import detailsRoutes from './routes/details.js';
import webhookRoutes from './routes/webhook.js';

const app = express();

// ---- 基本ミドルウェア -------------------------------------------------
app.disable('x-powered-by');
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

// ---- Health Check -----------------------------------------------------
// Render の Health Check 用。ブラウザで /healthz を開くと "ok" が返ります。
app.get('/healthz', (_req, res) => {
  res.status(200).type('text').send('ok');
});
// 互換用（もし以前 /health を指定していた場合のため）
app.get('/health', (_req, res) => {
  res.status(200).type('text').send('ok');
});

// ---- LIFF HTML の動的差し込み -----------------------------------------
// 環境変数 LIFF_ID を public/liff.html のプレースホルダへ差し込み。
// すでに liff.html に直接 ID を書いている場合でも、そのまま返るので問題ありません。
app.get('/liff.html', (req, res, next) => {
  const filePath = path.join(publicDir, 'liff.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next(err);
    const replaced = html.replace('{{LIFF_ID_REPLACED_AT_RUNTIME}}', CONFIG.LIFF_ID || '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(replaced);
  });
});

// ---- 静的ファイル（トップのフォームなど） -----------------------------
app.use(express.static(publicDir, { index: 'index.html', maxAge: '5m' }));

// ---- API / Webhook ルート ---------------------------------------------
app.use(estimateRoutes);  // /api/estimate, /api/link-line-user, /api/lead/:leadId
app.use(detailsRoutes);   // /api/details （ファイル受け取り + スプレッドシート + メール）
app.use(webhookRoutes);   // /line/webhook （Messaging API Webhook）

// ---- 404 / エラーハンドラ ---------------------------------------------
app.use((req, res) => {
  res.status(404).type('text').send('Not Found');
});

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).type('text').send('Internal Server Error');
});

// ---- 起動 -------------------------------------------------------------
app.listen(CONFIG.PORT, () => {
  console.log(`Server running on :${CONFIG.PORT}`);
});
