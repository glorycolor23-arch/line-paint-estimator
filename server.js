/**
 * line-paint-estimator server
 * 完全置き換え版
 *
 * 必要な環境変数（Render → Environment に設定）
 *  - PORT                                 （Render が自動注入）
 *  - NODE_ENV                             （任意）
 *  - FRIEND_ADD_URL                       例: https://lin.ee/XxmuVXt （※あなたのURL）
 *  - LINE_CHANNEL_ACCESS_TOKEN            （Messaging API アクセストークン）
 *  - LINE_CHANNEL_SECRET                  （Messaging API チャネルシークレット）
 *  - LINE_LOGIN_CHANNEL_ID                （LINEログイン チャネルID）
 *  - LINE_LOGIN_CHANNEL_SECRET            （LINEログイン チャネルシークレット）
 *  - LINE_LOGIN_REDIRECT_URI              例: https://line-paint.onrender.com/auth/line/callback
 *  - LINE_BOT_BASIC_ID                    例: @004szogc   ※無くても自動取得を試みます
 *  - LIFF_ID                              詳細見積もり LIFF（任意）
 *
 *  フォルダ:
 *   public/
 *     ├─ index.html  … 最初のアンケート
 *     ├─ liff.html   … 詳細見積もり LIFF
 *     ├─ after-login.html … ログイン完了後に自動でトークを開く
 *     └─ img/materials/*.jpg … 外壁材カード画像（任意）
 */
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import * as line from '@line/bot-sdk';

// ======================= 基本設定 =======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));

// CORS（必要なら緩める）
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// 静的配信
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true, maxAge: '1h', extensions: ['html']
}));

// 環境変数
const ENV = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'production',
  FRIEND_ADD_URL: process.env.FRIEND_ADD_URL || 'https://lin.ee/XxmuVXt', // ★あなたのURLを既定値に
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET || '',
  LINE_LOGIN_CHANNEL_ID: process.env.LINE_LOGIN_CHANNEL_ID || '',
  LINE_LOGIN_CHANNEL_SECRET: process.env.LINE_LOGIN_CHANNEL_SECRET || '',
  LINE_LOGIN_REDIRECT_URI: process.env.LINE_LOGIN_REDIRECT_URI || '',
  LINE_BOT_BASIC_ID: process.env.LINE_BOT_BASIC_ID || '', // '@xxxx' 形式を推奨
  LIFF_ID: process.env.LIFF_ID || '' // 任意
};

// ログ
const log = (...a) => console.log('[INFO]', ...a);
const warn = (...a) => console.warn('[WARN]', ...a);
const err = (...a) => console.error('[ERROR]', ...a);

// LINE SDK クライアント（Messaging API）
const lineConfig = {
  channelAccessToken: ENV.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: ENV.LINE_CHANNEL_SECRET
};
const lineClient = new line.Client(lineConfig);

// メモリ上の簡易ストア（本番は DB を推奨）
const leads = new Map(); // key: leadId -> {answers, estimate, createdAt}

