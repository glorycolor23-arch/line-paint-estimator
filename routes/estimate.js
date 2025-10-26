// routes/estimate.js
import express from 'express';
import { Client } from '@line/bot-sdk';

import { computeEstimate } from '../lib/estimate.js';
import { createLead, getLead, linkLineUser } from '../lib/store.js';

// ★ webhook が参照するストア（概算の保存先はこちら！）
import { saveEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

const LINE_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LIFF_URL = process.env.LIFF_URL || '';
const LIFF_ID  = process.env.LIFF_ID  || '';

const lineClient = new Client({ channelAccessToken: LINE_ACCESS_TOKEN });

// 回答要約テキストを作る（LINEにそのまま流せる体裁）
function buildSummaryText(answers, amount) {
  const lines = [];
  if (answers?.desiredWork)  lines.push(`■見積もり希望内容：${answers.desiredWork}`);
  if (answers?.ageRange)     lines.push(`■築年数：${answers.ageRange}`);
  if (answers?.floors)       lines.push(`■階数：${answers.floors}`);
  if (answers?.wallMaterial) lines.push(`■外壁材：${answers.wallMaterial}`);
  const head = `お見積もりのご依頼ありがとうございます。\n概算お見積額は ${Number(amount).toLocaleString('ja-JP')} 円です。`;
  return head + (lines.length ? `\n\n【ご回答内容】\n${lines.join('\n')}` : '');
}

function liffLinkWithLead(leadId, extra = '') {
  if (LIFF_ID) return `https://liff.line.me/${LIFF_ID}?leadId=${encodeURIComponent(leadId)}${extra}`;
  if (LIFF_URL) return `${LIFF_URL}${LIFF_URL.includes('?') ? '&' : '?'}leadId=${encodeURIComponent(leadId)}${extra}`;
  return `/liff.html?leadId=${encodeURIComponent(leadId)}${extra}`;
}

// ------ 初回アンケート → 概算作成 & 保存 ------
router.post('/api/estimate', (req, res) => {
  const { desiredWork, ageRange, floors, wallMaterial } = req.body || {};
  if (!desiredWork || !ageRange || !floors || !wallMaterial) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const answers = { desiredWork, ageRange, floors, wallMaterial };
  const amount  = computeEstimate(answers);
  const leadId  = createLead(answers, amount);

  // ★ webhook/ログイン後のプッシュが参照できるように linkStore にも保存
  const summaryText = buildSummaryText(answers, amount);
  saveEstimateForLead(leadId, {
    price: amount,
    summaryText,
    answers
  });

  // LIFF deeplink（詳細依頼へ）
  const liffDeepLink = liffLinkWithLead(leadId, '');

  // 金額表示ページへリダイレクト
  const resultUrl = `/result.html?leadId=${encodeURIComponent(leadId)}&amount=${encodeURIComponent(amount)}`;
  return res.json({
    leadId,
    amount,
    redirectUrl: resultUrl,
    addFriendUrl: process.env.LINE_ADD_FRIEND_URL || '',
    liffDeepLink
  });
});

// ------ LIFF から：LINE userId を lead に紐付け → 概算をプッシュ ------
router.post('/api/link-line-user', async (req, res) => {
  const { leadId, lineUserId } = req.body || {};
  const lead = linkLineUser(leadId, lineUserId);
  if (!lead) return res.status(404).json({ error: 'lead not found' });

  const detailBtnUri = liffLinkWithLead(leadId, '&step=1');
  const text = buildSummaryText(lead.answers, lead.amount);

  try {
    const amountText = `概算見積もり金額\n¥${Number(lead.amount).toLocaleString('ja-JP')}\n\nより詳しいお見積もりをご希望の方はこちら\n現地調査での訪問は行わず、具体的なお見積もりを提示します。`;
    await lineClient.pushMessage(lineUserId, [
      { type: 'text', text: amountText },
      {
        type: 'template',
        altText: '詳細見積もりのご案内',
        template: {
          type: 'buttons',
          title: '詳細見積もりのご案内',
          text: '下記ボタンよりお進みください',
          actions: [
            { type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: detailBtnUri }
          ]
        }
      }
    ]);
  } catch (e) {
    console.error('[push error]', e);
  }

  res.json({ ok: true });
});

// lead 確認（デバッグ/表示用）
router.get('/api/lead/:leadId', (req, res) => {
  const lead = getLead(req.params.leadId);
  if (!lead) return res.status(404).json({ error: 'lead not found' });
  res.json(lead);
});

export default router;
