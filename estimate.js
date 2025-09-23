import express from 'express';
import { Client } from '@line/bot-sdk';
import { CONFIG } from '../config.js';
import { computeEstimate } from '../lib/estimate.js';
import { createLead, getLead, linkLineUser } from '../lib/store.js';

const router = express.Router();
const lineClient = new Client({
  channelAccessToken: CONFIG.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: CONFIG.LINE_CHANNEL_SECRET
});

// 初期アンケート→概算見積
router.post('/api/estimate', (req, res) => {
  const { desiredWork, ageRange, floors, wallMaterial } = req.body || {};
  if (!desiredWork || !ageRange || !floors || !wallMaterial) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const answers = { desiredWork, ageRange, floors, wallMaterial };
  const amount = computeEstimate(answers);
  const leadId = createLead(answers, amount);

  // LIFFで受け取る（leadId付与）
  const liffDeepLink = `${CONFIG.LIFF_URL}?leadId=${encodeURIComponent(leadId)}`;

  return res.json({
    leadId,
    amount,
    addFriendUrl: CONFIG.LINE_ADD_FRIEND_URL,
    liffDeepLink
  });
});

// LIFF内で LINE userId を紐付け → プッシュで概算金額を送信
router.post('/api/link-line-user', async (req, res) => {
  const { leadId, lineUserId } = req.body || {};
  const lead = linkLineUser(leadId, lineUserId);
  if (!lead) return res.status(404).json({ error: 'lead not found' });

  const detailBtnUri = `${CONFIG.LIFF_URL}?leadId=${encodeURIComponent(leadId)}&step=1`;

  try {
    await lineClient.pushMessage(lineUserId, [
      {
        type: 'text',
        text: `お見積もりのご依頼ありがとうございます。
ご希望の工事内容のお見積額は ${lead.amount.toLocaleString()} 円です。`
      },
      {
        type: 'template',
        altText: '詳しいお見積りのご依頼',
        template: {
          type: 'buttons',
          title: '次のステップ',
          text: 'より詳しいお見積もりが必要な方は、下のボタンから詳細情報をご入力ください。',
          actions: [
            { type: 'uri', label: '詳しい見積もりを依頼する', uri: detailBtnUri }
          ]
        }
      }
    ]);
  } catch (e) {
    console.error('push error', e);
  }

  res.json({ ok: true });
});

// lead の確認（初期フォームの確認表示用）
router.get('/api/lead/:leadId', (req, res) => {
  const lead = getLead(req.params.leadId);
  if (!lead) return res.status(404).json({ error: 'lead not found' });
  res.json(lead);
});

export default router;