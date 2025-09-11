// server.js
import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

// ================== 基本設定（env 直読み） ==================
const CONFIG = {
  PORT: Number(process.env.PORT || 3000),
  LIFF_ID: process.env.LIFF_ID || '', // liff.html へ差し込み
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors());
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

// ================== Health Check ==================
app.get('/healthz', (_req, res) => res.status(200).type('text').send('ok'));
app.get('/health',  (_req, res) => res.status(200).type('text').send('ok'));

// ================== LIFF HTML（LIFF_ID を差し込み） ==================
app.get('/liff.html', (req, res, next) => {
  const filePath = path.join(publicDir, 'liff.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next(err);
    const out = html.replace('{{LIFF_ID_REPLACED_AT_RUNTIME}}', CONFIG.LIFF_ID || '');
    res.set('Content-Type', 'text/html; charset=utf-8').send(out);
  });
});

// liff.js が root または public にある場合の両対応
app.get('/liff.js', (req, res) => {
  const inPublic = path.join(publicDir, 'liff.js');
  const inRoot   = path.join(__dirname, 'liff.js');
  const filePath = fs.existsSync(inPublic) ? inPublic
                 : fs.existsSync(inRoot)   ? inRoot
                 : null;
  if (!filePath) return res.status(404).type('text').send('Not Found');
  res.sendFile(filePath);
});

// 静的ファイル（トップのフォーム等）
app.use(express.static(publicDir, { index: 'index.html', maxAge: '5m' }));

// ================== ルート自動解決（配置の揺れ対策） ==================
async function importFirstExisting(candidates) {
  for (const rel of candidates) {
    const abs = path.join(__dirname, rel);
    if (fs.existsSync(abs)) {
      return import(pathToFileURL(abs).href);
    }
  }
  throw new Error(`Route module not found. Tried: ${candidates.join(', ')}`);
}

const { default: estimateRoutes } = await importFirstExisting([
  'estimate.js',         // 直下
  'routes/estimate.js',  // routes/ 配下
  'src/estimate.js',     // src/ 配下
]);

const { default: detailsRoutes } = await importFirstExisting([
  'details.js',
  'routes/details.js',
  'src/details.js',
]);

const { default: webhookRoutes } = await importFirstExisting([
  'webhook.js',
  'routes/webhook.js',
  'src/webhook.js',
]);

app.use(estimateRoutes);
app.use(detailsRoutes);
app.use(webhookRoutes);

// ================== ハンドラ ==================
app.use((req, res) => res.status(404).type('text').send('Not Found'));

app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).type('text').send('Internal Server Error');
});

// ================== 起動 ==================
app.listen(CONFIG.PORT, () => {
  console.log('[INFO] Server started');
  console.log('[INFO] Port:', CONFIG.PORT);
  console.log('[INFO] Health:', `http://localhost:${CONFIG.PORT}/healthz`);
});
