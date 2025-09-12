// lib/mailer.js
import nodemailer from "nodemailer";
import { CONFIG } from "../config.js";

export async function sendAdminMail({ subject, text, html, attachments = [] }) {
  if (!CONFIG.ADMIN_EMAIL || !CONFIG.SMTP_HOST) return;
  const transporter = nodemailer.createTransport({
    host: CONFIG.SMTP_HOST,
    port: CONFIG.SMTP_PORT,
    secure: CONFIG.SMTP_SECURE,
    auth: (CONFIG.SMTP_USER && CONFIG.SMTP_PASS) ? { user: CONFIG.SMTP_USER, pass: CONFIG.SMTP_PASS } : undefined,
  });
  await transporter.sendMail({
    from: `見積りシステム <no-reply@${new URL(CONFIG.LIFF_URL || "https://example.com").hostname}>`,
    to: CONFIG.ADMIN_EMAIL,
    subject, text, html, attachments,
  });
}
