// routes/lineLogin.js
import express from 'express';
import { Client } from '@line/bot-sdk';
import { saveLink, getEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

// --- 環境変数 ---
const LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || '';
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || '';
const LOGIN_REDIRECT_URI = process.env.LINE_LOGIN_REDIRECT_URI || '';

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LIFF_ID = process.env.LIFF_ID || '';
const LIFF_URL_ENV = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';
const ADD_FRIEND_URL = process.env.LINE_ADD_FRIEND_URL || ''; // ★必須（lin.ee でも可）

function resolveLiffUrl(lead) {
  if (LIFF_ID) {
    const base = `https://liff.line.me/${LIFF_ID}`;
    return lead ? `${base}?lead=${encodeURIComponent(lead)}` : base;
  }
  if (LIFF_URL_ENV) {
    return lead
      ? LIFF_URL_ENV + (LIFF_URL_ENV.includes('?') ? '&' : '?') + `lead=${encodeURIComponent(lead)}`
      : LIFF_URL_ENV;
  }
  return '/liff.html' + (lead ? `?lead=${encodeURIComponent(lead)}` : '');
}

const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

// -------------------------------------------------
// ログイン開始（未友だちに友だち追加ダイアログを出したいので bot_prompt=normal）
// -------------------------------------------------
const loginPaths = ['/auth/line/login', '/line/login', '/login'];
router.get(loginPaths, (req, res) => {
  const lead =
    (typeof req.query.lead === 'string' && req.query.lead) ||
    (typeof req.query.state === 'string' && req.query.state) ||
    '';

  const state = lead || Math.random().toString(36).slice(2);

  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', LOGIN_CHANNEL_ID);
  authUrl.searchParams.set('redirect_uri', LOGIN_REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'openid profile');
  authUrl.searchParams.set('bot_prompt', 'normal'); // ★未友だちに友だち追加案内
  return res.redirect(authUrl.toString());
});

// -------------------------------------------------
// コールバック
//   - userId と lead を紐付け
//   - 概算が存在すればプッシュで金額＋回答要約＋LIFFボタン
//   - 最後に /after-login.html?add=... へリダイレクト（★ここが今回の修正点）
// -------------------------------------------------
const callbackPaths = ['/auth/line/callback', '/line/callback', '/callback'];
router.get(callbackPaths, async (req, res) => {
  const afterQuery = ADD_FRIEND_URL ? `?add=${encodeURIComponent(ADD_FRIEND_URL)}` : '';
  try {
    const code = req.query.code;
    if (!code) return res.redirect('/after-login.html' + afterQuery);

    const lead =
      (typeof req.query.lead === 'string' && req.query.lead) ||
      (typeof req.query.state === 'string' && req.query.state) ||
      '';

    // token exchange
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LOGIN_REDIRECT_URI,
        client_id: LOGIN_CHANNEL_ID,
        client_secret: LOGIN_CHANNEL_SECRET,
      }),
    });
    if (!tokenRes.ok) {
      console.error('[LOGIN] token exchange failed', await tokenRes.text());
      return res.redirect('/after-login.html' + afterQuery);
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // profile
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profRes.ok) {
      console.error('[LOGIN] profile fetch failed', await profRes.text());
      return res.redirect('/after-login.html' + afterQuery);
    }
    const prof = await profRes.json();
    const userId = prof.userId;

    // 紐付け
    if (userId && lead) {
      await saveLink(userId, lead);

      // 概算が保存されていればプッシュ
      const estimate = await getEstimateForLead(lead); // { price, summaryText, answers }
      if (estimate) {
        const liffUrl = resolveLiffUrl(lead);

        const msg1 = { type: 'text', text: estimate.summaryText || `概算お見積り：${estimate.price?.toLocaleString('ja-JP') ?? '—'} 円` };
        const msg2 = {
          type: 'template',
          altText: '詳細見積もりのご案内',
          template: {
            type: 'buttons',
            title: 'より詳しいお見積もりをご希望の方はこちらから。',
            text: '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
            actions: [{ type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: liffUrl }],
          },
        };

        try { await lineClient.pushMessage(userId, [msg1, msg2]); }
        catch (e) { console.error('[LOGIN] push failed', e); }
      }
    }

    // 公式サイトではなく友だち追加/トークを開くために必ず add を渡す（★重要）
    return res.redirect('/after-login.html' + afterQuery);
  } catch (e) {
    console.error('[LOGIN CALLBACK ERROR]', e);
    return res.redirect('/after-login.html' + afterQuery);
  }
});

export default router;
