/**
 * 完全置き換え版（Push失敗対策・Webhook返信方式）
 *
 * 必須環境変数（Render > Environment）
 *  - PORT
 *  - LINE_CHANNEL_ACCESS_TOKEN
 *  - LINE_CHANNEL_SECRET
 *  - LINE_LOGIN_CHANNEL_ID
 *  - LINE_LOGIN_CHANNEL_SECRET
 *  - LINE_LOGIN_REDIRECT_URI  例: https://line-paint.onrender.com/auth/line/callback
 * 任意
 *  - FRIEND_ADD_URL           例: https://lin.ee/XxmuVXt
 *  - LINE_BOT_BASIC_ID        例: @004szogc（無い場合は起動時に自動取得を試行）
 *  - LIFF_ID                  例: 2007914959-XXXXXXXX
 */
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import * as line from '@line/bot-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));

// 静的配信
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true, maxAge: '1h', extensions: ['html']
}));

const ENV = {
  PORT: process.env.PORT || 3000,
  FRIEND_ADD_URL: process.env.FRIEND_ADD_URL || 'https://lin.ee/XxmuVXt',
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET || '',
  LINE_LOGIN_CHANNEL_ID: process.env.LINE_LOGIN_CHANNEL_ID || '',
  LINE_LOGIN_CHANNEL_SECRET: process.env.LINE_LOGIN_CHANNEL_SECRET || '',
  LINE_LOGIN_REDIRECT_URI: process.env.LINE_LOGIN_REDIRECT_URI || '',
  LINE_BOT_BASIC_ID: process.env.LINE_BOT_BASIC_ID || '',
  LIFF_ID: process.env.LIFF_ID || ''
};

const log  = (...a)=>console.log('[INFO]', ...a);
const warn = (...a)=>console.warn('[WARN]', ...a);
const err  = (...a)=>console.error('[ERROR]', ...a);

// LINE Messaging API
const lineConfig = {
  channelAccessToken: ENV.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: ENV.LINE_CHANNEL_SECRET
};
const lineClient = new line.Client(lineConfig);

// メモリストア（本番はDBへ）
const leads = new Map(); // leadId -> {answers, estimate, createdAt}

let CACHED_BASIC_ID = ENV.LINE_BOT_BASIC_ID;
async function ensureBasicId() {
  if (CACHED_BASIC_ID && CACHED_BASIC_ID.startsWith('@')) return CACHED_BASIC_ID;
  try {
    const r = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${ENV.LINE_CHANNEL_ACCESS_TOKEN}` }
    });
    if (r.ok) {
      const j = await r.json();
      if (j.basicId) CACHED_BASIC_ID = '@' + j.basicId;
    }
  } catch(e) {
    warn('Basic ID 自動取得失敗:', e.message);
  }
  return CACHED_BASIC_ID;
}

app.get('/healthz', (_req,res)=>res.type('text/plain').send('ok'));

// ===== 概算式（後で差し替えOK） =====
function calcEstimate({ desire, age, floors, material }) {
  let base = 300000;
  if (desire === '外壁') base += 300000;
  else if (desire === '屋根') base += 200000;
  else if (desire === '外壁と屋根') base += 480000;

  const ages = {'1〜5年':0,'6〜10年':80000,'11〜15年':120000,'16〜20年':180000,
    '21〜25年':220000,'26〜30年':260000,'31年以上':300000};
  base += ages[age] ?? 120000;

  const floorsMap = {'1階建て':0,'2階建て':150000,'3階建て以上':300000};
  base += floorsMap[floors] ?? 150000;

  const mats = {'サイディング':100000,'モルタル':120000,'ALC':150000,'ガルバリウム':140000,
    '木':130000,'RC':180000,'その他':100000,'わからない':80000};
  base += mats[material] ?? 100000;

  const est = Math.round(base/10000)*10000;
  return Math.max(est, 100000);
}

// ===== アンケート受領 → lead発行 =====
app.post('/api/estimate', (req, res)=>{
  const { desire, age, floors, material } = req.body || {};
  if (!desire || !age || !floors || !material) {
    return res.status(400).json({ ok:false, error:'入力が不足しています' });
  }
  const estimate = calcEstimate({ desire, age, floors, material });
  const leadId = uuidv4();

  leads.set(leadId, {
    answers: { desire, age, floors, material },
    estimate,
    createdAt: Date.now()
  });

  const loginUrl = `/auth/line/start?lead=${encodeURIComponent(leadId)}`;
  log('LEAD', leadId, { desire, age, floors, material, estimate });
  res.json({ ok:true, leadId, estimate, loginUrl });
});

// ===== LINEログイン開始 =====
app.get('/auth/line/start', async (req, res)=>{
  const { lead } = req.query;
  if (!lead || !leads.has(lead)) return res.status(400).send('Invalid lead');

  const state = Buffer.from(JSON.stringify({ lead })).toString('base64url');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ENV.LINE_LOGIN_CHANNEL_ID,
    redirect_uri: ENV.LINE_LOGIN_REDIRECT_URI,
    scope: 'openid profile',
    state,
    bot_prompt: 'aggressive'
  });
  const url = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
  return res.redirect(url);
});

// ===== LINEログイン完了 → after-login へ遷移（Pushしない） =====
app.get('/auth/line/callback', async (req, res)=>{
  try {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send('Login error');

    let leadId = null;
    try {
      const obj = JSON.parse(Buffer.from(String(state||''), 'base64url').toString());
      leadId = obj.lead;
    } catch {}

    if (!leadId || !leads.has(leadId)) return res.status(400).send('Invalid state');

    // ログイン完了の妥当性チェック（トークン交換だけ実施）
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code||''),
      redirect_uri: ENV.LINE_LOGIN_REDIRECT_URI,
      client_id: ENV.LINE_LOGIN_CHANNEL_ID,
      client_secret: ENV.LINE_LOGIN_CHANNEL_SECRET
    });
    const tk = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body
    });
    if (!tk.ok) return res.status(400).send('Token error');

    // after-login でトーク自動起動（プレフィルに lead を入れる）
    const basicId = await ensureBasicId();
    const prefill = `#lead:${leadId} の見積もりをお願いします`;
    const afterUrl = `/after-login.html?oa=${encodeURIComponent(basicId)}&msg=${encodeURIComponent(prefill)}&add=${encodeURIComponent(ENV.FRIEND_ADD_URL)}`;
    return res.redirect(afterUrl);
  } catch(e) {
    err('callback failed', e);
    return res.status(500).send('Callback error');
  }
});

