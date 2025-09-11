// routes/lineLogin.js
import { Router } from 'express';
import * as line from '@line/bot-sdk'; // ESM では * as
const router = Router();

const {
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  LINE_LOGIN_CHANNEL_ID,
  LINE_LOGIN_CHANNEL_SECRET,
  LINE_LOGIN_REDIRECT_URI,
  LIFF_URL_DETAIL,        // 例: https://liff.line.me/2007914959-9-XP5Rpoay
  LINE_BOT_BASIC_ID,      // 例: @004szogc（任意・未設定なら後述のフォールバック）
} = process.env;

// Messaging API クライアント（ここでも生成してOK）
const client = new line.Client({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
});

/**
 * LINEログインのコールバック
 * 認可コードをトークンに交換 → id_token 検証 → sub（=userId）で push
 * 最後にトークを開く（Basic ID がある場合）/ さもなくば「送信しました」ページ。
 */
router.get('/auth/line/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query ?? {};
  if (error) {
    console.error('[LINE LOGIN] error', error, error_description);
    return res.status(400).send('Login canceled.');
  }

  try {
    // state に紐づくアンケート回答を取得
    const bucket = req.app.locals?.pendingEstimates;
    const pending = bucket?.get(state);
    if (!pending) return res.status(400).send('Session expired. Please try again.');

    // 認可コード → アクセストークン / id_token
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LINE_LOGIN_REDIRECT_URI,
        client_id: LINE_LOGIN_CHANNEL_ID,
        client_secret: LINE_LOGIN_CHANNEL_SECRET
      })
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('[LINE LOGIN] token error', tokenJson);
      return res.status(400).send('Login token error.');
    }

    // id_token 検証 → sub = userId
    const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: tokenJson.id_token,
        client_id: LINE_LOGIN_CHANNEL_ID
      })
    });
    const idInfo = await verifyRes.json();
    if (!verifyRes.ok) {
      console.error('[LINE LOGIN] verify error', idInfo);
      return res.status(400).send('Login verify error.');
    }
    const userId = idInfo.sub;

    // 概算メッセージの作成（必要に応じて整形）
    const { answers } = pending;
    const summary = [
      '【概算見積りの受付】',
      `・希望: ${answers?.kind ?? '-'}`,
      `・築年数: ${answers?.age ?? '-'}`,
      `・階数: ${answers?.floors ?? '-'}`,
      `・外壁材: ${answers?.material ?? '-'}`,
    ].join('\n');

    // 1) 受付メッセージ
    await client.pushMessage(userId, { type: 'text', text: summary })
      .catch(err => console.error('[PUSH 1] failed', err?.response?.data ?? err));

    // 2) 詳細見積もり LIFF ボタン（設定されていれば）
    if (LIFF_URL_DETAIL) {
      await client.pushMessage(userId, {
        type: 'template',
        altText: '詳細見積もりの入力はこちら',
        template: {
          type: 'buttons',
          text: 'より詳しい見積もりをご希望の方は、こちらから詳細情報をご入力ください。',
          actions: [{ type: 'uri', label: '詳細見積もりを入力', uri: LIFF_URL_DETAIL }]
        }
      }).catch(err => console.error('[PUSH 2] failed', err?.response?.data ?? err));
    }

    // 一度使った state は破棄
    bucket.delete(state);

    // ユーザーを LINE のトークへ（Basic ID がある場合）
    if (LINE_BOT_BASIC_ID && LINE_BOT_BASIC_ID.trim()) {
      const url = `https://line.me/R/ti/p/${LINE_BOT_BASIC_ID.replace(/^@/, '')}`;
      return res.redirect(url);
    }

    // Basic ID が未設定のときは簡易ページ
    return res.send(`
<!doctype html>
<meta charset="utf-8">
<title>送信しました</title>
<body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding:24px">
  <h2>送信しました。LINEをご確認ください。</h2>
  <p>トークが自動で開かない場合は、LINEアプリから本アカウントのトークをご覧ください。</p>
</body>
    `);
  } catch (e) {
    console.error('[GET /auth/line/callback] error', e);
    return res.status(500).send('Internal error.');
  }
});

export default router;
