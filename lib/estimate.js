// ★ここが仮の概算見積ロジック（後で差し替えやすい形に分離）
// answers = { desiredWork, ageRange, floors, wallMaterial }
// desiredWork: "外壁塗装" | "屋根工事" | "外壁塗装と屋根工事"
// ageRange: "1〜5年" | ... | "31年以上"
// floors: "1階建て" | "2階建て" | "3階建て以上"
// wallMaterial: "サイディング" | "モルタル" | ... | "わからない"

const BASE = {
  "外壁塗装": 600000,
  "屋根工事": 300000,
  "外壁塗装と屋根工事": 850000
};

const AGE_COEF = {
  "1〜5年": 0.9,
  "6〜10年": 1.0,
  "11〜15年": 1.1,
  "16〜20年": 1.2,
  "21〜25年": 1.3,
  "26〜30年": 1.4,
  "31年以上": 1.5
};

const FLOOR_ADD = {
  "1階建て": 0,
  "2階建て": 200000,
  "3階建て以上": 450000
};

const WALL_ADJ = {
  "サイディング": 1.0,
  "モルタル": 1.05,
  "ALC": 1.1,
  "ガルバリウム": 1.15,
  "木": 1.12,
  "RC": 1.2,
  "その他": 1.05,
  "わからない": 1.07
};

export function computeEstimate(answers) {
  const base = BASE[answers.desiredWork] || 600000;
  const coefAge = AGE_COEF[answers.ageRange] || 1.0;
  const addFloor = FLOOR_ADD[answers.floors] || 0;
  const adjWall = WALL_ADJ[answers.wallMaterial] || 1.0;

  let amount = Math.round((base * coefAge + addFloor) * adjWall);
  // キリよく調整（万単位に丸め）
  amount = Math.round(amount / 10000) * 10000;
  return amount;
}

// ★計算式を変更したい場合：上記テーブルや計算式を差し替えてください。