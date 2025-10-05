// routes/lineLogin.js
import express from 'express';
import { Client } from '@line/bot-sdk';
import {
  saveLink,
  getEstimateForLead,
} from '../store/linkStore.js';

const router = express.Router();

const LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || '';
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || '';
const LOGIN_REDIRECT_URI = process.env.LINE_LOGIN_REDIRECT_URI || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LIFF_ID = process.env.LIFF_ID || '';
const LIFF_URL_ENV = process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';

// 友だち追加誘導用（環境変数）
const ADD_URL = process.env.LINE_ADD_FRIEND_URL || '';
const OA_BASIC_ID = process.env.LINE_OA_BASIC_ID || process.env.LINE_BASIC_ID || '';

const lineClient = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

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
  return '';
}

// after-login へ常に「友だち追加 or トークを開く」クエリを付ける
function makeAfterLoginUrl() {
  const u = new URL('/after-login.html', 'https://dummy.local'); // 相対URL組み立て用
  if (ADD_URL) {
    u.searchParams.set('add', ADD_URL); // 例: https://line.me/R/ti/p/@XXXX
  } else if (OA_BASIC_ID) {
    u.searchParams.set('oa', OA_BASIC_ID); // 例: @004szogc
    u.searchParams.set('msg', '見積結果を確認したいです');
  }
  return u.pathname + u.search; // 相対で返す
}

function buildDetailsText(est) {
  if (est?.summaryText) return est.summaryText;
  const a = est?.answers || {};
  return (
    `■見積もり希望内容：${a.desiredWork ?? '-'}\n` +
    `■築年数：${a.ageRange ?? '-'}\n` +
    `■階数：${a.floors ?? '-'}\n` +
    `■外壁材：${a.wallMaterial ?? '-'}`
  );
}

// ログイン開始（複数パス対応）
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
  return res.redirect(authUrl.toString());
});

// コールバック（複数パス対応）
const callbackPaths = ['/auth/line/callback', '/line/callback', '/callback'];
router.get(callbackPaths, async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.redirect(makeAfterLoginUrl());

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
      return res.redirect(makeAfterLoginUrl());
    }
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // profile
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profRes.ok) {
      console.error('[LOGIN] profile fetch failed', await profRes.text());
      return res.redirect(makeAfterLoginUrl());
    }
    const prof = await profRes.json();
    const userId = prof.userId;

    // 紐付け & 概算プッシュ（既に保存がある場合）
    if (userId && lead) {
      await saveLink(userId, lead);

      const estimate = await getEstimateForLead(lead);
      if (estimate) {
        const priceFmt =
          estimate.price != null ? Number(estimate.price).toLocaleString('ja-JP') : '—';
        const liffUrl = resolveLiffUrl(lead);

        const msg1 = {
          type: 'text',
          text: `お見積もりのご依頼ありがとうございます。\n概算お見積額は ${priceFmt} 円です。\n※ご回答内容をもとに算出した概算です。`,
        };
        // 4項目の詳細
        const msg1b = { type: 'text', text: buildDetailsText(estimate) };
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

        try { await lineClient.pushMessage(userId, [msg1, msg1b, msg2]); }
        catch (e) { console.error('[LOGIN] push failed', e); }
      }
    }

    return res.redirect(makeAfterLoginUrl());
  } catch (e) {
    console.error('[LOGIN CALLBACK ERROR]', e);
    return res.redirect(makeAfterLoginUrl());
  }
});

export default router;
