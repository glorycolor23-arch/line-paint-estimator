// routes/lineLogin.js
import express from 'express';
import { Client } from '@line/bot-sdk';

const router = express.Router();

/**
 * ==== 環境変数 ====
 * Render の Environment に以下を設定してください。
 * - LINE_CHANNEL_ACCESS_TOKEN（または CHANNEL_ACCESS_TOKEN のどちらか）
 * - LINE_LOGIN_CHANNEL_ID
 * - LINE_LOGIN_CHANNEL_SECRET
 * - LINE_LOGIN_REDIRECT_URI（例: https://line-paint.onrender.com/line/callback）
 * - DETAILS_LIFF_URL（例: https://liff.line.me/xxxxxxxxxxxxxxxx）
 */
const CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN ||
  process.env.CHANNEL_ACCESS_TOKEN ||
  '';

const LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || '';
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || '';
const LOGIN_REDIRECT_URI =
  process.env.LINE_LOGIN_REDIRECT_URI ||
  'https://line-paint.onrender.com/line/callback';

const DETAILS_LIFF_URL = (process.env.DETAILS_LIFF_URL || '').trim();

// Messaging API クライアント（push 送信用）
const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

// ------ 共通ハンドラ（どのコールバックパスでも同じ処理） ------
async function handleCallback(req, res) {
  try {
    const { code, error, error_description } = req.query ?? {};
    if (error) {
      console.error('[LINE LOGIN] error:', error, error_description);
      return res.status(400).send('Login canceled.');
    }
    if (!code) return res.status(400).send('Missing code');

    // 1) 認可コード → アクセストークン（LINEログインチャネルで交換）
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LOGIN_REDIRECT_URI,
        client_id: LOGIN_CHANNEL_ID,
        client_secret: LOGIN_CHANNEL_SECRET,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('[LINE LOGIN] token error:', tokenJson);
      return res.status(400).send('Login token error.');
    }

    // 2) プロフィール取得（userId）
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const profile = await profRes.json();
    if (!profRes.ok || !profile?.userId) {
      console.error('[LINE LOGIN] profile error:', profile);
      return res.status(400).send('Login profile error.');
    }
    const userId = profile.userId;

    // 3) 概算送信後に、必ず LIFF への誘導を push
    let messages = [];
    if (DETAILS_LIFF_URL) {
      messages = [
        {
          type: 'text',
          text:
            'より詳しいお見積もりをご希望の方は、下のボタンから詳細情報をご入力ください。',
        },
        {
          type: 'template',
          altText: '詳細見積もりの入力',
          template: {
            type: 'buttons',
            text: '詳細見積もりの入力',
            actions: [
              { type: 'uri', label: '詳細見積もりを入力', uri: DETAILS_LIFF_URL },
            ],
          },
        },
        // 端末の事情でテンプレが表示されない場合の保険でテキストURLも併送
        { type: 'text', text: `詳細見積もりの入力はこちら：\n${DETAILS_LIFF_URL}` },
      ];
    } else {
      messages = [
        {
          type: 'text',
          text:
            '詳細見積もりの入力リンクが未設定です。管理者にご連絡ください。（DETAILS_LIFF_URL）',
        },
      ];
    }

    try {
      await lineClient.pushMessage(userId, messages);
    } catch (e) {
      console.error('[PUSH error]', e?.response?.data || e);
    }

    // 4) 完了画面へ（フロントは変更しない）
    res.redirect('/after-login.html?ok=1');
  } catch (e) {
    console.error('[LOGIN CALLBACK error]', e);
    res.status(500).send('Callback error');
  }
}

// ------ マルチパス対応（既存のどのコールバックURLでも拾えるように） ------
router.get('/line/callback', handleCallback);
router.get('/auth/line/callback', handleCallback);
router.get('/line/login/callback', handleCallback);

export default router;
