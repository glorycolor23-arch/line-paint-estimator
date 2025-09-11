import 'dotenv/config';

export const CONFIG = {
  PORT: process.env.PORT || 3000,

  // LINE Messaging API
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,

  // LINE Official Account 友だち追加URL（@IDの短縮URL）
  LINE_ADD_FRIEND_URL: process.env.LINE_ADD_FRIEND_URL, // 例: https://lin.ee/xxxxxx

  // LIFF
  LIFF_ID: process.env.LIFF_ID,              // liff.init で使用
  LIFF_URL: process.env.LIFF_URL,            // 例: https://your-render-app.onrender.com/liff.html

  // Google Sheets
  GOOGLE_SHEETS_ID: process.env.GOOGLE_SHEETS_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),

  // メール
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || "matsuo@graphity.co.jp",
  SMTP_HOST: process.env.SMTP_HOST,          // 例: smtp.sendgrid.net or smtp.gmail.com
  SMTP_PORT: parseInt(process.env.SMTP_PORT || "587", 10),
  SMTP_SECURE: process.env.SMTP_SECURE === "true", // TLS
  SMTP_USER: process.env.SMTP_USER,          // 例: apikey / Gmailユーザー
  SMTP_PASS: process.env.SMTP_PASS           // 例: SendGrid API Key or Gmail App Password
};