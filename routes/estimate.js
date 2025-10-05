// routes/estimate.js
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Client } from '@line/bot-sdk';
import { computeEstimate } from '../lib/estimate.js';
import {
  saveEstimateForLead,   // leadId -> { price, summaryText }
  getEstimateForLead,    // 既存の概算取得（必要なら）
  findLeadIdByUserId,    // userId -> leadId
} from '../store/linkStore.js';

const router = express.Router();

// ===== 環境変数 =====
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET       = process.env.LINE_CHANNEL_SECRET || '';
const LIFF_ID              = process.env.LIFF_ID || '';
const LIFF_URL_ENV         = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';
const ADD_FRIEND_URL       = process.env.LINE_ADD_FRIEND_URL || 'https://line.me';

// LINE client（push 用）
const lineClient = new Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
});

// LIFF のディープリンクを解決
function resolveLiffDeepLink(leadId, extra = '') {
  const q = `leadId=${encodeURIComponent(leadId)}${extra ? `&${extra}` : ''}`;
  if (LIFF_ID)     return `https://liff.line.me/${LIFF_ID}?${q}`;
  if (LIFF_URL_ENV) return `${LIFF_URL_ENV}${LIFF_URL_ENV.includes('?') ? '&' : '?'}${q}`;
  // フォールバック（自ホストの liff.html）
  const origin = process.env.BASE_URL || process.env.PUBLIC_BASE_URL || '';
  if (origin) return `${origin.replace(/\/+$/, '')}/liff.html?${q}`;
  return `/liff.html?${q}`;
}

// ===== 1) 初回アンケート → 概算作成・保存 → レスポンス返却 =====
router.post('/api/estimate', (req, res) => {
  try {
    const { desiredWork, ageRange, floors, wallMaterial } = req.body || {};
    if (!desiredWork || !ageRange || !floors || !wallMaterial) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // 概算計算
    const price = computeEstimate({ desiredWork, ageRange, floors, wallMaterial });

    // 表示用サマリー（トークに載せる）
    const summaryText =
      `【概算お見積もり】\n` +
      `金額：${Number(price).toLocaleString('ja-JP')} 円\n\n` +
      `— ご回答内容 —\n` +
      `・見積もり内容：${desiredWork}\n` +
      `・築年数：${ageRange}\n` +
      `・階数：${floors}\n` +
      `・外壁材：${wallMaterial}`;

    // leadId 発行 & 保存
    const leadId = uuidv4();
    saveEstimateForLead(leadId, { price, summaryText });

    // LIFF で引き継ぐための deep link
    const liffDeepLink = resolveLiffDeepLink(leadId);

    return res.json({
      ok: true,
      leadId,
      amount: price,
      addFriendUrl: ADD_FRIEND_URL,
      liffDeepLink,
    });
  } catch (e) {
    console.error('[POST /api/estimate] error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// ===== 2) LIFF 内で LINE userId を紐付け → 概算をプッシュ送信 =====
router.post('/api/link-line-user', async (req, res) => {
  try {
    const { leadId, lineUserId } = req.body || {};
    if (!leadId || !lineUserId) return res.status(400).json({ error: 'leadId/lineUserId required' });

    // 既存の概算を取得
    const est = await getEstimateForLead(leadId);
    if (!est) return res.status(404).json({ error: 'estimate not found' });

    // ボタン文言の指示に合わせて変更
    const detailBtnUri = resolveLiffDeepLink(leadId, 'step=1');
    const msg1 = { type: 'text', text: est.summaryText };
    const msg2 = {
      type: 'template',
      altText: '詳細見積もりのご案内',
      template: {
        type: 'buttons',
        title: 'より詳しいお見積もりをご希望の方はこちらから。',
        text: '現地調査なしで無料の詳細見積もりが可能です。',
        actions: [
          { type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: detailBtnUri },
        ],
      },
    };

    try {
      await lineClient.pushMessage(lineUserId, [msg1, msg2]);
    } catch (e) {
      console.error('[push error] /api/link-line-user', e);
      // push が失敗しても 200 を返す（LIFF 側 UX 優先）
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/link-line-user] error', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// ===== 3) （任意）lead の確認用 =====
router.get('/api/lead/:leadId', async (req, res) => {
  try {
    const est = await getEstimateForLead(req.params.leadId);
    if (!est) return res.status(404).json({ error: 'lead not found' });
    res.json(est);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'internal error' });
  }
});

export default router;
