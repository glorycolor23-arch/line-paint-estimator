
import express from 'express';
import { client } from './lib/lineClient.js';
import { saveDetails, getEstimate, findLeadByUser } from './lib/store.js';
import { appendSheet } from './lib/sheets.js';
import { sendMail } from './lib/mailer.js';

const router = express.Router();

router.post('/', async (req,res)=>{
  try{
    const { userId, leadId, answers } = req.body || {};
    if(!userId) return res.status(400).json({ ok:false, error:'userId required' });
    const id = leadId || findLeadByUser(userId) || 'unknown';
    saveDetails(id, answers||{});

    const est = getEstimate(id);
    const now = new Date().toISOString();
    await appendSheet([ now, userId, id, JSON.stringify(est?.inputs||{}), est?.total||'', JSON.stringify(answers||{}) ]);

    const mailTo = process.env.ADMIN_EMAIL || process.env.MAIL_TO;
    if(mailTo){
      const text = `LINE外壁塗装の詳細回答を受信しました。
User: ${userId}
Lead: ${id}

[概算]
${est?est.text:'(なし)'}

[詳細回答]
${JSON.stringify(answers,null,2)}`;
      await sendMail({ to: mailTo, subject: '【外壁塗装】詳細回答を受信', text });
    }
    await client.pushMessage(userId, { type:'text', text:'詳細情報を受け取りました。ありがとうございます。' });
    res.json({ ok:true });
  }catch(e){ console.error(e); res.status(500).json({ ok:false, error:e.message }); }
});

export default router;
