// routes/details.js
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { getEstimateForLead } from "../store/linkStore.js";
import { appendToSheet } from "../lib/sheets.js";
import { sendAdminMail } from "../lib/mailer.js";

const router = express.Router();

// Renderの一時ディスクに保存（メール添付後に削除推奨）
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB/ファイル
});

// drawings: 立面図/平面図/断面図, photos: 正面/右/左/背面
const fields = [
  { name: "drawing_elevation", maxCount: 1 },
  { name: "drawing_plan", maxCount: 1 },
  { name: "drawing_section", maxCount: 1 },
  { name: "photo_front", maxCount: 1 },
  { name: "photo_right", maxCount: 1 },
  { name: "photo_left", maxCount: 1 },
  { name: "photo_back", maxCount: 1 },
];

router.post("/api/details", upload.fields(fields), async (req, res) => {
  try {
    const { leadId, name, phone, postal, lineUserId } = req.body || {};
    if (!leadId) return res.status(400).json({ error: "leadId required" });

    // 初回アンケート＋概算
    const est = await getEstimateForLead(leadId);
    if (!est) return res.status(404).json({ error: "lead not found" });

    // スプレッドシートに追加
    const created = new Date().toISOString();
    await appendToSheet([
      created,                                  // A:日時
      leadId,                                   // B
      lineUserId || "",                         // C: LINE userId（任意）
      est.answers?.desiredWork || "-",          // D
      est.answers?.ageRange || "-",             // E
      est.answers?.floors || "-",               // F
      est.answers?.wallMaterial || "-",         // G
      est.price ?? "",                          // H: 概算金額
      name || "",                               // I
      phone || "",                              // J
      postal || "",                             // K
      "ファイルはメール添付で受領",              // L
    ]);

    // メール添付作成
    const attachments = [];
    for (const key of Object.keys(req.files || {})) {
      const file = req.files[key]?.[0];
      if (!file) continue;
      attachments.push({
        filename: file.originalname || path.basename(file.path),
        path: file.path,
      });
    }

    const summaryHtml = `
      <h3>新しい見積り依頼</h3>
      <p><b>Lead ID:</b> ${leadId}</p>
      <p><b>概算見積:</b> ${Number(est.price ?? 0).toLocaleString("ja-JP")} 円</p>
      <p><b>初期回答</b><br/>
        見積り希望: ${est.answers?.desiredWork || "-"}<br/>
        築年数: ${est.answers?.ageRange || "-"}<br/>
        階数: ${est.answers?.floors || "-"}<br/>
        外壁材: ${est.answers?.wallMaterial || "-"}
      </p>
      <p><b>詳細</b><br/>
        お名前: ${name || ""}<br/>
        電話: ${phone || ""}<br/>
        郵便番号: ${postal || ""}
      </p>
      <p>図面・写真は添付ファイルをご確認ください。</p>
    `;

    await sendAdminMail({
      subject: `【見積依頼】Lead ${leadId} / ${name || "名無し"}`,
      text: `Lead ${leadId} 概算: ${est.price}円`,
      html: summaryHtml,
      attachments,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
