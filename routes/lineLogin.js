// routes/lineLogin.js
import express from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { saveLink, getEstimateForLead, markPendingPush, isFriendKnown } from '../store/linkStore.js';
import { Client } from '@line/bot-sdk';

const router = express.Router();

const LOGIN_CLIENT_ID = process.env.LINE_LOGIN_CHANNEL_ID || '';
const LOGIN_CLIENT_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET || '';
const REDIRECT_URI = process.env.LINE_LOGIN_REDIRECT_URI || '';
const BASE_URL = process.env.BASE_URL || '';

const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
});

/** Step1: 認可開始（?lead=xxx を必ず付ける） */
router.get('/auth/line/start', (req, res) => {
  const lead = req.query.lead || '';
  if (!lead) return res.status(400).send('lead is required');

  const stateRaw = JSON.stringify({ lead });
  const state = Buffer.from(stateRaw).toString('base64url');

  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', LOGIN_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', 'openid profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('prompt', 'consent'); // 初回のみ同意

  res.redirect(authUrl.toString());
});

/** Step2: コールバック（code → token → id_token の sub で userId 取得） */
router.get('/auth/line/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state;
    if (!code || !state) return res.status(400).send('invalid callback');

    const decoded = JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8') || '{}');
    const leadId = decoded.lead;
    if (!leadId) return res.status(400).send('lead missing');

    // トークン交換
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: LOGIN_CLIENT_ID,
        client_secret: LOGIN_CLIENT_SECRET,
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('[TOKEN ERROR]', tokenJson);
      return res.status(500).send('token error');
    }
    const idToken = tokenJson.id_token;

    // id_token の検証（簡易）
    const profileRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: idToken,
        client_id: LOGIN_CLIENT_ID,
      }),
    });
    const verifyJson = await profileRes.json();
    if (!profileRes.ok) {
      console.error('[VERIFY ERROR]', verifyJson);
      return res.status(500).send('verify error');
    }
    const userId = verifyJson.sub; // ← LINEユーザーID

    // ひも付け保存
    await saveLink(userId, leadId);

    // 友だち状態判定（未フォローなら follow 時に送るフラグ）
    const isFriend = await isFriendKnown(userId);
    if (!isFriend) {
      await markPendingPush(userId, leadId);
    } else {
      // 既に友だち → 即プッシュ
      const est = await getEstimateForLead(leadId);
      const priceFmt = est?.price != null ? est.price.toLocaleString('ja-JP') : '—';
      const liffUrl = process.env.LIFF_ID
        ? `https://liff.line.me/${process.env.LIFF_ID}?lead=${encodeURIComponent(leadId)}`
        : (process.env.LIFF_URL || '');

      const msgs = [
        {
          type: 'text',
          text:
            'お見積もりのご依頼ありがとうございます。\n' +
            `概算お見積額は **${priceFmt} 円** です。\n` +
            '※ご回答内容をもとに算出した概算です。',
        },
        {
          type: 'text',
          text: 'より詳しいお見積もりをご希望の方はこちらからお進みください。',
          quickReply: liffUrl
            ? { items: [{ type: 'action', action: { type: 'uri', label: '詳しい見積もりを依頼する', uri: liffUrl } }] }
            : undefined,
        },
      ];
      await lineClient.pushMessage(userId, msgs);
    }

    // ブラウザ側の完了画面
    const doneHtml = `
<!doctype html><meta charset="utf-8">
<title>送信完了</title>
<body style="font-family:sans-serif; padding:24px;">
  <h2>送信が完了しました</h2>
  <p>LINE のトークにお見積もりを送信しました。アプリをご確認ください。</p>
  <p><a href="line://nv/chat">LINE を開く</a></p>
</body>`;
    res.type('html').send(doneHtml);
  } catch (e) {
    console.error('[LOGIN CALLBACK ERROR]', e);
    res.status(500).send('internal error');
  }
});

export default router;
