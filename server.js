// server.js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as line from '@line/bot-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  PORT = 10000,
  NODE_ENV = 'production',
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
} = process.env;

const app = express();
app.use(express.json());

// --- 静的ファイル ---
// /public 以下（新UI）と /img（ローカル画像）を確実に配信
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/img', express.static(path.join(__dirname, 'img')));

// 互換: 旧直下の静的も残す（必要最小限）
app.use(express.static(__dirname)); // ただし "/" では新UIの index を返すようにする

// LINE SDK クライアント
const lineClient = new line.Client({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: LINE_CHANNEL_SECRET || '',
});

// 共有ストア（アンケート→ログイン完了までの一時保管）
app.locals.pendingEstimates = new Map();
app.locals.lineClient = lineClient;

// 健康チェック
app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

// ルーティング
import estimateRouter from './routes/estimate.js';
import lineLoginRouter from './routes/lineLogin.js';
import webhookRouter from './routes/webhook.js';

app.use('/', estimateRouter);
app.use('/', lineLoginRouter);
app.use('/', webhookRouter);

// ルートは必ず「新UI」を返す（古い index.html は使わない）
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('[INFO] サーバー起動');
  console.log('[INFO] ポート:', PORT);
  console.log('[INFO] 環境:', NODE_ENV);
  console.log('[INFO] Health:', `http://localhost:${PORT}/healthz`);
});
