
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { computeEstimate } from './lib/estimateCore.js';
import { saveEstimate } from './lib/store.js';

const router = Router();

router.post('/', (req,res)=>{
  try{
    let { leadId, answers } = req.body || {};
    if(!leadId) leadId = uuidv4();
    const est = computeEstimate(answers||{});
    saveEstimate(leadId, est);
    res.json({ ok:true, leadId });
  }catch(e){ console.error(e); res.status(500).json({ ok:false, error:e.message }); }
});

export default router;
