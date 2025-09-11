// routes/estimate.js
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { saveEstimateForLead } from '../store/linkStore.js';

const router = express.Router();

/**
 * 初回アンケートの保存 + 概算見積り算出
 * 期待する入力:
 * {
 *   desire: "外壁" | "屋根" | "外壁と屋根",
 *   age: "1〜5年" | "6〜10年" | ... | "31年以上",
 *   floors: "1階建て" | "2階建て" | "3階建て以上",
 *   material: "サイディング" | "モルタル" | "ALC" | "ガルバリウム" | "木" | "RC" | "その他" | "わからない"
 * }
 */
router.post('/api/estimate', async (req, res) => {
  try {
    const { desire, age, floors, material } = req.body || {};

    // 入力チェック
    if (!desire || !age || !floors || !material) {
      return res.status(400).json({ ok: false, error: 'missing fields' });
    }

    // ===== 概算計算（仮の計算式：後で係数を調整可能） =====
    const BASE = 300000; // ベース金額（円）

    const desireFactor = {
      '外壁': 1.0,
      '屋根': 0.6,
      '外壁と屋根': 1.5,
    };

    const ageFactor = {
      '1〜5年': 0.9,
      '6〜10年': 1.0,
      '11〜15年': 1.1,
      '16〜20年': 1.2,
      '21〜25年': 1.3,
      '26〜30年': 1.4,
      '31年以上': 1.5,
    };

    const floorsFactor = {
      '1階建て': 0.9,
      '2階建て': 1.0,
      '3階建て以上': 1.2,
    };

    const materialFactor = {
      'サイディング': 1.00,
      'モルタル': 1.05,
      'ALC': 1.10,
      'ガルバリウム': 1.08,
      '木': 1.15,
      'RC': 1.20,
      'その他': 1.00,
      'わからない': 1.00,
    };

    const calc =
      (desireFactor[desire] ?? 1) *
      (ageFactor[age] ?? 1) *
      (floorsFactor[floors] ?? 1) *
      (materialFactor[material] ?? 1);

    // 千円単位で丸め
    const price = Math.round((BASE * calc) / 1000) * 1000;

    // ===== リードID発行・保存 =====
    const leadId = uuidv4();

    // 後続（Webhook/プッシュ時）に参照できるよう、概算を保存
    await saveEstimateForLead(leadId, {
      price,
      summaryText: `■見積もり希望内容: ${desire}\n■築年数: ${age}\n■階数: ${floors}\n■外壁材: ${material}`,
      answers: { desire, age, floors, material },
      createdAt: new Date().toISOString(),
    });

    // （必要なら）ここでスプレッドシートやメール送信を行う実装を入れてください。
    // 例：
    // await appendInitialRowToSheet({ leadId, desire, age, floors, material, price });

    return res.status(201).json({
      ok: true,
      leadId,
      price, // 画面では使わないがデバッグ用に返す
    });
  } catch (err) {
    console.error('[POST /api/estimate ERROR]', err);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
});

export default router;
