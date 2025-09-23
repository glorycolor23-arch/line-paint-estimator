// routes/webhook.js
import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';
import { findLeadIdByUserId, getEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

// --- 必要な環境変数 ---
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';

if (!CHANNEL_ACCESS_TOKEN) {
  console.warn('[WARN] LINE_CHANNEL_ACCESS_TOKEN is empty – cannot push messages.');
}
if (!CHANNEL_SECRET) {
  console.warn('[WARN] LINE_CHANNEL_SECRET is empty – signature verify will fail.');
}

// LINE クライアント
const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

// 署名検証ミドルウェア
const mw = lineMiddleware({ channelSecret: CHANNEL_SECRET });

// 手動確認用（GETで200を返す）
router.get('/webhook', (_req, res) => res.status(200).type('text').send('ok'));

// 本番：LINE からの Webhook（最終URLは /line/webhook）
router.post('/webhook', mw, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (events.length === 0) {
      // Console の「検証」は events:[] を投げるので 200 で返す
      return res.sendStatus(200);
    }
    await Promise.all(events.map((ev) => handleEvent(ev)));
    res.sendStatus(200);
  } catch (e) {
    // ここに来るのは主に署名NG時。500を返すと検証が失敗になるので 200 で吸収
    console.error('[WEBHOOK ERROR]', e);
    res.sendStatus(200);
  }
});

async function handleEvent(event) {
  const type = event?.type;
  const userId = event?.source?.userId;
  if (!userId) return;

  if (type === 'follow') {
    try {
      // 1) 事前ログインで紐付いていれば leadId を取得
      const leadId = await findLeadIdByUserId(userId);

      // 2) 概算を取得（保存済みの回答→概算）
      let estimate = null;
      if (leadId) {
        estimate = await getEstimateForLead(leadId); // { price, summaryText } 想定
      }

      const liffUrl = process.env.LIFF_ID
        ? `https://liff.line.me/${process.env.LIFF_ID}${leadId ? `?lead=${encodeURIComponent(leadId)}` : ''}`
        : (process.env.LIFF_URL || '');

      if (estimate && typeof estimate.price === 'number') {
        const priceFmt = estimate.price.toLocaleString('ja-JP');
        const msgs = [
          {
            type: 'text',
            text:
              'お見積もりのご依頼ありがとうございます。\n' +
              `概算お見積額は ${priceFmt} 円 です。\n` +
              '※ご回答内容をもとに算出した概算です。',
          },
          {
            type: 'text',
            text: 'より詳しいお見積もりをご希望の方はこちらからお進みください。',
            quickReply: liffUrl
              ? { items: [{ type: 'action', action: { type: 'uri', label: '詳しい見積もりを依頼する', uri: liffUrl } }] }
              : undefined,
          },
        ];
        await lineClient.pushMessage(userId, msgs);
      } else {
        // まだ leadId が無い/概算未保存でも、LIFF だけは案内
        const msg = {
          type: 'text',
          text:
            '友だち追加ありがとうございます。\n' +
            'お見積もりの続きはこちらから開いてください。',
          quickReply: liffUrl
            ? { items: [{ type: 'action', action: { type: 'uri', label: '見積もりを続ける', uri: liffUrl } }] }
            : undefined,
        };
        await lineClient.pushMessage(userId, msg);
      }
    } catch (e) {
      console.error('[FOLLOW ERROR]', e);
    }
  }
}

export default router;
