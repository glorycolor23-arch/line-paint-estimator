// store/linkStore.js
// 簡易インメモリ実装（Render再起動で消える）。本番はDBに置き換え推奨。

const userToLead = new Map();     // userId -> leadId
const leadToEstimate = new Map(); // leadId -> { price, summaryText }
const pendingByUser = new Map();  // userId -> leadId（未フォロー時の保留）

export async function saveLink(userId, leadId) {
  userToLead.set(userId, leadId);
}

export async function findLeadIdByUserId(userId) {
  return userToLead.get(userId);
}

export async function saveEstimateForLead(leadId, estimateObj) {
  leadToEstimate.set(leadId, estimateObj);
}

export async function getEstimateForLead(leadId) {
  return leadToEstimate.get(leadId) || null;
}

export async function markPendingPush(userId, leadId) {
  pendingByUser.set(userId, leadId);
}

export async function pickPendingForUser(userId) {
  const lead = pendingByUser.get(userId);
  if (lead) pendingByUser.delete(userId);
  return lead || null;
}

// 既に友だちかの判定は環境により異なるため、ここでは常に true を返してもよい。
// チャット履歴などで判定したい場合は外部に保存してください。
export async function isFriendKnown(_userId) {
  return true; // 簡易実装：常に true（= 既に友だちとみなす）
}
