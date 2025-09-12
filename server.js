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
app.disable('x-powered-by');
app.set('trust proxy', 1);

// CORS（フロントはそのまま）
app.use(cors());

// ★ ヘルスチェック（Render の Health Check Path を /healthz にしている想定）
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// ★ どの順序でも署名検証できるように rawBody を常時保持
const keepRaw = (req, _res, buf) => {
  if (buf && buf.length) req.rawBody = buf;
};
app.use(bodyParser.json({ verify: keepRaw }));
app.use(bodyParser.urlencoded({ extended: true, verify: keepRaw }));

// 静的ファイル（UI は変更しない）
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // 直下に liff.html などがある場合

// LINE Webhook（/line/webhook）。内部で 200 を必ず返す実装にしてある
app.use('/line', webhookRouter);

// LINEログイン（/auth/line/callback 等）
app.use(lineLoginRouter);

// ルート（既存の index.html を優先）
app.get('/', (req, res) => {
  const file1 = path.join(__dirname, 'public', 'index.html');
  const file2 = path.join(__dirname, 'index.html');
  res.sendFile(file1, (err) => {
    if (err) res.sendFile(file2, (err2) => err2 && res.status(404).send('Not Found'));
  });
});

// 最後のエラーハンドラ（未処理例外で 502 化しないように握りつぶして 500）
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).send('Server Error');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[INFO] Server listening on ${PORT}`);
});
