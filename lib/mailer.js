// lib/mailer.js
import nodemailer from "nodemailer";
import { CONFIG } from "../src/config.js";

/**
 * 環境変数が揃っていない場合はメール送信をスキップ（no-op）
 * これにより /api/details が 500 で落ちるのを防ぐ
 */
function canSend() {
  return Boolean(CONFIG.SMTP_HOST && CONFIG.SMTP_USER && CONFIG.SMTP_PASS && CONFIG.ADMIN_EMAIL);
}

export async function sendAdminMail({ subject, text, html, attachments = [] }) {
  if (!canSend()) {
    // ログだけ残して成功扱い
    console.log("[MAIL] skipped (missing SMTP/ADMIN_EMAIL). subject:", subject);
    return { ok: true, skipped: true };
  }

  const transporter = nodemailer.createTransport({
    host: CONFIG.SMTP_HOST,
    port: CONFIG.SMTP_PORT,
    secure: CONFIG.SMTP_SECURE,
    auth: { user: CONFIG.SMTP_USER, pass: CONFIG.SMTP_PASS },
    connectionTimeout: 60000, // 60秒
    greetingTimeout: 30000,   // 30秒
    socketTimeout: 60000      // 60秒
  });
  
  console.log('[MAIL] Attempting to send email to:', CONFIG.ADMIN_EMAIL);
  console.log('[MAIL] SMTP config:', { host: CONFIG.SMTP_HOST, port: CONFIG.SMTP_PORT, secure: CONFIG.SMTP_SECURE });

  const fromDomain = (() => {
    try { return new URL(CONFIG.LIFF_URL).hostname; } catch { return "example.com"; }
  })();

  await transporter.sendMail({
    from: `"見積りシステム" <no-reply@${fromDomain}>`,
    to: CONFIG.ADMIN_EMAIL,
    subject,
    text,
    html,
    attachments,
  });

  return { ok: true };
}
