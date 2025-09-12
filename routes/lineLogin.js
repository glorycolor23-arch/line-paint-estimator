// routes/lineLogin.js
import { Router } from 'express';
import * as line from '@line/bot-sdk';
import { computeEstimate } from '../lib/estimate.js';

const router = Router();

const {
  // Messaging API
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,

  // LINEログイン
  LINE_LOGIN_CHANNEL_ID,
  LINE_LOGIN_CHANNEL_SECRET,
  LINE_LOGIN_REDIRECT_URI,

  // 詳細見積もり LIFF
  LIFF_URL_DETAIL,   // 例: https://liff.line.me/165xxxxxxxx-xxxxxxxx（フルURL推奨）
  LIFF_ID_DETAIL,    // 例: 165xxxxxxxx-xxxxxxxx（IDだけでも可）
  LIFF_ID,           // 例: 165xxxxxxxx-xxxxxxxx（旧変数名に対応：保険）

  // トーク誘導
  LINE_BOT_BASIC_ID,                          // 例: @004szogc（設定推奨）
  FRIEND_ADD_URL = 'https://lin.ee/XxmuVXt',  // フォールバック（友だち追加URL）
  PUBLIC_BASE_URL = 'https://line-paint.onrender.com', // 既定の自己URL（通常URLフォールバックで使用）

  // 認証後の自動遷移ディレイ（ms）。0 で即時遷移
  TALK_REDIRECT_DELAY_MS = '1200',
} = process.env;

// LINE SDK クライアント
const client = new line.Client({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: LINE_CHANNEL_SECRET || '',
});

// ===== Utility =====
function buildTalkUrl() {
  if (LINE_BOT_BASIC_ID && LINE_BOT_BASIC_ID.trim()) {
    return `https://line.me/R/ti/p/${LINE_BOT_BASIC_ID.replace(/^@/, '')}`;
  }
  return FRIEND_ADD_URL;
}

// LIFF の URL を決定（URL優先 → ID群から生成 → それでも無ければ null）
function buildLiffUrl() {
  const trimmedUrl = (LIFF_URL_DETAIL || '').trim();
  const trimmedId  = (LIFF_ID_DETAIL || LIFF_ID || '').trim();

  // https://liff.line.me/ で始まっていれば OK（クエリやパラメータ付きも許容）
  if (trimmedUrl && /^https:\/\/liff\.line\.me\//.test(trimmedUrl)) {
    return trimmedUrl;
  }
  // ID があれば組み立て
  if (trimmedId && /^[A-Za-z0-9_\-]+$/.test(trimmedId)) {
    return `https://liff.line.me/${trimmedId}`;
  }
  return null;
}

