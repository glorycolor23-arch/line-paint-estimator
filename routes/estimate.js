// routes/estimate.js
import { Router } from 'express';
import crypto from 'node:crypto';

const router = Router();

/** ランダム state を作る（ログイン往復で改ざん防止 & 一時保存キー） */
function createState() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * アンケート送信エンドポイント
 * 既存フロントから JSON POST される前提（パスは /estimate のまま）
 * ここでは回答を一時保存し、LINEログインの認可URL（bot_prompt=normal）を返す。
 */
router.post('/estimate', async (req, res) => {
  try {
    const answers = req.body || {};

    // 既存のスプレッドシート保存・メール送信がある場合はこの辺で実行（削除しない）
    // 例）await saveToSheet(answers);

    // state を生成し、一時保存（server.js で app.locals に Map を用意済み）
    const state = createState();
    const bucket = req.app.locals?.pendingEstimates;
    if (!bucket) throw new Error('pendingEstimates store missing');
    bucket.set(state, { answers, createdAt: Date.now() });

    const {
      LINE_LOGIN_CHANNEL_ID,
      LINE_LOGIN_REDIRECT_URI,
    } = process.env;

    // LINEログイン認可URL（友だち未追加でも bot_prompt=normal で追加誘導）
    const authorizeUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', LINE_LOGIN_CHANNEL_ID);
    authorizeUrl.searchParams.set('redirect_uri', LINE_LOGIN_REDIRECT_URI);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', 'openid profile');
    authorizeUrl.searchParams.set('bot_prompt', 'normal');

    return res.json({
      ok: true,
      redirectUrl: authorizeUrl.toString(), // フロントはこのURLへ遷移する
    });
  } catch (e) {
    console.error('[POST /estimate] error', e);
    return res.status(500).json({ ok: false, message: 'ESTIMATE_FAILED' });
  }
});

export default router;
