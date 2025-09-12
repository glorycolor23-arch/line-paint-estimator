// routes/lineLogin.js
// 目的：LINEログイン完了後に、必ず LIFF のリンク（ボタン＋テキスト）をプッシュ送信する。
// フロント（/public）は一切変更しません。

import express from 'express';
import { Client } from '@line/bot-sdk';

const router = express.Router();

/* =========================
   環境変数（Render → Environment）
   =========================
   必須：
   - LINE_CHANNEL_ACCESS_TOKEN（または CHANNEL_ACCESS_TOKEN） … Messaging API の長期トークン
   - LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET           … LINEログインのチャネル
   - LINE_LOGIN_REDIRECT_URI                                     … 例: https://line-paint.onrender.com/line/callback
   推奨：
   - DETAILS_LIFF_URL … https://liff.line.me/xxxxxxxx （LIFF の“URL”そのもの）
   代替（DETAILS_LIFF_URL が無い場合の保険）：
   - LIFF_URL_DETAIL / LIFF_ID_DETAIL / LIFF_ID / PUBLIC_BASE_URL
*/

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();

const CHANNEL_ACCESS_TOKEN =
  env('LINE_CHANNEL_ACCESS_TOKEN') || env('CHANNEL_ACCESS_TOKEN'); // どちらでも可

const LOGIN_CHANNEL_ID = env('LINE_LOGIN_CHANNEL_ID');
const LOGIN_CHANNEL_SECRET = env('LINE_LOGIN_CHANNEL_SECRET');
const LOGIN_REDIRECT_URI = env('LINE_LOGIN_REDIRECT_URI', 'https://line-paint.onrender.com/line/callback');

// LIFF URL の解決（URL優先 → IDから組み立て → 自サイト /liff.html へフォールバック）
function resolveLiffUrl() {
  const byUrl =
    env('DETAILS_LIFF_URL') ||
    env('LIFF_URL_DETAIL');

  if (byUrl && /^https:\/\/liff\.line\.me\//.test(byUrl)) return byUrl;

  const id = env('LIFF_ID_DETAIL') || env('LIFF_ID');
  if (id && /^[A-Za-z0-9_\-]+$/.test(id)) return `https://liff.line.me/${id}`;

  const base = env('PUBLIC_BASE_URL', 'https://line-paint.onrender.com').replace(/\/+$/, '');
  return `${base}/liff.html`; // 最低限のフォールバック（通常URL）
}

const LIFF_URL = resolveLiffUrl();

// Messaging API クライアント（push 用）
let lineClient = null;
if (!CHANNEL_ACCESS_TOKEN) {
  console.error('[FATAL] LINE_CHANNEL_ACCESS_TOKEN / CHANNEL_ACCESS_TOKEN が未設定です。push は失敗します。');
} else {
  lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });
}

// ===== 共通ハンドラ（どの callback パスでも同じ処理） =====
async function handleCallback(req, res) {
  try {
    const { code, error, error_description } = req.query ?? {};
    if (error) {
      console.error('[LINE LOGIN] error:', error, error_description);
      return res.status(400).send('Login canceled.');
    }
    if (!code) return res.status(400).send('Missing code');

    // 1) 認可コード → アクセストークン（LINEログインのチャネル）
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

    // 2) プロフィール取得（userId 取得）
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const profile = await profRes.json();
    if (!profRes.ok || !profile?.userId) {
      console.error('[LINE LOGIN] profile error:', profile);
      return res.status(400).send('Login profile error.');
    }
    const userId = profile.userId;

    // 3) LIFF への誘導をプッシュ送信（テンプレ＋テキストの二重化）
    const msgs = [
      {
        type: 'text',
        text: 'より詳しいお見積もりをご希望の方は、下のボタンから詳細情報をご入力ください。',
      },
      {
        type: 'template',
        altText: '詳細見積もりの入力',
        template: {
          type: 'buttons',
          text: '詳細見積もりの入力',
          actions: [
            { type: 'uri', label: '詳細見積もりを入力', uri: LIFF_URL },
          ],
        },
      },
      // 端末側でテンプレが出ないケースの保険
      { type: 'text', text: `詳細見積もりの入力はこちら：\n${LIFF_URL}` },
    ];

    if (!lineClient) {
      console.error('[PUSH skipped] Client not initialized (no access token).');
    } else {
      try {
        await lineClient.pushMessage(userId, msgs);
      } catch (e) {
        const d = e?.originalError?.response?.data || e?.response?.data || e;
        console.error('[PUSH error]', d);
        // 失敗時もUIを止めない
      }
    }

    // 4) 完了画面へ（フロントはそのまま）
    return res.redirect('/after-login.html?ok=1');
  } catch (e) {
    console.error('[LOGIN CALLBACK error]', e);
    return res.status(500).send('Callback error');
  }
}

// ===== できるだけ多くのパスで拾う（マウント位置に依存しない） =====
// 例：app.use(lineLoginRouter) でも app.use('/line/login', lineLoginRouter) でも拾えるようにする
const paths = [
  '/line/callback',
  '/auth/line/callback',
  '/line/login/callback',
  '/callback',
  '/login/callback',
];
paths.forEach(p => router.get(p, handleCallback));

export default router;
