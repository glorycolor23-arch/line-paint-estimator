import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// ルータを先に import（順序は import ではなく app.use の順が重要）
import webhook from './webhook.js';
import lineLogin from './lineLogin.js';
import estimate from './estimate.js';
import details from './details.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

// ここまでは軽量ミドルウェアのみ
app.use(morgan('dev'));
app.use(cors());

// ✅ LINE Webhook は bodyParser より前に通す（署名検証で“生ボディ”が必要）
app.use('/line', webhook);

// ここから汎用パーサ等
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// 静的ファイル（/public 配下：liff.html など）
app.use(express.static(path.join(__dirname, 'public')));

// 他のアプリ用ルート
app.use('/auth/line', lineLogin);   // LINEログイン callback
app.use('/api/estimate', estimate); // 概算保存
app.use('/api/details', details);   // 詳細 → メール & Sheets

// ヘルスチェック & ルート
app.get('/healthz', (req, res) => res.status(200).send('ok'));
app.get('/', (req, res) => {
  res.send(`LINE Paint up. <a href="${process.env.LINE_ADD_FRIEND_URL || '#'}">友だち追加</a>`);
});
