import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bodyParser from 'body-parser';
import cors from 'cors';
import {
  PORT,
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
} from './config.js';

import { Client, middleware as lineMiddleware } from '@line/bot-sdk';
import webhookRouterFactory from './webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 基本ミドルウェア
app.use(cors());
app.use(bodyParser.json());

// 静的ファイル
app.use(express.static(path.join(__dirname, 'public')));

// ヘルスチェック
app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

// ---- LINE SDK 準備 ----
const lineConfig = {
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  // channelSecret は無くても SDK は動作するが、あれば署名検証が有効になる
  channelSecret: LINE_CHANNEL_SECRET || undefined,
};

// 起動前チェック（原因の切り分けが即できるように明示）
if (!lineConfig.channelAccessToken) {
  console.error(
    '[FATAL] LINE channel access token が空です。\n' +
      'Render の環境変数に ' +
      'LINE_CHANNEL_ACCESS_TOKEN もしくは CHANNEL_ACCESS_TOKEN を設定してください。'
  );
  process.exit(1);
}

const lineClient = new Client(lineConfig);

// Webhook（LINE 署名検証付き）
app.use('/line/webhook', lineMiddleware(lineConfig), webhookRouterFactory(lineClient));

// ルート
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 起動
app.listen(PORT, () => {
  console.log(`[INFO] Server started on port ${PORT}`);
});
