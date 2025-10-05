// routes/estimate.js
import { Router } from 'express';
import crypto from 'node:crypto';

const router = Router();

function createState() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

router.post('/estimate', async (req, res) => {
  try {
    const body = req.body || {};
    const answers = (body.answers && typeof body.answers === 'object') ? body.answers : body;

    const required = ['desiredWork','ageRange','floors','wallMaterial'];
    const missing = required.filter(k => !answers[k]);

    const { LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_REDIRECT_URI } = process.env;

    if (!LINE_LOGIN_CHANNEL_ID || !LINE_LOGIN_REDIRECT_URI) {
      return res.json({ ok: true, redirectUrl: 'https://lin.ee/XxmuVXt' });
    }

    // 回答を一時保存（state=leadId 的に扱う）
    const store = req.app.locals?.pendingEstimates;
    if (!store) throw new Error('pendingEstimates store missing');
    const state = createState();
    store.set(state, { answers, createdAt: Date.now() });

    const authorizeUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', LINE_LOGIN_CHANNEL_ID);
    authorizeUrl.searchParams.set('redirect_uri', LINE_LOGIN_REDIRECT_URI);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', 'openid profile');
    authorizeUrl.searchParams.set('bot_prompt', 'normal');

    return res.json({
      ok: true,
      redirectUrl: authorizeUrl.toString(),
      ...(missing.length ? { note: 'MISSING_FIELDS', missing } : {})
    });
  } catch (e) {
    console.error('[POST /estimate] error', e);
    return res.json({ ok: true, redirectUrl: 'https://lin.ee/XxmuVXt' });
  }
});

export default router;
