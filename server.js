// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import bodyParser from 'body-parser';

// ルートのディレクトリ解決
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// -------------------------------
// 1) Webhook を最優先で登録
//    ※ ここでは body-parser をまだ使わない！
// -------------------------------
import webhookRoutes from './routes/webhook.js';
app.use(webhookRoutes);

// -------------------------------
// 2) それ以外のミドルウェア・ルートを後段に登録
// -------------------------------
app.use(cors());
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));

// 静的ファイル（/public）
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// ヘルスチェック
app.get(['/healthz', '/health'], (_req, res) => res.type('text').send('ok'));

// （必要なら他の API ルートをここで登録）
// import estimateRoutes from './routes/estimate.js';
// import detailsRoutes from './routes/details.js';
// app.use(estimateRoutes);
// app.use(detailsRoutes);

// 404
app.use((req, res, next) => {
  if (res.headersSent) return next();
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

// エラーハンドラ（ログだけ出して 200 を返したい場合は調整可）
app.use((err, _req, res, _next) => {
  console.error('[UNCAUGHT ERROR]', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 起動
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('[INFO] サーバーが起動しました');
  console.log('[INFO] ポート:', PORT);
  console.log('[INFO] 環境:', process.env.NODE_ENV || 'development');
  console.log('[INFO] ヘルスチェック: http://localhost:' + PORT + '/healthz');
});

export default app;
