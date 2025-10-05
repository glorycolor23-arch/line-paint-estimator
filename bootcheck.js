// bootcheck.js
import url from 'node:url';

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`[BOOTCHECK] Missing env: ${name}`);
  return v;
}

function exactMatch(a, b) {
  try {
    const u1 = new url.URL(a);
    const u2 = new url.URL(b);
    // 完全一致（プロトコル/ホスト/パス/クエリ/末尾スラなし）
    const n1 = `${u1.protocol}//${u1.host}${u1.pathname.replace(/\/+$/, '')}`;
    const n2 = `${u2.protocol}//${u2.host}${u2.pathname.replace(/\/+$/, '')}`;
    return n1 === n2;
  } catch { return false; }
}

export function runBootChecks() {
  const errs = [];

  // 1) LINE Login の redirect_uri 完全一致（再発ポイントNo.1）
  const REDIRECT = must('LINE_LOGIN_REDIRECT_URI');
  const EXPECT   = process.env.PUBLIC_BASE_URL
    ? `${process.env.PUBLIC_BASE_URL.replace(/\/+$/,'')}/auth/line/callback`
    : null;
  if (EXPECT && !exactMatch(REDIRECT, EXPECT)) {
    errs.push(`[BOOTCHECK] LINE_LOGIN_REDIRECT_URI mismatch
  - .env : ${REDIRECT}
  - expect from PUBLIC_BASE_URL: ${EXPECT}`);
  }

  // 2) Messaging API トーク送信に必要な env
  ['LINE_CHANNEL_ACCESS_TOKEN','LINE_CHANNEL_SECRET'].forEach(n => {
    if (!process.env[n]) errs.push(`[BOOTCHECK] Missing env: ${n}`);
  });

  // 3) LIFF の終点（/liff.html）にたどり着ける設定
  if (!process.env.LIFF_ID && !process.env.LIFF_URL && !process.env.PUBLIC_BASE_URL) {
    errs.push('[BOOTCHECK] LIFF_ID か LIFF_URL か PUBLIC_BASE_URL のいずれかを設定してください');
  }

  // 4) 友だち追加URL
  if (!process.env.LINE_ADD_FRIEND_URL) {
    errs.push('[BOOTCHECK] Missing env: LINE_ADD_FRIEND_URL');
  }

  if (errs.length) {
    console.error('\n' + errs.join('\n') + '\n');
    // 本番で落としたくない場合は return に変えてもOK
    // ここでは明確に気付けるよう throw します。
    throw new Error('[BOOTCHECK] Failed. Please fix environment.');
  } else {
    console.log('[BOOTCHECK] OK: environment looks consistent.');
  }
}
