// routes/webhook.js
import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';
import {
  findLeadIdByUserId,
  getEstimateForLead,
} from '../store/linkStore.js';

const router = express.Router();

// LINE SDK クライアント
const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

// 署名検証ミドルウェア（※ server.js 側で bodyParser より前にマウント）
const mw = lineMiddleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
});

// 受信エンドポイント（推奨: /line/webhook／互換: /webhook）
router.post(['/line/webhook', '/webhook'], mw, async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (events.length === 0) return res.sendStatus(200);
    await Promise.all(events.map(handleEvent));
    res.sendStatus(200);
  } catch (e) {
    console.error('[WEBHOOK ERROR]', e);
    // 200 を返す（LINE への応答は常に 200 に）
    res.sendStatus(200);
  }
});

/** イベント単位のハンドラ */
async function handleEvent(event) {
  const type = event?.type;
  const userId = event?.source?.userId;
  if (!userId) return;

  // 友だち追加時の自動応答フロー
  if (type === 'follow') {
    try {
      // 事前のログイン連携があれば leadId を取得
      const leadId = await findLeadIdByUserId(userId);

      // LIFF URL（LIFF_ID 優先。なければ LIFF_URL 環境変数）
      const baseLiffUrl = process.env.LIFF_ID
        ? `https://liff.line.me/${process.env.LIFF_ID}`
        : (process.env.LIFF_URL || '');

      // leadId が未連携の場合：まず LIFF で連携を促す
      if (!leadId) {
        if (!baseLiffUrl) {
          // LIFF 未設定時はテキストだけ
          await lineClient.pushMessage(userId, {
            type: 'text',
            text:
              '友だち追加ありがとうございます。\n' +
              '詳細見積もりの入力リンクが未設定です。管理者にご連絡ください。',
          });
          return;
        }

        await lineClient.pushMessage(userId, buildLiffButtonMessage(baseLiffUrl));
        return;
      }

      // leadId がある場合：概算の取得（保存済みの回答に基づく）
      const estimate = await getEstimateForLead(leadId); // { price, summaryText } を想定

      // 概算がある → 金額テキスト + LIFFボタンを送信
      if (estimate) {
        const priceFmt =
          estimate.price != null ? estimate.price.toLocaleString('ja-JP') : '—';

        const msgs = [
          {
            type: 'text',
            text:
              'お見積もりのご依頼ありがとうございます。\n' +
              `概算お見積額は ${priceFmt} 円 です。\n` +
              '※ご回答内容をもとに算出した概算です。',
          },
          buildLiffButtonMessage(
            leadAwareLiffUrl(baseLiffUrl, leadId) // leadId をクエリで付与
          ),
        ];

        await lineClient.pushMessage(userId, msgs);
        return;
      }

      // 概算がまだ無い → まず LIFF で詳細入力へ
      if (!baseLiffUrl) {
        await lineClient.pushMessage(userId, {
          type: 'text',
          text:
            '友だち追加ありがとうございます。\n' +
            '詳細見積もりの入力リンクが未設定です。管理者にご連絡ください。',
        });
        return;
      }

      await lineClient.pushMessage(
        userId,
        buildLiffButtonMessage(leadAwareLiffUrl(baseLiffUrl, leadId))
      );
    } catch (e) {
      console.error('[FOLLOW ERROR]', e);
    }
  }

  // ここで他イベント（message等）を使った追送も可能だが、既存フローを変えないため未実装のまま
}

/** ボタンテンプレ（仕様要望に合わせた見た目） */
function buildLiffButtonMessage(liffUrl) {
  return {
    type: 'template',
    altText: '無料で詳細見積もりを依頼する',
    template: {
      type: 'buttons',
      text:
        'より詳しいお見積もりをご希望の方はこちらから。\n' +
        '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
      actions: [
        {
          type: 'uri',
          label: '無料で詳細見積もりを依頼する',
          uri: liffUrl,
        },
      ],
    },
  };
}

/** leadId をクエリに付与（LIFF 側で参照する場合） */
function leadAwareLiffUrl(base, leadId) {
  try {
    if (!base) return '';
    const u = new URL(base);
    if (leadId) u.searchParams.set('lead', leadId);
    return u.toString();
  } catch {
    return base;
  }
}

export default router;
