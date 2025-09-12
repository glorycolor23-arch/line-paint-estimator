// lib/estimate.js
// === 概算見積の簡易ロジック ===
// answers = { desiredWork, ageRange, floors, wallMaterial }

const BASE = {
  "外壁": 600000,
  "屋根": 300000,
  "外壁と屋根": 850000,
};

const AGE_COEF = {
  "1〜5年":   0.90,
  "6〜10年":  1.00,
  "11〜15年": 1.05,
  "16〜20年": 1.10,
  "21〜25年": 1.15,
  "26〜30年": 1.20,
  "31年以上": 1.25,
};

const FLOOR_ADD = {
  "1階建て":     0,
  "2階建て":  80000,
  "3階建て以上": 160000,
};

const WALL_ADJ = {
  "サイディング": 1.00,
  "モルタル":   1.05,
  "ALC":       1.10,
  "ガルバリウム": 1.15,
  "木":        1.12,
  "RC":        1.20,
  "その他":     1.05,
  "わからない": 1.07,
};

export function computeEstimate(answers) {
  const base     = BASE[answers.desiredWork]     ?? 600000;
  const coefAge  = AGE_COEF[answers.ageRange]    ?? 1.0;
  const addFloor = FLOOR_ADD[answers.floors]     ?? 0;
  const adjWall  = WALL_ADJ[answers.wallMaterial]?? 1.0;

  let amount = Math.round((base * coefAge + addFloor) * adjWall);
  // 万単位に丸め
  amount = Math.round(amount / 10000) * 10000;
  return amount;
}
