
import nodemailer from 'nodemailer';
function tx(){
  const host = process.env.SMTP_HOST, port = Number(process.env.SMTP_PORT||587), user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
  if(!host||!user||!pass) return null;
  return nodemailer.createTransport({ host, port, secure: port===465, auth:{user, pass} });
}
export async function sendMail({to, subject, text}){
  const t = tx(); if(!t) return {ok:true, skipped:true};
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const info = await t.sendMail({ from, to, subject, text });
  return { ok:true, messageId: info.messageId };
}
