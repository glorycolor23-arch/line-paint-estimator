// server.js
import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { CONFIG as CFG } from './src/config.js'; // ← src 配下の config を参照

const CONFIG = {
  PORT: Number(CFG?.PORT || process.env.PORT || 3000),
  LIFF_ID: CFG?.LIFF_ID || process.env.LIFF_ID || '',
};

const app = express();

// ---- Middlewares ------------------------------------------------------
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors());
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

// ---- Health Check -----------------------------------------------------
app.get('/healthz', (_req, res) => res.status(200).type('text').send('ok'));
app.get('/health',  (_req, res) => res.status(200).type('text').send('ok'));

// ---- LIFF HTML (runtime inject) --------------------------------------
app.get('/liff.html', (req, res, next) => {
  const filePath = path.join(publicDir, 'liff.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next(err);
    const out = html.replace('{{LIFF_ID_REPLACED_AT_RUNTIME}}', CONFIG.LIFF_ID || '');
    res.set('Content-Type', 'text/html; charset=utf-8').send(out);
  });
});

// ---- liff.js の場所ゆらぎ対策 ----------------------------------------
app.get('/liff.js', (req, res, next) => {
  const inPublic = path.join(publicDir, 'liff.js');
  const inRoot   = path.join(__dirname, 'liff.js');
  const filePath = fs.existsSync(inPublic) ? inPublic
                 : fs.existsSync(inRoot)   ? inRoot
                 : null;
  if (!filePath) return res.status(404).type('text').send('Not Found');
  res.sendFile(filePath);
});

// ---- Static files -----------------------------------------------------
app.use(express.static(publicDir, { index: 'index.html', maxAge: '5m' }));

// ---- Routes (src/*.js を使用) ----------------------------------------
import estimateRoutes from './src/estimate.js';
import detailsRoutes  from './src/details.js';
import webhookRoutes  from './src/webhook.js';

app.use(estimateRoutes);
app.use(detailsRoutes);
app.use(webhookRoutes);

// ---- 404 / Error handlers --------------------------------------------
app.use((req, res) => res.status(404).type('text').send('Not Found'));
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).type('text').send('Internal Server Error');
});

// ---- Start ------------------------------------------------------------
app.listen(CONFIG.PORT, () => {
  console.log('[INFO] Server started');
  console.log('[INFO] Port:', CONFIG.PORT);
  console.log('[INFO] Env:', process.env.NODE_ENV || 'development');
  console.log('[INFO] Health:', `http://localhost:${CONFIG.PORT}/healthz`);
});
