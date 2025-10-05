// routes/lineLogin.js
import express from 'express';
import { Client } from '@line/bot-sdk';
import {
  saveLink,
  getEstimateForLead,
} from '../store/linkStore.js';

const router = express.Router();

// --- 環境変数 ---
const LOGIN_CHANNEL_ID     = process.env.LINE_LOGIN_CHANNEL_ID || '';
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || '';
const LOGIN_REDIRECT_URI   = process.env.LINE_LOGIN_REDIRECT_URI || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

const LIFF_ID     = process.env.LIFF_ID || '';
const LIFF_URL_ENV= process.env.LIFF_URL || process.env.DETAIL_LIFF_URL || '';

/** 友だち追加誘導用：OAのベーシックID / 友だち追加URL
 * after-login.html は ?oa= or ?add= があればトーク/友だち追加を開く。
 * これが欠落すると line.me（公式サイト）へフォールバックしてしまうため、常に付与する。
 */
const OA_BASIC_ID        = process.env.OA_BASIC_ID || process.env.LINE_OA_BASIC_ID || ''; // 例: @004szogc
const LINE_ADD_FRIEND_URL= process.env.LINE_ADD_FRIEND_URL || ''; // 例: https://line.me/R/ti/p/@004szogc

// ボタンの遷移先（LIFF優先、なければホストした liff.html）
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

// -------------------------------------------------
// ログイン開始
// -------------------------------------------------
const loginPaths = ['/auth/line/login', '/line/login', '/login'];
router.get(loginPaths, (_req, res) => {
  const state = Math.random().toString(36).slice(2); // 任意
  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', LOGIN_CHANNEL_ID);
  authUrl.searchParams.set('redirect_uri', LOGIN_REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'openid profile');
  return res.redirect(authUrl.toString());
});

// -------------------------------------------------
// コールバック（/auth/line/callback ほか複数で受ける）
// -------------------------------------------------
const callbackPaths = ['/auth/line/callback', '/line/callback', '/callback'];
router.get(callbackPaths, async (req, res) => {
  // after-login に必ず oa / add を付けて返す関数（ここが今回の修正ポイント）
  const redirectToAfterLogin = () => {
    const q = new URLSearchParams();
    if (OA_BASIC_ID)         q.set('oa',  OA_BASIC_ID);
    if (LINE_ADD_FRIEND_URL) q.set('add', LINE_ADD_FRIEND_URL);
    const qs = q.toString();
    return res.redirect(`/after-login.html${qs ? `?${qs}` : ''}`);
  };

  try {
    const code = req.query.code;
    if (!code) return redirectToAfterLogin();

    // state を lead として受ける／または ?lead=
    const lead =
      (typeof req.query.lead === 'string'  && req.query.lead)  ||
      (typeof req.query.state === 'string' && req.query.state) || '';

    // --- token exchange ---
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
      return redirectToAfterLogin();
    }
    const tokenJson   = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // --- profile 取得 ---
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profRes.ok) {
      console.error('[LOGIN] profile fetch failed', await profRes.text());
      return redirectToAfterLogin();
    }
    const prof   = await profRes.json();
    const userId = prof.userId;

    // userId と lead を紐付け
    if (userId && lead) {
      await saveLink(userId, lead);

      // 保存済みの概算があれば即プッシュ（follow の取りこぼし救済）
      const estimate = await getEstimateForLead(lead);
      if (estimate) {
        const priceFmt =
          estimate.price != null ? Number(estimate.price).toLocaleString('ja-JP') : '—';
        const liffUrl = resolveLiffUrl(lead);

        const msg1 = {
          type: 'text',
          text:
            `お見積もりのご依頼ありがとうございます。\n` +
            `概算お見積額は ${priceFmt} 円です。\n` +
            `※ご回答内容をもとに算出した概算です。`,
        };
        const msg2 = {
          type: 'template',
          altText: '詳細見積もりのご案内',
          template: {
            type: 'buttons',
            title: 'より詳しいお見積もりをご希望の方はこちらから。',
            text: '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
            actions: [{ type: 'uri', label: '無料で、現地調査なしの見積もりを依頼', uri: liffUrl || 'https://line.me' }],
          },
        };
        try { await lineClient.pushMessage(userId, [msg1, msg2]); }
        catch (e) { console.error('[LOGIN] push failed', e); }
      }
    }

    // ✅ ここで必ず OA 情報付きで after-login に戻す（友だち追加/トークを開く）
    return redirectToAfterLogin();
  } catch (e) {
    console.error('[LOGIN CALLBACK ERROR]', e);
    return redirectToAfterLogin();
  }
});

export default router;
