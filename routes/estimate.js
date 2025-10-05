// routes/estimate.js
import { Router } from 'express';
import crypto from 'node:crypto';
import { Client } from '@line/bot-sdk';

import { computeEstimate } from '../lib/estimate.js';
import { createLead, getLead, linkLineUser } from '../lib/store.js';
import { saveEstimateForLead } from '../store/linkStore.js';

const router = Router();

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || ''
});

// CSRF/state 用ランダムキー（/estimate → LINE Login 誘導で使用）
function createState() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// 1) 既存フロントのフェイルセーフ入口：/estimate
router.post('/estimate', async (req, res) => {
  try {
    const body = req.body || {};
    const answers = (body.answers && typeof body.answers === 'object') ? body.answers : body;

    const required = ['desiredWork','ageRange','floors','wallMaterial'];
    const missing = required.filter(k => !answers[k]);

    const { LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_REDIRECT_URI } = process.env;

    if (!LINE_LOGIN_CHANNEL_ID || !LINE_LOGIN_REDIRECT_URI) {
      return res.json({ ok: true, redirectUrl: process.env.LINE_ADD_FRIEND_URL || 'https://lin.ee/XxmuVXt' });
    }

    // state を作り、サーバーに pending 保存（初期互換）
    const store = req.app.locals?.pendingEstimates || (req.app.locals.pendingEstimates = new Map());
    const state = createState();
    store.set(state, { answers, createdAt: Date.now() });

    const authorizeUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', LINE_LOGIN_CHANNEL_ID);
    authorizeUrl.searchParams.set('redirect_uri', LINE_LOGIN_REDIRECT_URI);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', 'openid profile');
    authorizeUrl.searchParams.set('bot_prompt', 'normal');

    return res.json({
      ok: true,
      redirectUrl: authorizeUrl.toString(),
      ...(missing.length ? { note: 'MISSING_FIELDS', missing } : {})
    });
  } catch (e) {
    console.error('[POST /estimate] error', e);
    return res.json({ ok: true, redirectUrl: process.env.LINE_ADD_FRIEND_URL || 'https://lin.ee/XxmuVXt' });
  }
});

// 2) 初回アンケート → 概算作成（/api/estimate）
//    ※ linkStore にも保存して follow で拾えるようにする
router.post('/api/estimate', (req, res) => {
  const { desiredWork, ageRange, floors, wallMaterial } = req.body || {};
  if (!desiredWork || !ageRange || !floors || !wallMaterial) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const answers = { desiredWork, ageRange, floors, wallMaterial };
  const amount = computeEstimate(answers);

  const leadId = createLead(answers, amount);

  // ★ follow 用に保存（webhook から getEstimateForLead で拾える）
  const summaryText =
    `見積もり内容：${answers.desiredWork}\n` +
    `築年数：${answers.ageRange}\n` +
    `階数：${answers.floors}\n` +
    `外壁材：${answers.wallMaterial}`;
  saveEstimateForLead(leadId, { price: amount, summaryText });

  const liffDeepLink = `${process.env.LIFF_URL || ''}?leadId=${encodeURIComponent(leadId)}`;

  return res.json({
    leadId,
    amount,
    addFriendUrl: process.env.LINE_ADD_FRIEND_URL || '',
    liffDeepLink
  });
});

// 3) LIFF 内で userId 紐付け → 概算プッシュ（詳細文面つき）
router.post('/api/link-line-user', async (req, res) => {
  const { leadId, lineUserId } = req.body || {};
  const lead = linkLineUser(leadId, lineUserId);
  if (!lead) return res.status(404).json({ error: 'lead not found' });

  const answers = lead.answers || {};
  const detailBtnUri = `${(process.env.LIFF_URL || '')}?leadId=${encodeURIComponent(leadId)}&step=1`;

  const price = lead.amount;
  const priceFmt = typeof price === 'number' ? price.toLocaleString() : '—';

  const detailText =
    `お見積もりのご依頼ありがとうございます。\n` +
    `概算お見積額は ${priceFmt} 円です。\n` +
    `\n` +
    `— ご回答内容 —\n` +
    `見積もり内容：${answers.desiredWork || '-'}\n` +
    `築年数：${answers.ageRange || '-'}\n` +
    `階数：${answers.floors || '-'}\n` +
    `外壁材：${answers.wallMaterial || '-'}`;

  try {
    await lineClient.pushMessage(lineUserId, [
      { type: 'text', text: detailText },
      {
        type: 'template',
        altText: '詳細見積もりのご案内',
        template: {
          type: 'buttons',
          title: 'より詳しいお見積もりをご希望の方はこちらから。',
          text: '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
          actions: [
            { type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: detailBtnUri }
          ]
        }
      }
    ]);
  } catch (e) {
    console.error('push error', e);
  }

  res.json({ ok: true });
});

export default router;
