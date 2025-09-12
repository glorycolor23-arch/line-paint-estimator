import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import bodyParser from 'body-parser';

import webhookRouter from './routes/webhook.js';
import lineLoginRouter from './routes/lineLogin.js';  // ★ 追加

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ヘルスチェック
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// 静的配信（フロントはそのまま）
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Webhook（/line/webhook）
app.use('/line', webhookRouter);

// ★ LINEログイン（/auth/line/callback, /line/callback, /callback を受ける）
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
  console.log('[INFO] Login callback paths enabled: /auth/line/callback, /line/callback, /callback');
});