// Bot Basic ID（@付き）を必要に応じて取得
let CACHED_BASIC_ID = ENV.LINE_BOT_BASIC_ID;
async function ensureBasicId() {
  if (CACHED_BASIC_ID && CACHED_BASIC_ID.startsWith('@')) return CACHED_BASIC_ID;
  try {
    const r = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${ENV.LINE_CHANNEL_ACCESS_TOKEN}` }
    });
    if (!r.ok) throw new Error(`bot/info ${r.status}`);
    const j = await r.json();
    if (j.basicId) {
      CACHED_BASIC_ID = '@' + j.basicId;
      return CACHED_BASIC_ID;
    }
  } catch (e) {
    warn('Basic ID 自動取得に失敗しました。環境変数 LINE_BOT_BASIC_ID を設定してください。', e.message);
  }
  return ENV.LINE_BOT_BASIC_ID; // そのまま返す（空でも可）
}

// ======================= ヘルスチェック =======================
app.get('/healthz', (_req, res) => res.status(200).type('text/plain').send('ok'));

// ======================= 概算ロジック（仮） =======================
/**
 * ★この計算式は「後で指示される最終版」に差し替えてください。
 *   差し替え場所はこの関数のみ。
 */
function calcEstimate({ desire, age, floors, material }) {
  let base = 300_000; // 30万円 基礎

  // 施工内容
  if (desire === '外壁') base += 300_000;
  else if (desire === '屋根') base += 200_000;
  else if (desire === '外壁と屋根') base += 480_000;

  // 築年数
  const ageMap = {
    '1〜5年': 0, '6〜10年': 80_000, '11〜15年': 120_000, '16〜20年': 180_000,
    '21〜25年': 220_000, '26〜30年': 260_000, '31年以上': 300_000
  };
  base += ageMap[age] ?? 120_000;

  // 階数
  const floorMap = { '1階建て': 0, '2階建て': 150_000, '3階建て以上': 300_000 };
  base += floorMap[floors] ?? 150_000;

  // 外壁材
  const matMap = {
    'サイディング': 100_000, 'モルタル': 120_000, 'ALC': 150_000,
    'ガルバリウム': 140_000, '木': 130_000, 'RC': 180_000, 'その他': 100_000, 'わからない': 80_000
  };
  base += matMap[material] ?? 100_000;

  // 端数整理
  const est = Math.round(base / 10000) * 10000; // 1万円単位
  return est < 100_000 ? 100_000 : est;
}

// ======================= API: 初回アンケート =======================
app.post('/api/estimate', async (req, res) => {
  try {
    const { desire, age, floors, material } = req.body || {};
    if (!desire || !age || !floors || !material) {
      return res.status(400).json({ ok: false, error: '入力が不足しています。' });
    }
    const estimate = calcEstimate({ desire, age, floors, material });
    const leadId = uuidv4();

    leads.set(leadId, {
      answers: { desire, age, floors, material },
      estimate,
      createdAt: Date.now()
    });

    // 次のアクション（ログイン開始 URL）
    const loginUrl = `/auth/line/start?lead=${encodeURIComponent(leadId)}`;

    log('LEAD CREATED', leadId, { desire, age, floors, material, estimate });
    res.json({ ok: true, leadId, estimate, loginUrl });
  } catch (e) {
    err('POST /api/estimate failed', e);
    res.status(500).json({ ok: false, error: 'サーバーエラーが発生しました。' });
  }
});

// ======================= LINEログイン開始 =======================
app.get('/auth/line/start', async (req, res) => {
  try {
    const { lead } = req.query;
    if (!lead || !leads.has(lead)) {
      return res.status(400).type('text/plain').send('Invalid lead');
    }

    const state = Buffer.from(JSON.stringify({ lead })).toString('base64url');

    const scope = ['openid', 'profile'].join(' ');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: ENV.LINE_LOGIN_CHANNEL_ID,
      redirect_uri: ENV.LINE_LOGIN_REDIRECT_URI,
      state,
      scope,
      bot_prompt: 'aggressive' // 可能なら友だち追加を促す
    });

    const authUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
    log('[LINE LOGIN AUTH URL]', authUrl);
    return res.redirect(authUrl);
  } catch (e) {
    err('GET /auth/line/start failed', e);
    res.status(500).type('text/plain').send('Login start error');
  }
});

// ======================= LINEログインコールバック =======================
app.get('/auth/line/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      warn('LINE Login error', error, error_description);
      return res.status(400).type('text/plain').send(`Login error: ${error}`);
    }

    let leadId = null;
    try {
      const st = JSON.parse(Buffer.from(String(state || ''), 'base64url').toString());
      leadId = st.lead;
    } catch {
      /* ignore */
    }
    if (!leadId || !leads.has(leadId)) {
      return res.status(400).type('text/plain').send('Invalid state/lead');
    }
    const lead = leads.get(leadId);

    // --- トークン交換 ---
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code || ''),
      redirect_uri: ENV.LINE_LOGIN_REDIRECT_URI,
      client_id: ENV.LINE_LOGIN_CHANNEL_ID,
      client_secret: ENV.LINE_LOGIN_CHANNEL_SECRET
    });
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(`token error ${tokenRes.status}: ${t}`);
    }
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // --- プロフィール取得 ---
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!profRes.ok) {
      const t = await profRes.text();
      throw new Error(`profile error ${profRes.status}: ${t}`);
    }
    const prof = await profRes.json(); // { userId, displayName, ... }
    const userId = prof.userId;

    // --- 概算を Push 送信 ---
    const liffUrl = ENV.LIFF_ID ? `https://liff.line.me/${ENV.LIFF_ID}` : null;

    const messages = [
      {
        type: 'text',
        text:
          'お見積もりのご依頼ありがとうございます。\n' +
          `ご希望の工事内容のお見積額は「${lead.estimate.toLocaleString()}円」です。\n\n` +
          '※本金額はアンケート回答を元にした概算です。'
      }
    ];

    if (liffUrl) {
      messages.push({
        type: 'text',
        text: `より詳しいお見積もりが必要な方は、こちらから詳細情報をご入力ください。\n${liffUrl}`
      });
    } else {
      messages.push({
        type: 'text',
        text: 'より詳しいお見積もりが必要な方は、詳細アンケート（LIFF）が有効になり次第、改めてご案内します。'
      });
    }

    await lineClient.pushMessage(userId, messages);
    log('PUSH sent to', userId, 'lead', leadId);

    // --- ここからトークを自動で開くため、after-login.html に遷移 ---
    const basicId = await ensureBasicId(); // 例: @004szogc
    const prefill = '見積結果を確認したいです';
    const afterUrl = `/after-login.html?oa=${encodeURIComponent(basicId)}&msg=${encodeURIComponent(prefill)}&add=${encodeURIComponent(ENV.FRIEND_ADD_URL)}`;

    return res.redirect(afterUrl);
  } catch (e) {
    err('GET /auth/line/callback failed', e);
    return res.status(500).type('text/plain').send('Callback error');
  }
});

// ======================= LINE Webhook（Messaging API） =======================
// 検証（X-Line-Signature）
function validateSignature(req) {
  try {
    const signature = req.get('X-Line-Signature') || '';
    const body = JSON.stringify(req.body);
    const hash = crypto
      .createHmac('sha256', ENV.LINE_CHANNEL_SECRET)
      .update(body).digest('base64');
    return signature === hash;
  } catch {
    return false;
  }
}

app.post('/line/webhook', async (req, res) => {
  try {
    // 署名が設定されている場合は検証（本番推奨）
    if (ENV.LINE_CHANNEL_SECRET && !validateSignature(req)) {
      warn('Invalid webhook signature');
      return res.status(403).end();
    }

    // ここではイベントは特に処理せず 200 即応
    // 必要であればメッセージ応答などを実装
    res.status(200).end();
  } catch (e) {
    err('POST /line/webhook failed', e);
    res.status(200).end(); // 失敗しても 200 返す（再送を防ぐ）
  }
});

// ======================= Fallback（フロントルーティング等） =======================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ======================= 起動 =======================
app.listen(ENV.PORT, async () => {
  const basicId = await ensureBasicId();
  log('サーバーが起動しました');
  log('ポート:', ENV.PORT);
  log('環境:', ENV.NODE_ENV);
  log('ヘルスチェック:', `http://localhost:${ENV.PORT}/healthz`);
  log('友だち追加URL:', ENV.FRIEND_ADD_URL);
  if (basicId) log('Bot Basic ID:', basicId);
});
