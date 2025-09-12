// routes/estimate.js
import { Router } from 'express';
import crypto from 'node:crypto';

const router = Router();

// CSRF/state 用ランダムキー
function createState() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

router.post('/estimate', async (req, res) => {
  try {
    // 1) どちらの形でも受理する
    const body = req.body || {};
    const answers = (body.answers && typeof body.answers === 'object') ? body.answers : body;

    // 2) 必須チェック（甘め）— 足りない場合もフェイルセーフで進める
    const required = ['desiredWork','ageRange','floors','wallMaterial'];
    const missing = required.filter(k => !answers[k]);

    const {
      LINE_LOGIN_CHANNEL_ID,
      LINE_LOGIN_REDIRECT_URI,
    } = process.env;

    // 3) 環境変数が無ければ、友だちURLへ誘導（最低限のUX確保）
    if (!LINE_LOGIN_CHANNEL_ID || !LINE_LOGIN_REDIRECT_URI) {
      return res.json({
        ok: true,
        redirectUrl: 'https://lin.ee/XxmuVXt'
      });
    }

    // 4) state を作り、pending へ保存
    const store = req.app.locals?.pendingEstimates;
    if (!store) throw new Error('pendingEstimates store missing');
    const state = createState();
    store.set(state, { answers, createdAt: Date.now() });

    // 5) 認可URL（bot_prompt=normal で未友だちも誘導）
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
    // 失敗しても最終的に友だちURLへ誘導
    return res.json({ ok: true, redirectUrl: 'https://lin.ee/XxmuVXt' });
  }
});

export default router;
