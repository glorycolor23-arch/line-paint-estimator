// routes/estimate.js
import { Router } from 'express';
import crypto from 'node:crypto';

const router = Router();

// ランダム state（ログイン往復のCSRF対策 & 一時保存キー）
function createState() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * アンケート送信：
 *  - 受領した回答を一時保存（app.locals.pendingEstimates）
 *  - LINEログイン（bot_prompt=normal）の authorize URL を返す
 *
 * 受け取る answers 形式（フロントと合わせる）:
 * {
 *   desiredWork: "外壁" | "屋根" | "外壁と屋根",
 *   ageRange: "1〜5年" | ... | "31年以上",
 *   floors: "1階建て" | "2階建て" | "3階建て以上",
 *   wallMaterial: "サイディング" | "モルタル" | "ALC" | "ガルバリウム" | "木" | "RC" | "その他" | "わからない"
 * }
 */
router.post('/estimate', async (req, res) => {
  try {
    const answers = req.body || {};
    // 必須チェック
    const required = ['desiredWork', 'ageRange', 'floors', 'wallMaterial'];
    const missing = required.filter(k => !answers[k]);
    if (missing.length) {
      return res.status(400).json({ ok: false, message: 'MISSING_FIELDS', missing });
    }

    // stateを作り一時保存
    const state = createState();
    const store = req.app.locals?.pendingEstimates;
    if (!store) throw new Error('pendingEstimates store missing');
    store.set(state, { answers, createdAt: Date.now() });

    const {
      LINE_LOGIN_CHANNEL_ID,
      LINE_LOGIN_REDIRECT_URI,
    } = process.env;

    // LINEログイン認可URL（未友だちでも bot_prompt=normal で追加誘導）
    const authorizeUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', LINE_LOGIN_CHANNEL_ID);
    authorizeUrl.searchParams.set('redirect_uri', LINE_LOGIN_REDIRECT_URI);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', 'openid profile');
    authorizeUrl.searchParams.set('bot_prompt', 'normal');

    return res.json({ ok: true, redirectUrl: authorizeUrl.toString() });
  } catch (e) {
    console.error('[POST /estimate] error', e);
    return res.status(500).json({ ok: false, message: 'ESTIMATE_FAILED' });
  }
});

export default router;
