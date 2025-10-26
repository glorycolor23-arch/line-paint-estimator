// routes/details.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

import { updateLeadDetails, getLead } from '../lib/store.js';
import { appendToSheet } from '../lib/sheets.js';
import { sendAdminMail } from '../lib/mailer.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Render の一時ディスクに保存（uploads は server.js 側でも起動時に mkdir 済み）
const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB/ファイル
});

const fields = [
  { name: 'drawing_elevation', maxCount: 1 },
  { name: 'drawing_plan',      maxCount: 1 },
  { name: 'drawing_section',   maxCount: 1 },
  { name: 'photo_front',       maxCount: 1 },
  { name: 'photo_right',       maxCount: 1 },
  { name: 'photo_left',        maxCount: 1 },
  { name: 'photo_back',        maxCount: 1 }
];

router.post('/api/details', upload.fields(fields), async (req, res) => {
  try {
    const { leadId, name, phone, postal, lineUserId, paintType, roofWorkType } = req.body || {};
    const lead = getLead(leadId);
    if (!lead) {
      console.warn('[details] lead not found', { leadId });
      return res.status(404).json({ error: 'lead not found' });
    }

    updateLeadDetails(leadId, { name, phone, postal, lineUserId });

    // スプレッドシート：失敗しても処理続行（ログのみ）
    try {
      const created = new Date().toISOString();
      await appendToSheet([
        created,                   // A:日時
        leadId,                    // B
        lineUserId || (lead.lineUserId || ''), // C
        lead.answers?.desiredWork || '',  // D
        lead.answers?.ageRange || '',     // E
        lead.answers?.floors || '',       // F
        lead.answers?.wallMaterial || '', // G
        lead.amount || '',                // H
        name || '', phone || '', postal || '', // I,J,K
        paintType || '',                  // L:希望の塗料
        roofWorkType || '',               // M:希望の工事内容
        'ファイルはメール添付で受領' // N
      ]);
    } catch (e) {
      console.error('[details] appendToSheet failed (non-fatal):', e);
    }

    // メール：失敗しても処理続行（ログのみ）
    try {
      const attachments = [];
      for (const key of Object.keys(req.files || {})) {
        const f = req.files[key]?.[0];
        if (f) attachments.push({ filename: f.originalname || path.basename(f.path), path: f.path });
      }

      let additionalInfo = '';
      if (paintType) additionalInfo += `希望の塗料: ${paintType}<br/>`;
      if (roofWorkType) additionalInfo += `希望の工事内容: ${roofWorkType}<br/>`;

      const summaryHtml = `
        <h3>新しい見積り依頼</h3>
        <p><b>Lead ID:</b> ${leadId}</p>
        <p><b>概算見積:</b> ${Number(lead.amount).toLocaleString('ja-JP')} 円</p>
        <p><b>初期回答</b><br/>
          見積り希望: ${lead.answers?.desiredWork || ''}<br/>
          築年数: ${lead.answers?.ageRange || ''}<br/>
          階数: ${lead.answers?.floors || ''}<br/>
          外壁材: ${lead.answers?.wallMaterial || ''}
        </p>
        <p><b>追加情報</b><br/>
          ${additionalInfo || 'なし'}
        </p>
        <p><b>詳細</b><br/>
          お名前: ${name || ''}<br/>
          電話: ${phone || ''}<br/>
          郵便番号: ${postal || ''}
        </p>
        <p>図面・写真は添付ファイルをご確認ください。</p>
      `;

      await sendAdminMail({
        subject: `【見積依頼】Lead ${leadId} / ${name || '名無し'}`,
        text: `Lead ${leadId} 概算: ${lead.amount}円`,
        html: summaryHtml,
        attachments
      });
    } catch (e) {
      console.error('[details] sendAdminMail failed (non-fatal):', e);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[details] fatal error:', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

export default router;