// 認証後の「メッセージ表示 → 自動遷移」HTML
function renderPostMessageAndRedirect(talkUrl, justPushedText) {
  const delay = Math.max(0, Number(TALK_REDIRECT_DELAY_MS || 0));
  const escapedMsg = (justPushedText || 'LINEに概算見積もりを送信しました。')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>送信しました</title>
<style>
  :root{--text:#111;--muted:#555;--line:#e5e7eb;--accent:#0d6efd}
  body{margin:0;background:#fff;color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial}
  .wrap{max-width:720px;margin:18vh auto;padding:0 20px;text-align:center}
  h1{font-size:22px;margin:0 0 10px}
  p{margin:0 0 24px;color:var(--muted)}
  .btn{display:inline-block;padding:12px 18px;background:var(--accent);color:#fff;border-radius:10px;text-decoration:none}
  .hint{margin-top:14px;color:var(--muted);font-size:13px}
  .spinner{width:28px;height:28px;border:3px solid var(--line);border-top-color:var(--accent);border-radius:50%;margin:18px auto;animation:spin 0.8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
<div class="wrap">
  <h1>友だち登録ありがとうございます。</h1>
  <p>${escapedMsg}</p>
  <div class="spinner" aria-hidden="true"></div>
  <a class="btn" href="${talkUrl}">LINEのトークを開く</a>
  <div class="hint">自動で切り替わらない場合は上のボタンをタップしてください。</div>
</div>
<script>
  (function(){
    var url = ${JSON.stringify(talkUrl)};
    var delay = ${delay};
    function go(){ try{ location.replace(url); }catch(e){ location.href = url; } }
    if (delay === 0) { go(); } else { setTimeout(go, delay); }
  })();
</script>`;
}

// ===== Callback =====
router.get('/auth/line/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query ?? {};
  if (error) {
    console.error('[LINE LOGIN] error', error, error_description);
    return res.status(400).send('Login canceled.');
  }

  // pending に保存していた回答を取得
  const bucket = req.app.locals?.pendingEstimates;
  const pending = bucket?.get(state);
  if (!pending) return res.status(400).send('Session expired. Please try again.');

  try {
    // --- 認可コード → トークン ---
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LINE_LOGIN_REDIRECT_URI,
        client_id: LINE_LOGIN_CHANNEL_ID,
        client_secret: LINE_LOGIN_CHANNEL_SECRET
      })
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('[LINE LOGIN] token error', tokenJson);
      return res.status(400).send('Login token error.');
    }

    // --- id_token 検証 → userId ---
    const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: tokenJson.id_token,
        client_id: LINE_LOGIN_CHANNEL_ID
      })
    });
    const idInfo = await verifyRes.json();
    if (!verifyRes.ok) {
      console.error('[LINE LOGIN] verify error', idInfo);
      return res.status(400).send('Login verify error.');
    }
    const userId = idInfo.sub;

    // --- 概算算出（仮ロジック） ---
    const a = pending.answers || {};
    const amount = computeEstimate({
      desiredWork: a.desiredWork,
      ageRange: a.ageRange,
      floors: a.floors,
      wallMaterial: a.wallMaterial,
    });
    const amountTxt = (amount ?? 0).toLocaleString('ja-JP');

    // --- LIFF URL の決定（ログ出力で見える化） ---
    const liffUrl = buildLiffUrl();
    console.log('[LINE LOGIN] LIFF resolve', {
      hasUrl: !!LIFF_URL_DETAIL,
      hasIdDetail: !!LIFF_ID_DETAIL,
      hasId: !!LIFF_ID,
      resolved: liffUrl || null
    });

    // --- 送信メッセージ構築 ---
    const messages = [
      {
        type: 'text',
        text: [
          '【概算見積りの受付】',
          `・希望: ${a.desiredWork ?? '-'}`,
          `・築年数: ${a.ageRange ?? '-'}`,
          `・階数: ${a.floors ?? '-'}`,
          `・外壁材: ${a.wallMaterial ?? '-'}`,
          '',
          `概算お見積額は ${amountTxt} 円です。`,
          '※ご回答内容をもとに算出した概算です。'
        ].join('\n')
      }
    ];

    if (liffUrl) {
      // Buttonsテンプレート＋テキストURLの二重化
      messages.push({
        type: 'template',
        altText: '詳細見積もりの入力はこちら',
        template: {
          type: 'buttons',
          text: 'より詳しい見積もりをご希望の方は、こちらから詳細情報をご入力ください。',
          actions: [{ type: 'uri', label: '詳細見積もりを入力', uri: liffUrl }]
        }
      });
      messages.push({ type: 'text', text: `詳細見積もりの入力はこちら：\n${liffUrl}` });
    } else {
      // 最低限のフォールバック：通常URL（LIFFではないがリンクは流す）
      const normalUrl = `${(PUBLIC_BASE_URL || '').replace(/\/+$/,'')}/liff/index.html`;
      messages.push({
        type: 'text',
        text: `詳細見積もりの入力はこちら：\n${normalUrl}`
      });
    }

    // --- 送信 ---
    try {
      await client.pushMessage(userId, messages);
    } catch (err) {
      console.error('[PUSH] failed', err?.originalError?.response?.data ?? err);
      // テンプレが原因ならテキストのみで再送
      try {
        const textOnly = messages.filter(m => m.type === 'text');
        if (textOnly.length) await client.pushMessage(userId, textOnly);
      } catch (e2) {
        console.error('[PUSH text-fallback] failed', e2?.originalError?.response?.data ?? e2);
      }
    }

    // --- 後始末 & 画面遷移 ---
    bucket.delete(state);
    const talkUrl = buildTalkUrl();
    const justText = liffUrl
      ? 'LINEに概算と「詳細見積もり入力」のリンクを送信しました。'
      : 'LINEに概算を送信しました（詳細入力リンクは通常URLで送付）。';
    return res.status(200).send(renderPostMessageAndRedirect(talkUrl, justText));
  } catch (e) {
    console.error('[GET /auth/line/callback] error', e);
    const talkUrl = buildTalkUrl();
    return res
      .status(200)
      .send(renderPostMessageAndRedirect(talkUrl, '処理は完了しました。LINEをご確認ください。'));
  }
});

export default router;
