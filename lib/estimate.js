// lib/estimate.js
// 仮の概算見積もり計算（後でテーブルを差し替えればOK）
// answers = { target, age, floors, material }
// target: 'wall'|'roof'|'both'
// age: '1-5'|'6-10'|'11-15'|'16-20'|'21-25'|'26-30'|'31+'
// floors: '1'|'2'|'3+'
// material: 'siding'|'mortar'|'alc'|'galvalume'|'wood'|'rc'|'other'|'unknown'

const BASE = { wall: 600000, roof: 300000, both: 850000 };
const AGE_COEF = {
  '1-5': 0.9, '6-10': 1.0, '11-15': 1.05, '16-20': 1.1,
  '21-25': 1.15, '26-30': 1.2, '31+': 1.25
};
const FLOOR_ADD = { '1': 0, '2': 120000, '3+': 240000 };
const MAT_ADJ = {
  siding: 1.0, mortar: 1.05, alc: 1.1, galvalume: 1.08,
  wood: 1.1, rc: 1.15, other: 1.05, unknown: 1.0
};

export function computeEstimate(answers = {}) {
  const base = BASE[answers.target] ?? 600000;
  const coef = AGE_COEF[answers.age] ?? 1.0;
  const add  = FLOOR_ADD[answers.floors] ?? 0;
  const adj  = MAT_ADJ[answers.material] ?? 1.0;
  let amount = Math.round((base * coef + add) * adj);
  amount = Math.round(amount / 10000) * 10000;
  return amount;
}
