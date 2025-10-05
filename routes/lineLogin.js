// routes/lineLogin.js
import express from 'express';
import { Client } from '@line/bot-sdk';
import { saveLink, getEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

// Env
const LOGIN_CHANNEL_ID     = process.env.LINE_LOGIN_CHANNEL_ID || '';
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || '';
const LOGIN_REDIRECT_URI   = process.env.LINE_LOGIN_REDIRECT_URI || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LIFF_ID              = process.env.LIFF_ID || '';
const LIFF_URL_ENV         = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';
const BASE_URL             = (process.env.BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/,'');

const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

function resolveLiffUrl(lead) {
  if (LIFF_ID) {
    const base = `https://liff.line.me/${LIFF_ID}`;
    return lead ? `${base}?leadId=${encodeURIComponent(lead)}` : base;
  }
  if (LIFF_URL_ENV) {
    return lead
      ? LIFF_URL_ENV + (LIFF_URL_ENV.includes('?') ? '&' : '?') + `leadId=${encodeURIComponent(lead)}`
      : LIFF_URL_ENV;
  }
  if (BASE_URL) {
    return `${BASE_URL}/liff.html${lead ? `?leadId=${encodeURIComponent(lead)}` : ''}`;
  }
  return '/liff.html';
}

// ログイン開始（state=leadId を渡す前提）
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
  authUrl.searchParams.set('bot_prompt', 'normal'); // 未友だちならOAへ導線
  return res.redirect(authUrl.toString());
});

// コールバック（/auth/line/callback）
const callbackPaths = ['/auth/line/callback', '/line/callback', '/callback'];
router.get(callbackPaths, async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.redirect('/after-login.html');

    // state を lead として受ける／または ?lead=
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
      return res.redirect('/after-login.html');
    }
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // profile
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profRes.ok) {
      console.error('[LOGIN] profile fetch failed', await profRes.text());
      return res.redirect('/after-login.html');
    }
    const prof = await profRes.json();
    const userId = prof.userId;

    // 保存（userId <-> lead）
    if (userId && lead) {
      await saveLink(userId, lead);

      // 概算があれば即プッシュ（follow の取りこぼし救済）
      const est = await getEstimateForLead(lead);
      if (est?.summaryText) {
        const liffUrl = resolveLiffUrl(lead);
        const msg1 = { type: 'text', text: est.summaryText };
        const msg2 = {
          type: 'template',
          altText: '詳細見積もりのご案内',
          template: {
            type: 'buttons',
            title: 'より詳しいお見積もりをご希望の方はこちらから。',
            text: '現地調査なしで無料の詳細見積もりが可能です。',
            actions: [
              { type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: liffUrl || 'https://line.me' },
            ],
          },
        };
        try { await lineClient.pushMessage(userId, [msg1, msg2]); }
        catch (e) { console.error('[LOGIN] push failed', e); }
      }
    }

    return res.redirect('/after-login.html');
  } catch (e) {
    console.error('[LOGIN CALLBACK ERROR]', e);
    return res.redirect('/after-login.html');
  }
});

export default router;
