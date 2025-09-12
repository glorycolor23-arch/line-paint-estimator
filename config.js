// ESM + dotenv（Render では .env は無視されるがローカル開発で有効）
import 'dotenv/config';

// サーバ基本
export const PORT = process.env.PORT || 10000;
export const BASE_URL =
  process.env.BASE_URL || 'https://line-paint.onrender.com';

// ---- LINE Messaging API ----
// 既存プロジェクトで使いがちな別名もフォールバックで拾う
export const LINE_CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN ||
  process.env.CHANNEL_ACCESS_TOKEN ||
  process.env.MESSAGING_API_CHANNEL_ACCESS_TOKEN ||
  '';

export const LINE_CHANNEL_SECRET =
  process.env.LINE_CHANNEL_SECRET ||
  process.env.CHANNEL_SECRET ||
  process.env.MESSAGING_API_CHANNEL_SECRET ||
  '';

// 友だち追加URL（既存の値）
export const FRIEND_ADD_URL =
  process.env.FRIEND_ADD_URL || 'https://lin.ee/XxmuVXt';

// ---- LINEログイン（必要に応じて使用）----
export const LINE_LOGIN_CHANNEL_ID =
  process.env.LINE_LOGIN_CHANNEL_ID || '';
export const LINE_LOGIN_CHANNEL_SECRET =
  process.env.LINE_LOGIN_CHANNEL_SECRET || '';
export const LINE_LOGIN_REDIRECT_URI =
  process.env.LINE_LOGIN_REDIRECT_URI || `${BASE_URL}/line/callback`;

// ---- 詳細見積もり LIFF ----
export const DETAILS_LIFF_URL = process.env.DETAILS_LIFF_URL || '';
