// routes/details.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

import { updateLeadDetails, getLead } from '../lib/store.js';
import { appendToSheet } from '../lib/sheets.js';
import { sendAdminMail } from '../lib/mailer.js';
import { CONFIG } from '../src/config.js';

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
    const { leadId, name, phone, postal, address, lineUserId, desiredWork, floors, ageRange, wallMaterial, roofMaterial } = req.body || {};
    
    // leadIdがある場合はleadを取得、ない場合は新規として処理
    let lead = null;
    if (leadId) {
      lead = getLead(leadId);
      if (lead) {
        updateLeadDetails(leadId, { name, phone, postal, address, lineUserId });
      }
    }

    // スプレッドシート：失敗しても処理続行（ログのみ）
    try {
      const created = new Date().toISOString();
      await appendToSheet([
        created,                   // A:日時
        leadId || '新規',                    // B
        lineUserId || (lead?.lineUserId || ''), // C
        lead?.answers?.desiredWork || '',  // D
        lead?.answers?.ageRange || '',     // E
        lead?.answers?.floors || '',       // F
        lead?.answers?.wallMaterial || '', // G
        lead?.amount || '',                // H
        name || '', phone || '', postal || '', // I,J,K
        'ファイルはメール添付で受領' // L
      ]);
    } catch (e) {
      console.error('[details] appendToSheet failed (non-fatal):', e);
    }

    // メール：失敗しても処理続行（ログのみ）
    try {
      const attachments = [];
      console.log('[details] req.files keys:', Object.keys(req.files || {}));
      for (const key of Object.keys(req.files || {})) {
        const f = req.files[key]?.[0];
        if (f) {
          const originalFilename = f.originalname || path.basename(f.path);
          // ファイル名にフィールド名のプレフィックスを追加してユニークにする
          const uniqueFilename = `${key}_${originalFilename}`;
          console.log('[details] Adding attachment:', key, originalFilename, '-> unique name:', uniqueFilename);
          attachments.push({ filename: uniqueFilename, path: f.path });
        }
      }
      console.log('[details] Total attachments:', attachments.length);

      const now = new Date();
      const dateStr = now.toLocaleString('ja-JP', { 
        year: 'numeric', month: '2-digit', day: '2-digit', 
        hour: '2-digit', minute: '2-digit', second: '2-digit' 
      });
      
      // LINEユーザー紐付け情報：LINE表示名を取得
      let lineDisplayName = '';
      if (lineUserId && CONFIG.LINE_CHANNEL_ACCESS_TOKEN) {
        try {
          const profileRes = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
            headers: { 'Authorization': `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}` }
          });
          if (profileRes.ok) {
            const profile = await profileRes.json();
            lineDisplayName = profile.displayName || '';
          }
        } catch (err) {
          console.error('[details] Failed to get LINE profile:', err);
        }
      }
      
      let lineInfo = name || '名無し';
      if (lineDisplayName) {
        lineInfo += ` (LINE表示名: ${lineDisplayName})`;
      }
      
      const summaryHtml = `
        <h3>以下の内容で見積もりの依頼が入っています。</h3>
        <p>内容を確認後見積もりをLINEで回答してください。</p>
        
        <p><b>・送信日時</b><br/>${dateStr}</p>
        
        <p><b>・お名前</b><br/>${name || ''}</p>
        <p><b>・電話番号</b><br/>${phone || ''}</p>
        <p><b>・郵便番号</b><br/>${postal || ''}</p>
        <p><b>・住所</b><br/>${address || ''}</p>
        
        <h4>■見積もり内容</h4>
        <p><b>・見積もり希望内容</b><br/>${desiredWork || lead?.answers?.desiredWork || '（未回答）'}</p>
        <p><b>・階数</b><br/>${floors || lead?.answers?.floors || '（未回答）'}</p>
        <p><b>・築年数</b><br/>${ageRange || lead?.answers?.ageRange || '（未回答）'}</p>
        <p><b>・現在の外壁材</b><br/>${wallMaterial || lead?.answers?.wallMaterial || '（未回答）'}</p>
        <p><b>・現在の屋根材</b><br/>${roofMaterial || '（未回答）'}</p>
        ${lead ? `<p><b>・概算見積金額</b><br/>${Number(lead.amount).toLocaleString('ja-JP')}円</p>` : ''}
        
        <p>図面や立面図は添付ファイルで確認をお願いします。</p>
        
        <p><b>・LINE表示名</b><br/>${lineDisplayName || '（取得失敗）'}</p>
        
        <p><b>・LINE回答URL</b><br/>
        <a href="https://chat.line.biz/Ucb376adbb2ec65df69e70589da64dd15/">https://chat.line.biz/Ucb376adbb2ec65df69e70589da64dd15/</a></p>
      `;

      await sendAdminMail({
        subject: `外壁塗装LINEから見積もり依頼が入りました。`,
        text: `${name || '名無し'}さまから見積もり依頼が入りました。`,
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
