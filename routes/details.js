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
    const { leadId, name, phone, postal, lineUserId, needsPaint, needsRoof, paintType, roofWorkType, buildingAge, buildingFloors, wallMaterial } = req.body || {};
    console.log('[details] Received request:', { leadId, name, phone, postal, needsPaint, needsRoof, paintType, roofWorkType, buildingAge, buildingFloors, wallMaterial });
    const lead = getLead(leadId);
    if (!lead) {
      console.warn('[details] lead not found', { leadId });
      return res.status(404).json({ error: 'lead not found' });
    }
    console.log('[details] Lead found:', lead);

    updateLeadDetails(leadId, { name, phone, postal, lineUserId });

    // スプレッドシート：失敗しても処理続行（ログのみ）
    try {
      const created = new Date().toISOString();
      await appendToSheet([
        created,                   // A:日時
        leadId,                    // B
        lineUserId || (lead.lineUserId || ''), // C
        name || '', phone || '', postal || '', // D,E,F
        needsPaint === 'true' ? '希望する' : '希望しない', // G:外壁塗装
        paintType || '',                  // H:希望の塗料
        needsRoof === 'true' ? '希望する' : '希望しない', // I:屋根工事
        roofWorkType || '',               // J:希望の工事内容
        buildingAge || '',                // K:築年数
        buildingFloors || '',             // L:階数
        wallMaterial || '',               // M:外壁材
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

      const paintLabels = {
        'acrylic': 'コスト重視(アクリル系またはウレタン系塗料)',
        'silicon': 'バランス重視(シリコン系塗料)',
        'fluorine': '高耐久＋機能付き(フッ素系/無機系/ラジカル制御塗料)',
        'thermal': '機能重視(遮熱・断熱塗料)'
      };
      const roofLabels = {
        'painting': '屋根塗装',
        'cover': 'カバー工法(重ね葵き)',
        'replacement': '葵き替え(全面交換)',
        'repair': '部分修理・補修',
        'insulation': '断熱・遮熱リフォーム'
      };

      const summaryHtml = `
        <h3>新しい見積り依頼</h3>
        <p><b>Lead ID:</b> ${leadId}</p>
        <p><b>お名前:</b> ${name || ''}</p>
        <p><b>電話:</b> ${phone || ''}</p>
        <p><b>郵便番号:</b> ${postal || ''}</p>
        <hr/>
        <p><b>外壁塗装:</b> ${needsPaint === 'true' ? '希望する' : '希望しない'}</p>
        ${needsPaint === 'true' ? `<p><b>希望の塗料:</b> ${paintLabels[paintType] || paintType || '未選択'}</p>` : ''}
        <p><b>屋根工事:</b> ${needsRoof === 'true' ? '希望する' : '希望しない'}</p>
        ${needsRoof === 'true' ? `<p><b>希望の工事内容:</b> ${roofLabels[roofWorkType] || roofWorkType || '未選択'}</p>` : ''}
        <hr/>
        <p><b>築年数:</b> ${buildingAge || ''}</p>
        <p><b>階数:</b> ${buildingFloors || ''}</p>
        <p><b>外壁材:</b> ${wallMaterial || ''}</p>
        <hr/>
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
    console.error('[details] error stack:', e.stack);
    return res.status(500).json({ error: 'internal error: ' + e.message });
  }
});

export default router;
