// server.js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bodyParser from 'body-parser';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 静的ファイル（既存のUIをそのまま配信）
app.use(express.static(path.join(__dirname, 'public')));

// 健康チェック
app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

// === ここが重要：LINEログインのコールバッカルーターを必ず mount ===
import lineLoginRouter from './routes/lineLogin.js';
app.use(lineLoginRouter);

// ルート
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 起動ログに必要情報（値は出さず“有無”のみ）を出す
const showFlag = (name, v) => console.log(`[BOOT] ${name}:`, v ? 'set' : 'EMPTY');
showFlag('LINE_CHANNEL_ACCESS_TOKEN or CHANNEL_ACCESS_TOKEN', process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.CHANNEL_ACCESS_TOKEN);
showFlag('LINE_LOGIN_CHANNEL_ID', process.env.LINE_LOGIN_CHANNEL_ID);
showFlag('LINE_LOGIN_CHANNEL_SECRET', process.env.LINE_LOGIN_CHANNEL_SECRET);
showFlag('LINE_LOGIN_REDIRECT_URI', process.env.LINE_LOGIN_REDIRECT_URI);
showFlag('DETAILS_LIFF_URL / LIFF_URL_DETAIL / LIFF_ID(_DETAIL) / PUBLIC_BASE_URL', 
  process.env.DETAILS_LIFF_URL || process.env.LIFF_URL_DETAIL || process.env.LIFF_ID_DETAIL || process.env.LIFF_ID || process.env.PUBLIC_BASE_URL);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('[INFO] Server listening on', PORT);
});
