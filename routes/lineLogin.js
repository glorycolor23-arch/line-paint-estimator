// routes/lineLogin.js
import express from 'express';
import { Client } from '@line/bot-sdk';
import { saveLink, getEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

const LOGIN_CHANNEL_ID     = process.env.LINE_LOGIN_CHANNEL_ID     || '';
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || '';
const LOGIN_REDIRECT_URI   = process.env.LINE_LOGIN_REDIRECT_URI   || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LIFF_ID              = process.env.LIFF_ID || '';
const LIFF_URL_ENV         = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';

function resolveLiffUrl(leadId) {
  if (LIFF_ID) {
    const base = `https://liff.line.me/${LIFF_ID}`;
    return leadId ? `${base}?leadId=${encodeURIComponent(leadId)}` : base;
  }
  if (LIFF_URL_ENV) {
    return leadId
      ? LIFF_URL_ENV + (LIFF_URL_ENV.includes('?') ? '&' : '?') + `leadId=${encodeURIComponent(leadId)}`
      : LIFF_URL_ENV;
  }
  return '';
}

const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

// ログイン開始（state に leadId を埋めて渡す）
router.get(['/auth/line/login', '/line/login', '/login'], (req, res) => {
  const leadId =
    (typeof req.query.leadId === 'string' && req.query.leadId) ||
    (typeof req.query.state  === 'string' && req.query.state)  ||
    '';
  const state = leadId || Math.random().toString(36).slice(2);

  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', LOGIN_CHANNEL_ID);
  authUrl.searchParams.set('redirect_uri', LOGIN_REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'openid profile');
  authUrl.searchParams.set('bot_prompt', 'normal'); // 友だち誘導
  return res.redirect(authUrl.toString());
});

// コールバック
router.get(['/auth/line/callback', '/line/callback', '/callback'], async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.redirect('/after-login.html');

    const leadId =
      (typeof req.query.leadId === 'string' && req.query.leadId) ||
      (typeof req.query.state  === 'string' && req.query.state)  ||
      '';

    // token 交換
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
    const tokenJson   = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // profile
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profRes.ok) {
      console.error('[LOGIN] profile fetch failed', await profRes.text());
      return res.redirect('/after-login.html');
    }
    const prof   = await profRes.json();
    const userId = prof.userId;

    // userId ⇔ leadId を保存（follow でも拾えるように）
    if (userId && leadId) {
      await saveLink(userId, leadId);

      // 概算が既にあるなら即時プッシュ（取りこぼし救済）
      const estimate = await getEstimateForLead(leadId);
      if (estimate) {
        const priceFmt =
          estimate.price != null
            ? Number(estimate.price).toLocaleString('ja-JP')
            : '—';
        const liffUrl = resolveLiffUrl(leadId);

        const msg1 = {
          type: 'text',
          text:
            `お見積もりのご依頼ありがとうございます。\n` +
            `概算お見積額は ${priceFmt} 円です。` +
            (estimate.summaryText ? `\n— ご回答内容 —\n${estimate.summaryText}` : ''),
        };
        const msg2 = {
          type: 'template',
          altText: '詳細見積もりのご案内',
          template: {
            type: 'buttons',
            title: 'より詳しいお見積もりをご希望の方はこちらから。',
            text: '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
            actions: [
              { type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: liffUrl || 'https://line.me' },
            ],
          },
        };
        try { await lineClient.pushMessage(userId, [msg1, msg2]); } catch (e) { console.error('[LOGIN push]', e); }
      }
    }

    return res.redirect('/after-login.html');
  } catch (e) {
    console.error('[LOGIN CALLBACK ERROR]', e);
    return res.redirect('/after-login.html');
  }
});

export default router;
