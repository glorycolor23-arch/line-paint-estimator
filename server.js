import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';
import estimateRoutes from './routes/estimate.js';
import detailsRoutes from './routes/details.js';
import webhookRoutes from './routes/webhook.js';

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));

app.use(estimateRoutes);
app.use(detailsRoutes);
app.use(webhookRoutes);

app.get('/healthz', (_, res) => res.send('ok'));

app.listen(CONFIG.PORT, () => {
  console.log(`Server running on :${CONFIG.PORT}`);
});