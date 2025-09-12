import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import bodyParser from 'body-parser';

import webhookRouter from './routes/webhook.js';
import lineLoginRouter from './routes/lineLogin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// CORS
app.use(cors());

// ヘルスチェック
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// 静的ファイル（フロントはそのまま）
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // 直下に liff.html 等がある場合

/**
 * ★ 重要：LINE Webhook は bodyParser より前にマウントする ★
 * これにより @line/bot-sdk が raw body で署名検証できます。
 * 最終URLは /line/webhook になります（コンソールのWebhook URLと一致）
 */
app.use('/line', webhookRouter);

// ここから先は汎用の JSON パーサを使ってOK
app.use(bodyParser.json());

// LINEログイン（/auth/line/callback 等）
app.use(lineLoginRouter);

// ルート
app.get('/', (req, res) => {
  const file1 = path.join(__dirname, 'public', 'index.html');
  const file2 = path.join(__dirname, 'index.html');
  res.sendFile(file1, (err) => {
    if (err) res.sendFile(file2, (err2) => err2 && res.status(404).send('Not Found'));
  });
});

// エラーハンドラ
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).send('Server Error');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[INFO] Server listening on ${PORT}`);
  console.log('[INFO] Login callback paths: /auth/line/callback, /line/callback, /callback');
});
