// src/config.js
export const CONFIG = {
  // Server
  PORT: Number(process.env.PORT || 3000),

  // LINE / LIFF
  LIFF_ID: process.env.LIFF_ID || '',
  LIFF_URL: process.env.LIFF_URL || '',
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET || '',
  LINE_ADD_FRIEND_URL: process.env.LINE_ADD_FRIEND_URL || '',

  // Google Sheets
  GOOGLE_SHEETS_ID:
    process.env.GOOGLE_SHEETS_ID || process.env.GSHEET_SPREADSHEET_ID || '',
  GOOGLE_SERVICE_ACCOUNT_EMAIL:
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || '',
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '')
    // Renderの1行貼付け対応（\n → 改行）
    .replace(/\\n/g, '\n'),

  // Mail (Nodemailer)
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || process.env.EMAIL_TO || '',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_SECURE: String(process.env.SMTP_SECURE || 'false') === 'true',
  SMTP_USER: process.env.SMTP_USER || process.env.EMAIL_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || process.env.EMAIL_PASS || '',
};
