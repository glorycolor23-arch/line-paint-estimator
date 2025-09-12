// LINE ミドルウェアで署名検証済み、events は req.body.events に入ってくる前提
import express from 'express';
import {
  DETAILS_LIFF_URL,
} from './config.js';

export default function webhookRouterFactory(lineClient) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const results = await Promise.all(events.map(handleEvent));
    res.json(results);
  });

  async function handleEvent(event) {
    // フォロー / メッセージのときだけ応答（必要に合わせ調整）
    if (event.type !== 'follow' && event.type !== 'message') return null;

    const userId = event.source?.userId;
    if (!userId) return null;

    // 既に概算送信済みのフローは別の箇所（アンケート完了時 push）で実装済みの想定。
    // ここではフォロー等の初回導線として「詳細見積もり」の LIFF URL を送る例を残す。
    if (DETAILS_LIFF_URL) {
      return lineClient.pushMessage(userId, {
        type: 'template',
        altText: '詳細見積もり入力',
        template: {
          type: 'buttons',
          title: 'より詳しい見積もりをご希望ですか？',
          text: 'ボタンから続きの入力に進めます。',
          actions: [
            { type: 'uri', label: '詳細見積もりを入力', uri: DETAILS_LIFF_URL },
          ],
        },
      });
    } else {
      return lineClient.pushMessage(userId, {
        type: 'text',
        text: '詳細見積もりの入力リンクが未設定です。管理者にご連絡ください。（DETAILS_LIFF_URL）',
      });
    }
  }

  return router;
}
