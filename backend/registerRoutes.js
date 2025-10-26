import { Router } from 'express';
import { middleware as lineMiddleware } from '@line/bot-sdk';
import estimateRouter from './estimate.js';
import detailsRouter from './details.js';
import lineLoginRouter from './lineLogin.js';
import { client, liffButtonMessage } from './lib/lineClient.js';
import { findLeadByUser, pickPending, getEstimate } from './lib/store.js';

export function registerBackendRoutes(app) {
  // Webhook (before any body parsers)
  const webhookRouter = Router();
  const signatureMw = lineMiddleware({ channelSecret: process.env.LINE_CHANNEL_SECRET });
  webhookRouter.post('/webhook', signatureMw, async (req, res) => {
    const events = req.body?.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  });
  app.use('/line', webhookRouter);

  // APIs
  app.use('/api/estimate', estimateRouter);
  app.use('/api/details', detailsRouter);
  app.use('/auth/line', lineLoginRouter);

  // Serve LIFF page to avoid "Cannot GET /liff/index.html"
  app.get('/liff/index.html', (_req, res) => {
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>詳細見積もり</title></head>
<body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, Noto Sans JP, sans-serif; padding: 16px;">
<h2>詳細見積もり</h2>
<p>以下をご入力ください。送信後、確認メッセージがLINEに届きます。</p>
<form id="f">
  <label>外壁の劣化状況:
    <select name="degrade">
      <option value="light">軽度</option>
      <option value="mid">中度</option>
      <option value="heavy">重度</option>
    </select>
  </label><br/><br/>
  <label>築年数: <input name="age" type="number" min="1" max="80" value="15"/></label><br/><br/>
  <label>連絡先メール: <input name="email" type="email" placeholder="you@example.com"/></label><br/><br/>
  <button type="submit">送信</button>
</form>
<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script>
function decodeJwt(t){ try{ const p=t.split('.')[1]; const s=atob(p.replace(/-/g,'+').replace(/_/g,'/')); return JSON.parse(decodeURIComponent(escape(s))); }catch(e){ return null; } }
function qs(k){ return new URLSearchParams(location.search).get(k); }
(async function init(){
  await liff.init({ liffId: (window.LIFF_ID||'') });
  if(!liff.isLoggedIn()){ liff.login({ redirectUri: location.href }); return; }
  const token = liff.getIDToken();
  const userId = (decodeJwt(token)||{}).sub;
  const form = document.getElementById('f');
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const answers = Object.fromEntries(fd.entries());
    const resp = await fetch('/api/details', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId, leadId: qs('lead'), answers }) });
    if(resp.ok){ alert('送信しました。トークをご確認ください。'); } else { alert('送信に失敗しました。'); }
  });
})();</script>
</body></html>`;
    res.set('Content-Type','text/html; charset=utf-8').send(html);
  });

  // Webhook error guard
  app.use('/line', (err, req, res, _next) => {
    console.error('Webhook error:', err);
    res.status(200).end();
  });
}

async function handleEvent(event) {
  try {
    if (event.type === 'follow') {
      const userId = event.source.userId;
      let leadId = findLeadByUser(userId) || pickPending(userId);
      if (!leadId) {
        await client.pushMessage(userId, { type: 'text', text: '友だち追加ありがとうございます。はじめにアンケートへご回答ください。' });
        return;
      }
      const est = getEstimate(leadId);
      if (!est) {
        await client.pushMessage(userId, { type: 'text', text: '概算見積もりを計算しています。少々お待ちください。' });
        return;
      }
      await client.pushMessage(userId, { type: 'text', text: est.text });
      const urlBase = process.env.LIFF_URL || (process.env.BASE_URL || '') + '/liff/index.html';
      const url = `${urlBase}?lead=${encodeURIComponent(leadId)}`;
      await client.pushMessage(userId, liffButtonMessage(url));
      return;
    }
    if (event.type === 'message' && event.message.type === 'text') {
      const txt = (event.message.text || '').trim();
      if (txt.includes('詳細')){
        const userId = event.source.userId;
        const leadId = findLeadByUser(userId);
        const urlBase = process.env.LIFF_URL || (process.env.BASE_URL || '') + '/liff/index.html';
        const url = `${urlBase}${leadId?`?lead=${encodeURIComponent(leadId)}`:''}`;
        await client.replyMessage(event.replyToken, [
          { type:'text', text:'こちらから詳細見積もりをご確認ください。' },
          liffButtonMessage(url)
        ]);
      }
    }
  } catch (e) { console.error('handleEvent error', e); }
}