// ===== Webhook（#lead:XXXX を受け取ったら結果を返信） =====
function validSignature(req) {
  try {
    const sig = req.get('X-Line-Signature') || '';
    const body = JSON.stringify(req.body);
    const hash = crypto.createHmac('sha256', ENV.LINE_CHANNEL_SECRET).update(body).digest('base64');
    return sig === hash;
  } catch { return false; }
}

app.post('/line/webhook', async (req, res)=>{
  if (ENV.LINE_CHANNEL_SECRET && !validSignature(req)) {
    warn('Invalid signature'); return res.status(403).end();
  }

  const events = req.body?.events || [];
  for (const ev of events) {
    try {
      if (ev.type === 'follow') {
        // 友だち追加時の挨拶
        await lineClient.replyMessage(ev.replyToken, [{
          type:'text',
          text:'友だち追加ありがとうございます！\nアンケート送信後に開いたトークに、\n自動入力のメッセージ（#lead:…）をそのまま送信してください。\n概算見積を返信します。'
        }]);
      }
      if (ev.type === 'message' && ev.message.type === 'text') {
        const txt = ev.message.text || '';
        const m = txt.match(/#\s*lead\s*:\s*([0-9a-f-]{8,})/i);
        if (m) {
          const leadId = m[1];
          const lead = leads.get(leadId);
          if (lead) {
            const liffUrl = ENV.LIFF_ID ? `https://liff.line.me/${ENV.LIFF_ID}` : null;
            const msgs = [
              {
                type:'text',
                text:
                  'お見積もりのご依頼ありがとうございます。\n' +
                  `ご希望の工事内容のお見積額は「${lead.estimate.toLocaleString()}円」です。\n\n` +
                  '※こちらはアンケートを元にした概算です。'
              }
            ];
            if (liffUrl) {
              msgs.push({
                type: 'template',
                altText: '詳しい見積もりを依頼する',
                template: {
                  type: 'buttons',
                  text: 'より詳しいお見積もりが必要な方は、こちらから詳細情報をご入力ください。',
                  actions: [{ type:'uri', label:'詳しい見積もりを依頼する', uri: liffUrl }]
                }
              });
            }
            await lineClient.replyMessage(ev.replyToken, msgs);
          } else {
            await lineClient.replyMessage(ev.replyToken, [{ type:'text', text:'有効期限切れ、または無効なコードです。もう一度お試しください。'}]);
          }
        }
      }
    } catch(e) {
      err('webhook event error', e);
      // 返信失敗時も次のイベント処理へ
    }
  }
  res.status(200).end();
});

// ルート
app.get('/', (_req, res)=>res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(ENV.PORT, async ()=>{
  log('Server started', ENV.PORT);
  const bid = await ensureBasicId();
  if (bid) log('Bot Basic ID:', bid);
});
