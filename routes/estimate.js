// routes/estimate.js
import express from 'express';
import { Client } from '@line/bot-sdk';
import { computeEstimate } from '../lib/estimate.js';
import { createLead, getLead, linkLineUser } from '../lib/store.js';
import {
  saveEstimateForLead,   // leadId -> { price, summaryText }
  getEstimateForLead,
} from '../store/linkStore.js';

const router = express.Router();

// ===== Env =====
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET       = process.env.LINE_CHANNEL_SECRET || '';
const LOGIN_CHANNEL_ID     = process.env.LINE_LOGIN_CHANNEL_ID || '';
const LOGIN_REDIRECT_URI   = process.env.LINE_LOGIN_REDIRECT_URI || '';
const LIFF_ID              = process.env.LIFF_ID || '';
const LIFF_URL_ENV         = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';
const ADD_FRIEND_URL       = process.env.LINE_ADD_FRIEND_URL || 'https://line.me';
const BASE_URL             = (process.env.BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/,'');

// LINE client（push 用）
const lineClient = new Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
});

// LIFF DeepLink
function liffDeepLink(leadId, extra = '') {
  const q = `leadId=${encodeURIComponent(leadId)}${extra ? `&${extra}` : ''}`;
  if (LIFF_ID)      return `https://liff.line.me/${LIFF_ID}?${q}`;
  if (LIFF_URL_ENV) return `${LIFF_URL_ENV}${LIFF_URL_ENV.includes('?') ? '&' : '?'}${q}`;
  if (BASE_URL)     return `${BASE_URL}/liff.html?${q}`;
  return `/liff.html?${q}`;
}

// LINE Login authorize URL（state=leadId を必ず付与）
function loginAuthorizeUrl(leadId) {
  const auth = new URL('https://access.line.me/oauth2/v2.1/authorize');
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('client_id', LOGIN_CHANNEL_ID);
  auth.searchParams.set('redirect_uri', LOGIN_REDIRECT_URI);
  auth.searchParams.set('state', leadId);                 // ★ leadId を state へ
  auth.searchParams.set('scope', 'openid profile');
  auth.searchParams.set('bot_prompt', 'normal');          // ★ 未友だちを友だち追加へ誘導
  return auth.toString();
}

// 回答 → サマリー文面の生成（トークに載せる）
function buildSummaryText(price, answers) {
  return (
    `【概算お見積もり】\n` +
    `金額：${Number(price).toLocaleString('ja-JP')} 円\n\n` +
    `— ご回答内容 —\n` +
    `・見積もり内容：${answers.desiredWork}\n` +
    `・築年数：${answers.ageRange}\n` +
    `・階数：${answers.floors}\n` +
    `・外壁材：${answers.wallMaterial}`
  );
}

// 内部ヘルパ：概算を計算・保存し、leadId を返す
function createAndSaveEstimate(answers) {
  const price = computeEstimate(answers);                          // 1) 概算
  const leadId = createLead(answers, price);                       // 2) lead 保存（lib/store）
  const summaryText = buildSummaryText(price, answers);            // 3) サマリー作成
  saveEstimateForLead(leadId, { price, summaryText });             //    linkStore に保存（follow/login 用）
  return { leadId, price, summaryText };
}

// ===== A. 既存 UX：/estimate → redirectUrl だけ返す（でも保存は必ずやる） =====
router.post('/estimate', (req, res) => {
  try {
    const body = req.body || {};
    const answers =
      (body.answers && typeof body.answers === 'object') ? body.answers : body;

    const required = ['desiredWork','ageRange','floors','wallMaterial'];
    for (const k of required) {
      if (!answers?.[k]) return res.status(400).json({ error: `Missing ${k}` });
    }

    const { leadId, price } = createAndSaveEstimate(answers);
    const redirectUrl = loginAuthorizeUrl(leadId);

    return res.json({
      ok: true,
      redirectUrl,                 // ← 1・2 の挙動を維持（LINE Loginへ）
      // 参考情報
      leadId,
      amount: price,
      addFriendUrl: ADD_FRIEND_URL,
      liffDeepLink: liffDeepLink(leadId),
    });
  } catch (e) {
    console.error('[POST /estimate] error', e);
    return res.json({ ok: true, redirectUrl: ADD_FRIEND_URL }); // フェイルセーフ
  }
});

// ===== B. /api/estimate（JSON返却版：既存フォールバック） =====
router.post('/api/estimate', (req, res) => {
  try {
    const { desiredWork, ageRange, floors, wallMaterial } = req.body || {};
    if (!desiredWork || !ageRange || !floors || !wallMaterial) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    const answers = { desiredWork, ageRange, floors, wallMaterial };
    const { leadId, price } = createAndSaveEstimate(answers);

    return res.json({
      ok: true,
      leadId,
      amount: price,
      addFriendUrl: ADD_FRIEND_URL,
      liffDeepLink: liffDeepLink(leadId),
    });
  } catch (e) {
    console.error('[POST /api/estimate] error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// ===== C. LIFF 内：userId 紐付け → 概算サマリー＋ボタンをプッシュ =====
router.post('/api/link-line-user', async (req, res) => {
  try {
    const { leadId, lineUserId } = req.body || {};
    if (!leadId || !lineUserId) return res.status(400).json({ error: 'leadId/lineUserId required' });

    const lead = linkLineUser(leadId, lineUserId);
    if (!lead) return res.status(404).json({ error: 'lead not found' });

    // 概算サマリー（linkStore 優先、無ければ lead から生成）
    let est = await getEstimateForLead(leadId);
    if (!est?.summaryText) {
      const fallbackSummary = buildSummaryText(lead.amount, lead.answers);
      est = { price: lead.amount, summaryText: fallbackSummary };
      saveEstimateForLead(leadId, est);
    }

    const msg1 = { type: 'text', text: est.summaryText };
    const msg2 = {
      type: 'template',
      altText: '詳細見積もりのご案内',
      template: {
        type: 'buttons',
        title: 'より詳しいお見積もりをご希望の方はこちらから。',
        text: '現地調査なしで無料の詳細見積もりが可能です。',
        actions: [
          { type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: liffDeepLink(leadId, 'step=1') },
        ],
      },
    };

    try { await lineClient.pushMessage(lineUserId, [msg1, msg2]); }
    catch (e) { console.error('[push error] /api/link-line-user', e); }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/link-line-user] error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// 任意：lead の確認
router.get('/api/lead/:leadId', (req, res) => {
  const lead = getLead(req.params.leadId);
  if (!lead) return res.status(404).json({ error: 'lead not found' });
  res.json(lead);
});

export default router;
