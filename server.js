// server.js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as line from '@line/bot-sdk'; // ← ESM では * as で取り込む

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  PORT = 10000,
  NODE_ENV = 'production',

  // Messaging API
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,

  // LINEログイン
  LINE_LOGIN_CHANNEL_ID,
  LINE_LOGIN_CHANNEL_SECRET,
  LINE_LOGIN_REDIRECT_URI,
} = process.env;

const app = express();
app.use(express.json());

// 静的ファイル（/public）
app.use(express.static(path.join(__dirname)));

// LINE Bot SDK クライアント（webhook等で使う想定。ここで作っておく）
const lineClient = new line.Client({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
});

// ルート間で共有する一時ストア（アンケート回答 → ログイン完了まで）
app.locals.pendingEstimates = new Map();
app.locals.lineClient = lineClient;

// 健康チェック
app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

// ルーティング
import estimateRouter from './routes/estimate.js';
import lineLoginRouter from './routes/lineLogin.js';
import webhookRouter from './routes/webhook.js'; // 既存のまま利用

app.use('/', estimateRouter);    // /estimate を提供
app.use('/', lineLoginRouter);   // /auth/line/callback を提供
app.use('/', webhookRouter);     // /line/webhook など既存のまま

// トップ（既存の index.html を配信）
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log('[INFO] サーバーが起動しました');
  console.log('[INFO] ポート:', PORT);
  console.log('[INFO] 環境:', NODE_ENV);
  console.log('[INFO] ヘルスチェック: http://localhost:' + PORT + '/healthz');
});
