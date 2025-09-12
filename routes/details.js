// routes/details.js
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { appendToSheet } from "../lib/sheets.js";
import { sendAdminMail } from "../lib/mailer.js";
import { CONFIG } from "../config.js";

const router = express.Router();

// アップロード（10MB/ファイル）
const upload = multer({ dest: "uploads/", limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/details
router.post("/api/details", upload.fields([
  { name: "drawing_elevation", maxCount: 1 },
  { name: "drawing_plan",      maxCount: 1 },
  { name: "drawing_section",   maxCount: 1 },
  { name: "photo_front",       maxCount: 1 },
  { name: "photo_right",       maxCount: 1 },
  { name: "photo_left",        maxCount: 1 },
  { name: "photo_back",        maxCount: 1 },
]), async (req, res) => {
  try {
    const {
      leadId = "",
      lineUserId = "",
      name = "",
      phone = "",
      postal = "",
    } = req.body || {};

    // スプレッドシートへ追記
    const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    await appendToSheet([
      now,               // A:日時
      leadId,            // B:leadId（state）
      lineUserId,        // C:LINE userId（LIFF で取得していれば）
      "", "", "", "",    // D-G: 初期アンケート（ここでは空。必要なら state を使って復元可能）
      "",                // H: 概算金額（同上）
      name,              // I
      phone,             // J
      postal,            // K
      "ファイル受領: メール添付を確認" // L 以降メモ
    ]);

    // 管理者メール送信（添付）
    const files = [];
    for (const key of Object.keys(req.files || {})) {
      const f = req.files[key]?.[0];
      if (!f) continue;
      files.push({ filename: f.originalname || path.basename(f.path), path: f.path });
    }

    const subject = "【外壁塗装】詳細見積もりの新規依頼";
    const html = `
      <h2>詳細見積もりの依頼が届きました</h2>
      <ul>
        <li>leadId: ${leadId}</li>
        <li>LINE userId: ${lineUserId}</li>
        <li>氏名: ${name}</li>
        <li>電話: ${phone}</li>
        <li>郵便: ${postal}</li>
      </ul>
      <p>図面・写真はメール添付ファイルをご確認ください。</p>
    `;

    await sendAdminMail({ subject, html, text: html.replace(/<[^>]+>/g, ""), attachments: files });

    // 後始末（任意）
    try {
      for (const a of files) fs.unlink(a.path, ()=>{});
    } catch(_e) {}

    return res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/details] error", e);
    return res.status(500).json({ ok: false, error: "DETAILS_FAILED" });
  }
});

export default router;
