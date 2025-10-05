// routes/selftest.js
import express from 'express';

const router = express.Router();

// /__selftest は、主要な“鎖”の期待URLを返す（手作業の確認短縮）
router.get('/__selftest', (req, res) => {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/,'');
  const redirect = process.env.LINE_LOGIN_REDIRECT_URI || '';
  const liffId = process.env.LIFF_ID || '';
  const liffUrl = process.env.LIFF_URL || '';
  const add = process.env.LINE_ADD_FRIEND_URL || '';
  const webhook = `${base || ''}/line/webhook`;
  const liffEnd = liffId ? `https://liff.line.me/${liffId}` :
                 liffUrl ? liffUrl :
                 base ? `${base}/liff.html` : '/liff.html';

  res.json({
    ok: true,
    EXPECT_REDIRECT_URI: base ? `${base}/auth/line/callback` : '(set PUBLIC_BASE_URL)',
    LINE_LOGIN_REDIRECT_URI: redirect,
    MATCH: !!(base && redirect && redirect.startsWith(`${base}/auth/line/callback`)),
    LIFF_ENDPOINT_SHOULD_OPEN: liffEnd,
    WEBHOOK_SHOULD_BE: webhook,
    ADD_FRIEND_URL: add || '(missing)',
    NOTES: [
      '1) LINE Developers の redirect_uri と LINE_LOGIN_REDIRECT_URI を完全一致に',
      '2) /liff, /liff/index.html → /liff.html へ 302 されること',
      '3) /after-login.html が 200 で返ること',
      '4) /estimate で leadId が返り、その leadId が follow/callback で summaryText に使われること'
    ]
  });
});

export default router;
