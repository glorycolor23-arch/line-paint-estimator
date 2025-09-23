
import { decodeJwt } from '/mini-jwt.js';
function qs(k){ return new URLSearchParams(location.search).get(k); }
async function init(){
  await liff.init({ liffId: window.LIFF_ID || '' });
  if(!liff.isLoggedIn()){ liff.login({ redirectUri: location.href }); return; }
  const token = liff.getIDToken();
  const decoded = decodeJwt(token);
  const userId = decoded?.sub;
  const form = document.getElementById('f');
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const answers = Object.fromEntries(fd.entries());
    await fetch('/api/details', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId, leadId: qs('lead'), answers }) });
    alert('送信しました。トークをご確認ください。');
  });
}
init();
