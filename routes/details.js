// routes/details.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { updateLeadDetails, getLead } from '../lib/store.js';
import { appendToSheet } from '../lib/sheets.js';
import { sendAdminMail } from '../lib/mailer.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}

// Renderの一時ディスクに保存（メール添付後に削除してもOK）
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB/ファイル
});

// drawings: 立面図/平面図/断面図, photos: 正面/右/左/背面
const fields = [
  { name: 'drawing_elevation', maxCount: 1 },
  { name: 'drawing_plan', maxCount: 1 },
  { name: 'drawing_section', maxCount: 1 },
  { name: 'photo_front', maxCount: 1 },
  { name: 'photo_right', maxCount: 1 },
  { name: 'photo_left', maxCount: 1 },
  { name: 'photo_back', maxCount: 1 }
];

router.post('/api/details', upload.fields(fields), async (req, res) => {
  try {
    const { leadId, name, phone, postal, lineUserId } = req.body || {};
    const lead = getLead(leadId);
    if (!lead) return res.status(404).json({ error: 'lead not found' });

    const details = { name, phone, postal, lineUserId };
    updateLeadDetails(leadId, details);

    // スプレッドシート（未設定ならスキップ）
    try {
      const created = new Date().toISOString();
      await appendToSheet([
        created,                   // A:日時
        leadId,                    // B
        lineUserId || (lead.lineUserId || ''), // C
        lead.answers.desiredWork,  // D
        lead.answers.ageRange,     // E
        lead.answers.floors,       // F
        lead.answers.wallMaterial, // G
        lead.amount,               // H
        name,                      // I
        phone,                     // J
        postal,                    // K
        'ファイルはメール添付で受領' // L
      ]);
    } catch (e) {
      console.warn('[details] sheets append skipped:', e.message);
    }

    // メール（未設定ならスキップ）
    try {
      const attachments = [];
      for (const key of Object.keys(req.files || {})) {
        const file = req.files[key]?.[0];
        if (!file) continue;
        attachments.push({
          filename: file.originalname || path.basename(file.path),
          path: file.path
        });
      }

      const summaryHtml = `
        <h3>新しい見積り依頼</h3>
        <p><b>Lead ID:</b> ${leadId}</p>
        <p><b>概算見積:</b> ${Number(lead.amount).toLocaleString()} 円</p>
        <p><b>初期回答</b><br/>
          見積り希望: ${lead.answers.desiredWork}<br/>
          築年数: ${lead.answers.ageRange}<br/>
          階数: ${lead.answers.floors}<br/>
          外壁材: ${lead.answers.wallMaterial}
        </p>
        <p><b>詳細</b><br/>
          お名前: ${name}<br/>
          電話: ${phone}<br/>
          郵便番号: ${postal}
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
      console.warn('[details] mail send skipped:', e.message);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'internal error' });
  }
});

export default router;
