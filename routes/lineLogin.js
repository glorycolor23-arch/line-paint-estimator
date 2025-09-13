// routes/lineLogin.js
import express from 'express';
import { Client } from '@line/bot-sdk';
import {
  saveLink,
  getEstimateForLead,
} from '../store/linkStore.js';

const router = express.Router();

// --- 環境変数（ログインチャネル） ---
const LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || process.env.LOGIN_CHANNEL_ID;
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.LOGIN_CHANNEL_SECRET;
const LOGIN_REDIRECT_URI = process.env.LINE_LOGIN_REDIRECT_URI || process.env.LOGIN_REDIRECT_URI;

// --- LIFF URL（ボタン用） ---
const BASE_LIFF_URL = process.env.LIFF_ID
  ? `https://liff.line.me/${process.env.LIFF_ID}`
  : (process.env.LIFF_URL || '');

// --- Push 用（未設定でも落とさない） ---
let _client = null;
function getLineClient() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  if (!_client) _client = new Client({ channelAccessToken: token });
  return _client;
}

// ログイン開始（例: /auth/line/login?lead=xxxxx）
// state に leadId を埋め込んでコールバックへ持ち回ります。
const loginPaths = ['/auth/line/login', '/line/login', '/login'];
router.get(loginPaths, (req, res) => {
  const lead = typeof req.query.lead === 'string' && req.query.lead ? req.query.lead : '';
  // `state` には "lead:<id>" という形で入れる
  const state = lead ? `lead:${lead}` : Math.random().toString(36).slice(2);

  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', LOGIN_CHANNEL_ID);
  authUrl.searchParams.set('redirect_uri', LOGIN_REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'openid profile');

  return res.redirect(authUrl.toString());
});

/* -------------------------------------------------
 * コールバック（LINE 開発者コンソールの Callback URL と一致）
 *   - /auth/line/callback
 *   - /line/callback
 *   - /callback
 * ------------------------------------------------- */
const callbackPaths = ['/auth/line/callback', '/line/callback', '/callback'];
router.get(callbackPaths, async (req, res) => {
  try {
    const code = req.query.code;
    const state = typeof req.query.state === 'string' ? req.query.state : '';

    if (!code) {
      // code が無ければ控えめに終了
      return res.redirect('/after-login.html');
    }

    // トークン交換
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

    if (!tokenRes.ok) {
      console.error('[LOGIN] token exchange failed', await tokenRes.text());
      return res.redirect('/after-login.html');
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // アクセストークンでプロフィール取得 → userId
    const profRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profRes.ok) {
      console.error('[LOGIN] profile failed', await profRes.text());
      return res.redirect('/after-login.html');
    }
    const prof = await profRes.json();
    const userId = prof?.userId;
    if (!userId) {
      console.error('[LOGIN] no userId in profile');
      return res.redirect('/after-login.html');
    }

    // state から leadId を復元（"lead:<id>" 形式）
    let leadId = '';
    if (state.startsWith('lead:')) {
      leadId = state.slice('lead:'.length);
    }

    // ひも付け保存（leadId が取れていれば保存する）
    if (leadId) {
      await saveLink(userId, leadId);

      // 既に概算が保存されていれば、このタイミングで Push（フォロー済み/未済どちらでも届く）
      const est = await getEstimateForLead(leadId);
      const cli = getLineClient();

      if (cli && est) {
        const priceFmt =
          est.price != null ? est.price.toLocaleString('ja-JP') : '—';

        const liffUrl = BASE_LIFF_URL
          ? (() => {
              try {
                const u = new URL(BASE_LIFF_URL);
                u.searchParams.set('lead', leadId);
                return u.toString();
              } catch {
                return BASE_LIFF_URL;
              }
            })()
          : '';

        const msgs = [
          {
            type: 'text',
            text:
              'お見積もりのご依頼ありがとうございます。\n' +
              `概算お見積額は ${priceFmt} 円 です。\n` +
              '※ご回答内容をもとに算出した概算です。',
          },
          {
            type: 'template',
            altText: '無料で詳細見積もりを依頼する',
            template: {
              type: 'buttons',
              text:
                'より詳しいお見積もりをご希望の方はこちらから。\n' +
                '現地調査での訪問は行わず、具体的なお見積もりを提示します。',
              actions: liffUrl
                ? [{ type: 'uri', label: '無料で詳細見積もりを依頼する', uri: liffUrl }]
                : [],
            },
          },
        ];

        try {
          await cli.pushMessage(userId, msgs);
        } catch (e) {
          console.error('[LOGIN] push failed', e);
        }
      }
    }

    // 画面上は完了案内へ
    return res.redirect('/after-login.html');
  } catch (e) {
    console.error('[LOGIN CALLBACK ERROR]', e);
    return res.redirect('/after-login.html');
  }
});

export default router;
