// routes/lineLogin.js
import express from 'express';
import { Client } from '@line/bot-sdk';
import {
  saveLink,
  getEstimateForLead,
  saveEstimateForLead,
} from '../store/linkStore.js';
import { computeEstimate } from '../lib/estimate.js';

const router = express.Router();

const LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || '';
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || '';
const LOGIN_REDIRECT_URI = process.env.LINE_LOGIN_REDIRECT_URI || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LIFF_ID = process.env.LIFF_ID || '';
const LIFF_URL_ENV = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';

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
  const origin = process.env.BASE_URL || process.env.PUBLIC_BASE_URL || '';
  return origin ? `${origin.replace(/\/+$/, '')}/liff.html${lead ? `?lead=${encodeURIComponent(lead)}` : ''}` : '';
}

const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

const loginPaths = ['/auth/line/login', '/line/login', '/login'];
router.get(loginPaths, (req, res) => {
  const lead = (typeof req.query.lead === 'string' && req.query.lead)
            || (typeof req.query.state === 'string' && req.query.state)
            || '';
  const state = lead || Math.random().toString(36).slice(2);

  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', LOGIN_CHANNEL_ID);
  authUrl.searchParams.set('redirect_uri', LOGIN_REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'openid profile');
  return res.redirect(authUrl.toString());
});

const callbackPaths = ['/auth/line/callback', '/line/callback', '/callback'];
router.get(callbackPaths, async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.redirect('/after-login.html');

    const lead = (typeof req.query.lead === 'string' && req.query.lead)
              || (typeof req.query.state === 'string' && req.query.state)
              || '';

    // token
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LOGIN_REDIRECT_URI,
        client_id: LOGIN_CHANNEL_ID,
        client_secret: LOGIN_CHANNEL_SECRET,
      }),
    });
    if (!tokenRes.ok) return res.redirect('/after-login.html');

    const { access_token } = await tokenRes.json();

    // profile
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!profRes.ok) return res.redirect('/after-login.html');
    const prof = await profRes.json();
    const userId = prof.userId;

    if (userId) await saveLink(userId, lead);

    // ★ 初期回答を取得して概算を確定保存（follow でも使えるように）
    if (lead && req.app.locals?.pendingEstimates?.has(lead)) {
      const { answers } = req.app.locals.pendingEstimates.get(lead) || {};
      if (answers) {
        const price = computeEstimate(answers);
        const summaryText =
          `■見積もり希望内容：${answers.desiredWork}\n` +
          `■築年数：${answers.ageRange}\n` +
          `■階数：${answers.floors}\n` +
          `■外壁材：${answers.wallMaterial}`;
        await saveEstimateForLead(lead, { price, summaryText, answers });
        req.app.locals.pendingEstimates.delete(lead);
      }
    }

    // 概算をプッシュ（回答の内訳付き）
    if (userId && lead) {
      const estimate = await getEstimateForLead(lead);
      if (estimate) {
        const priceFmt = Number(estimate.price).toLocaleString('ja-JP');
        const liffUrl = resolveLiffUrl(lead);

        const msg1 = {
          type: 'text',
          text:
            `お見積もりのご依頼ありがとうございます。\n` +
            `概算お見積額は ${priceFmt} 円です。\n` +
            `※ご回答内容をもとに算出した概算です。\n\n` +
            estimate.summaryText,
        };

        const msg2 = {
          type: 'template',
          altText: '詳細見積もりのご案内',
          template: {
            type: 'buttons',
            title: 'より詳しいお見積もりをご希望の方はこちらから。',
            text: '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
            actions: [
              {
                type: 'uri',
                label: '無料で、現地調査なしの見積もりを依頼',
                uri: liffUrl || 'https://line.me',
              },
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
