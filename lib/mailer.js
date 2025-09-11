import nodemailer from 'nodemailer';
import { CONFIG } from '../config.js';

export async function sendAdminMail({ subject, text, html, attachments = [] }) {
  const transporter = nodemailer.createTransport({
    host: CONFIG.SMTP_HOST,
    port: CONFIG.SMTP_PORT,
    secure: CONFIG.SMTP_SECURE,
    auth: {
      user: CONFIG.SMTP_USER,
      pass: CONFIG.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: `"見積りシステム" <no-reply@${new URL(CONFIG.LIFF_URL).hostname}>`,
    to: CONFIG.ADMIN_EMAIL,
    subject,
    text,
    html,
    attachments
  });
}