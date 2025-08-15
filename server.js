/****************************************************
 * 外壁/屋根 カンタン見積り（画像カルーセル+LIFF修正）
 *  - 「カンタン見積りを依頼」「見積もりスタート」で開始
 *  - 画像付きカルーセル（thumbnailImageUrl）で質問を表示
 *  - LIFF ボタンは /liff/index.html に遷移（スペース混入防止）
 *  - /liff を静的配信 → Cannot GET /liff/index.html を解消
 ****************************************************/
import express from 'express';
import crypto from 'crypto';
import * as line from '@line/bot-sdk';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ---------- 環境変数 ---------- */
const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  LIFF_ID,               // 2007914959-XXXX
  PORT
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error('CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET is required.');
  process.exit(1);
}

/* LIFFの遷移先（末尾に余分なスペース等が入らないよう固定） */
const LIFF_BUTTON_URL =
  `https://line-paint.onrender.com/liff/index.html`;

/* ---------- LINE Client ---------- */
const client = new line.Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* ---------- Express ---------- */
const app = express();

/* /liff を静的配信（liff/index.html, app.js などを公開） */
app.use('/liff', express.static(path.join(__dirname, 'liff')));

/* health, liff env */
app.get('/health', (_req, res) => res.send('ok'));
app.get('/liff/env.js', (_req, res) => {
  res.type('application/javascript')
     .send(`window.__LIFF_ENV__=${JSON.stringify({ LIFF_ID })};`);
});

/* ---------- Webhook（署名検証＋生ボディ JSON化） ---------- */
app.use('/webhook', express.raw({ type: '*/*' }), (req, res, next) => {
  const signature = req.get('x-line-signature');
  const bodyBuf = req.body;
  const hmac = crypto.createHmac('sha256', CHANNEL_SECRET);
  hmac.update(bodyBuf);
  const expected = hmac.digest('base64');
  if (expected !== signature) return res.status(403).send('bad signature');
  try {
    req.body = JSON.parse(bodyBuf.toString());
  } catch {
    return res.status(400).send('invalid body');
  }
  next();
});

/* ---------- セッション（超簡易: メモリ） ---------- */
const sessions = new Map(); // userId -> {step, answers, updated}
const TTL = 30 * 60 * 1000;

function getState(uid){
  const now = Date.now();
  const s = sessions.get(uid);
  if (!s || now - s.updated > TTL) {
    const ns = { step: 0, answers: {}, updated: now };
    sessions.set(uid, ns); return ns;
  }
  s.updated = now; return s;
}
function reset(uid){ sessions.set(uid, { step:0, answers:{}, updated:Date.now() }); }

/* ---------- 送信ユーティリティ ---------- */
const t = (text)=>({ type:'text', text });
async function reply(token, m){ try{
  await client.replyMessage(token, Array.isArray(m)? m: [m]);
}catch(e){ console.error('reply err:', e?.response?.data || e);}}

/* ---------- 画像カルーセル生成 ---------- */
function img(label,color='2ecc71'){
  return `https://placehold.jp/30/${color}/ffffff/600x400.png?text=${encodeURIComponent(label)}`;
}
function carousel(title, opts){
  // opts: [{label,text,color}]
  // 1通10列制限 → 分割
  const chunks=[];
  for(let i=0;i<opts.length;i+=10) chunks.push(opts.slice(i,i+10));
  return chunks.map(chunk=>({
    type:'template',
    altText:title,
    template:{
      type:'carousel',
      columns: chunk.map(o=>({
        thumbnailImageUrl: img(o.label,o.color),
        title, text:'下のボタンから選択してください',
        actions:[{ type:'message', label:'選ぶ', text:o.text }]
      }))
    }
  }));
}

/* ---------- 質問 ---------- */
const Q1 = ()=> carousel('1/3 工事物件の階数は？',[
  {label:'1階建て', text:'1階建て'},
  {label:'2階建て', text:'2階建て'},
  {label:'3階建て', text:'3階建て'},
]);

const Q2 = ()=> carousel('2/3 物件の間取りは？',[
  {label:'1K', text:'1K'},{label:'1DK', text:'1DK'},{label:'1LDK', text:'1LDK'},
  {label:'2K', text:'2K'},{label:'2DK', text:'2DK'},{label:'2LDK', text:'2LDK'},
  {label:'3K', text:'3K'},{label:'3DK', text:'3DK'},{label:'3LDK', text:'3LDK'},
  {label:'4K', text:'4K'},{label:'4DK', text:'4DK'},{label:'4LDK', text:'4LDK'},
]);

