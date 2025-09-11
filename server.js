// server.js（プロジェクト直下）
import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const CONFIG = {
  PORT: Number(process.env.PORT || 3000),
  LIFF_ID: process.env.LIFF_ID || '',
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

app.get('/healthz', (_req, res) => res.status(200).type('text').send('ok'));
app.get('/health',  (_req, res) => res.status(200).type('text').send('ok'));

app.get('/liff.html', (req, res, next) => {
  const filePath = path.join(publicDir, 'liff.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next(err);
    const out = html.replace('{{LIFF_ID_REPLACED_AT_RUNTIME}}', CONFIG.LIFF_ID || '');
    res.set('Content-Type', 'text/html; charset=utf-8').send(out);
  });
});

app.get('/liff.js', (req, res) => {
  const inPublic = path.join(publicDir, 'liff.js');
  const inRoot   = path.join(__dirname, 'liff.js');
  const filePath = fs.existsSync(inPublic) ? inPublic
                 : fs.existsSync(inRoot)   ? inRoot
                 : null;
  if (!filePath) return res.status(404).type('text').send('Not Found');
  res.sendFile(filePath);
});

app.use(express.static(publicDir, { index: 'index.html', maxAge: '5m' }));

async function importFirstExisting(candidates) {
  for (const rel of candidates) {
    const abs = path.join(__dirname, rel);
    if (fs.existsSync(abs)) return import(pathToFileURL(abs).href);
  }
  throw new Error(`Route module not found. Tried: ${candidates.join(', ')}`);
}

const { default: estimateRoutes } = await importFirstExisting([
  'routes/estimate.js',  // ← あなたの構成だとここが最初にヒット
  'src/estimate.js',
  'estimate.js',
]);
const { default: detailsRoutes }  = await importFirstExisting([
  'routes/details.js',
  'src/details.js',
  'details.js',
]);
const { default: webhookRoutes }  = await importFirstExisting([
  'routes/webhook.js',
  'src/webhook.js',
  'webhook.js',
]);

app.use(estimateRoutes);
app.use(detailsRoutes);
app.use(webhookRoutes);

app.use((req, res) => res.status(404).type('text').send('Not Found'));
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).type('text').send('Internal Server Error');
});

app.listen(CONFIG.PORT, () => {
  console.log('[INFO] Server started');
  console.log('[INFO] Port:', CONFIG.PORT);
  console.log('[INFO] Health:', `http://localhost:${CONFIG.PORT}/healthz`);
});
