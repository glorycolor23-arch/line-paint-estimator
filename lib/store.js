
import fs from 'fs';
const DATA_PATH = './store/store.json';
function read(){ try{ return JSON.parse(fs.readFileSync(DATA_PATH,'utf-8')); }catch(e){ return {links:{}, estimates:{}, pending:{}, details:{}}; } }
function write(d){ try{ fs.writeFileSync(DATA_PATH, JSON.stringify(d,null,2)); }catch(e){} }

export function saveLink(userId, leadId){ const db=read(); db.links[userId]=leadId; write(db); }
export function findLeadByUser(userId){ return read().links[userId] || null; }
export function savePending(userId, leadId){ const db=read(); db.pending[userId]=leadId; write(db); }
export function pickPending(userId){ const db=read(); const v=db.pending[userId]||null; if(v){ delete db.pending[userId]; write(db);} return v; }
export function saveEstimate(leadId, est){ const db=read(); db.estimates[leadId]=est; write(db); }
export function getEstimate(leadId){ return read().estimates[leadId] || null; }
export function saveDetails(leadId, d){ const db=read(); db.details[leadId]=d; write(db); }
