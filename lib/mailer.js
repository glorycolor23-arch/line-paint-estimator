// lib/mailer.js
import { CONFIG } from "../src/config.js";

/**
 * 環境変数が揃っていない場合はメール送信をスキップ（no-op）
 * これにより /api/details が 500 で落ちるのを防ぐ
 */
function canSend() {
  // Resend HTTP APIを使用する場合は、RESEND_API_KEYが必要
  if (CONFIG.RESEND_API_KEY && CONFIG.ADMIN_EMAIL) {
    return true;
  }
  // 従来のSMTP設定がある場合
  return Boolean(CONFIG.SMTP_HOST && CONFIG.SMTP_USER && CONFIG.SMTP_PASS && CONFIG.ADMIN_EMAIL);
}

export async function sendAdminMail({ subject, text, html, attachments = [] }) {
  if (!canSend()) {
    // ログだけ残して成功扱い
    console.log("[MAIL] skipped (missing RESEND_API_KEY or SMTP/ADMIN_EMAIL). subject:", subject);
    return { ok: true, skipped: true };
  }

  console.log('[MAIL] Attempting to send email to:', CONFIG.ADMIN_EMAIL);

  // Resend HTTP APIを使用
  if (CONFIG.RESEND_API_KEY) {
    console.log('[MAIL] Using Resend HTTP API');
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'onboarding@resend.dev',
          to: [CONFIG.ADMIN_EMAIL],
          subject: subject,
          html: html || text,
          text: text
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('[MAIL] Resend API error:', data);
        throw new Error(`Resend API error: ${data.message || response.statusText}`);
      }

      console.log('[MAIL] Email sent successfully via Resend HTTP API:', data.id);
      return { ok: true };
    } catch (error) {
      console.error('[MAIL] Failed to send email via Resend HTTP API:', error);
      throw error;
    }
  }

  // 従来のSMTP送信（フォールバック）
  console.log('[MAIL] Using SMTP');
  const nodemailer = await import('nodemailer');
  
  const transporter = nodemailer.default.createTransport({
    host: CONFIG.SMTP_HOST,
    port: CONFIG.SMTP_PORT,
    secure: CONFIG.SMTP_SECURE,
    auth: { user: CONFIG.SMTP_USER, pass: CONFIG.SMTP_PASS },
    connectionTimeout: 60000, // 60秒
    greetingTimeout: 30000,   // 30秒
    socketTimeout: 60000      // 60秒
  });
  
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

