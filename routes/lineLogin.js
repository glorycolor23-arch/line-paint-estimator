// routes/lineLogin.js
// 目的: LINEログインのコールバックで userId を取得し、必ず LIFF への誘導メッセージ（ボタン+テキスト）を push する。
// フロントは一切変更しない。ログを詳細に出力してトラブルシュートを容易にする。

import express from 'express';
import { Client } from '@line/bot-sdk';

const router = express.Router();

// ==== 環境変数の取得（複数名称をフォールバック） ====
const env = (k, d = '') => (process.env[k] ?? d).toString().trim();

const CHANNEL_ACCESS_TOKEN =
  env('LINE_CHANNEL_ACCESS_TOKEN') || env('CHANNEL_ACCESS_TOKEN');

const LOGIN_CHANNEL_ID = env('LINE_LOGIN_CHANNEL_ID');
const LOGIN_CHANNEL_SECRET = env('LINE_LOGIN_CHANNEL_SECRET');
const LOGIN_REDIRECT_URI = env('LINE_LOGIN_REDIRECT_URI', 'https://line-paint.onrender.com/line/callback');

// LIFF URL の解決（URL優先 → IDから生成 → /liff.html フォールバック）
function resolveLiffUrl() {
  const urlFromEnv = env('DETAILS_LIFF_URL') || env('LIFF_URL_DETAIL');
  if (urlFromEnv && /^https:\/\/liff\.line\.me\//.test(urlFromEnv)) return urlFromEnv;

  const id = env('LIFF_ID_DETAIL') || env('LIFF_ID');
  if (id && /^[A-Za-z0-9_\-]+$/.test(id)) return `https://liff.line.me/${id}`;

  const base = env('PUBLIC_BASE_URL', 'https://line-paint.onrender.com').replace(/\/+$/, '');
  return `${base}/liff.html`;
}
const LIFF_URL = resolveLiffUrl();

// Messaging API クライアント
let lineClient = null;
if (!CHANNEL_ACCESS_TOKEN) {
  console.error('[FATAL] CHANNEL_ACCESS_TOKEN が未設定です。push は失敗します。');
} else {
  lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });
  console.log('[INIT] LINE client ready. LIFF_URL:', LIFF_URL);
}

// 共通ハンドラ（どの callback パスでも同処理）
async function handleCallback(req, res) {
  try {
    const { code, state, error, error_description } = req.query ?? {};
    console.log('[CALLBACK] hit', { path: req.path, hasCode: !!code, hasState: !!state });

    if (error) {
      console.error('[CALLBACK] login error', { error, error_description });
      return res.status(400).send('Login canceled.');
    }
    if (!code) return res.status(400).send('Missing code');

    // 1) 認可コード → アクセストークン（ログインチャネル）
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
      console.error('[CALLBACK] token error', tokenJson);
      return res.status(400).send('Login token error.');
    }
    console.log('[CALLBACK] token ok');

    // 2) プロフィール取得（userId）
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const profile = await profRes.json();
    if (!profRes.ok || !profile?.userId) {
      console.error('[CALLBACK] profile error', profile);
      return res.status(400).send('Login profile error.');
    }
    const userId = profile.userId;
    console.log('[CALLBACK] profile ok', { userId });

    // 3) LIFF への誘導を push（テンプレ + テキストの二重化）
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
          actions: [{ type: 'uri', label: '詳細見積もりを入力', uri: LIFF_URL }],
        },
      },
      { type: 'text', text: `詳細見積もりの入力はこちら：\n${LIFF_URL}` },
    ];

    if (!lineClient) {
      console.error('[PUSH] skipped: LINE client not initialized (no token).');
    } else {
      try {
        await lineClient.pushMessage(userId, msgs);
        console.log('[PUSH] ok -> userId', userId);
      } catch (e) {
        const d = e?.originalError?.response?.data || e?.response?.data || e;
        console.error('[PUSH] error', d);
      }
    }

    // 4) 完了画面へ（フロントは既存のまま）
    return res.redirect('/after-login.html?ok=1');
  } catch (e) {
    console.error('[CALLBACK] exception', e);
    return res.status(500).send('Callback error');
  }
}

// できるだけ多くのパスで拾う（マウント位置に依存させない）
['/line/callback', '/auth/line/callback', '/line/login/callback', '/callback', '/login/callback']
  .forEach(p => router.get(p, handleCallback));

export default router;
