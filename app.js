
import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
app.use(morgan('dev'));
app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'public')));

import webhook from './webhook.js';
import lineLogin from './lineLogin.js';
import estimate from './estimate.js';
import details from './details.js';

app.use('/line', webhook);
app.use('/auth/line', lineLogin);
app.use('/api/estimate', estimate);
app.use('/api/details', details);

app.get('/healthz', (req, res) => res.status(200).send('ok'));
app.get('/', (req, res) => res.send(`LINE Paint up. <a href="${process.env.LINE_ADD_FRIEND_URL||'#'}">友だち追加</a>`));