const Q3 = ()=> carousel('3/3 物件の築年数は？',[
  {label:'新築', text:'新築', color:'3498db'},
  {label:'〜10年', text:'〜10年'},{label:'〜20年', text:'〜20年'},
  {label:'〜30年', text:'〜30年'},{label:'〜40年', text:'〜40年'},
  {label:'〜50年', text:'〜50年'},{label:'51年以上', text:'51年以上'},
  {label:'わからない', text:'わからない', color:'e67e22'},
]);

function followupFor(step){
  if(step===1) return [ t('見積もりを開始します。以下の質問にお答えください。'), ...Q1() ];
  if(step===2) return [ t('ありがとうございます。次の質問です。'), ...Q2() ];
  if(step===3) return [ t('ありがとうございます。次の質問です。'), ...Q3() ];
  if(step===9){
    const arr=[ t('ここまでの回答を受け付けました。') ];
    arr.push({
      type:'template',
      altText:'詳しい見積りをご希望の方へ',
      template:{
        type:'buttons',
        title:'詳しい見積りをご希望の方へ',
        text:'現地調査なしで、詳細な見積りをLINEでお送りします。',
        actions:[ { type:'uri', label:'現地調査なしで見積を依頼', uri: LIFF_BUTTON_URL } ]
      }
    });
    return arr;
  }
  return [ t('「カンタン見積りを依頼」と送信すると質問を開始します。') ];
}

/* ---------- Webhook ---------- */
app.post('/webhook', async (req,res)=>{
  const events = req.body.events || [];
  res.sendStatus(200);

  for(const ev of events){
    try{
      if(!ev.source?.userId) continue;
      const uid = ev.source.userId;
      const s   = getState(uid);

      // 友だち追加など
      if(ev.type==='follow' || ev.type==='join'){
        reset(uid);
        const ns = getState(uid); ns.step=1;
        await reply(ev.replyToken, followupFor(ns.step)); continue;
      }

      if(ev.type==='message' && ev.message.type==='text'){
        const text=(ev.message.text||'').trim();

        // リセット
        if(text==='はじめからやり直す' || text==='リセット'){
          reset(uid); const ns=getState(uid); ns.step=1;
          await reply(ev.replyToken, followupFor(ns.step)); continue;
        }

        // トリガー完全一致
        if(text==='カンタン見積りを依頼' || text==='見積もりスタート'){
          reset(uid); const ns=getState(uid); ns.step=1;
          await reply(ev.replyToken, followupFor(ns.step)); continue;
        }

        // 回答
        if(s.step===1){
          if(['1階建て','2階建て','3階建て'].includes(text)){
            s.answers.q1=text; s.step=2;
            await reply(ev.replyToken, [ t(`「${text}」で承りました。`), ...followupFor(s.step) ]);
            continue;
          }
        }else if(s.step===2){
          const list=['1K','1DK','1LDK','2K','2DK','2LDK','3K','3DK','3LDK','4K','4DK','4LDK'];
          if(list.includes(text)){
            s.answers.q2=text; s.step=3;
            await reply(ev.replyToken, [ t(`「${text}」で承りました。`), ...followupFor(s.step) ]);
            continue;
          }
        }else if(s.step===3){
          const list=['新築','〜10年','〜20年','〜30年','〜40年','〜50年','51年以上','わからない'];
          if(list.includes(text)){
            s.answers.q3=text; s.step=9;
            await reply(ev.replyToken, [ t(`「${text}」で承りました。`), ...followupFor(s.step) ]);
            continue;
          }
        }

        // その他の入力
        await reply(ev.replyToken, t('カードの「選ぶ」ボタンからお答えください。'));
        continue;
      }

      // 画像などが送られてきた場合
      if(ev.type==='message' && ev.message.type!=='text'){
        await reply(ev.replyToken, t('メッセージを受信しました。カードの「選ぶ」から操作してください。'));
      }

    }catch(e){ console.error('event error:', e?.response?.data || e); }
  }
});

/* ---------- 起動 ---------- */
const p = PORT || 10000;
app.listen(p, ()=> console.log(`listening on ${p}`));
