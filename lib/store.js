import { v4 as uuidv4 } from 'uuid';

// 本番はRedis/DBに置き換え推奨
const leads = new Map(); // leadId -> { answers, amount, lineUserId, timestamps... }

export function createLead(answers, amount) {
  const leadId = uuidv4();
  leads.set(leadId, { answers, amount, createdAt: new Date().toISOString() });
  return leadId;
}

export function getLead(leadId) {
  return leads.get(leadId);
}

export function linkLineUser(leadId, lineUserId) {
  const lead = leads.get(leadId);
  if (!lead) return null;
  lead.lineUserId = lineUserId;
  lead.linkedAt = new Date().toISOString();
  leads.set(leadId, lead);
  return lead;
}

export function updateLeadDetails(leadId, details) {
  const lead = leads.get(leadId);
  if (!lead) return null;
  lead.details = { ...(lead.details || {}), ...details };
  lead.detailsUpdatedAt = new Date().toISOString();
  leads.set(leadId, lead);
  return lead;
}