/* =========================================================
 * server.js  完全版（最終ステップでの停止を解消）
 * ========================================================= */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client, middleware as lineMiddleware } from '@line/bot-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---- LINE 設定 -------------------------------------------------------------
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[FATAL] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です');
  process.exit(1);
}
const client = new Client(config);

// ---- Express ---------------------------------------------------------------
const app = express();
app.get('/health', (_, res) => res.status(200).send('ok'));

// LIFF 静的配信
app.use('/liff', express.static(path.join(__dirname, 'liff'), { index: 'index.html' }));

// フロント用環境JS
app.get('/liff/env.js', (req, res) => {
  const liffId   = process.env.LIFF_ID || '';
  const addUrl   = process.env.FRIEND_ADD_URL || '';
  const mailUrl  = process.env.EMAIL_WEBAPP_URL || '';
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.status(200).send(
    `window.ENV={LIFF_ID:${JSON.stringify(liffId)},FRIEND_ADD_URL:${JSON.stringify(addUrl)},EMAIL_WEBAPP_URL:${JSON.stringify(mailUrl)}};`
  );
});

/* Webhook: 署名検証前に rawBody を確保 */
app.use('/webhook', express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString(); }
}));

/* LINE middleware（署名検証） */
app.post('/webhook', lineMiddleware(config), async (req, res) => {
  res.status(200).end('OK');
  try {
    for (const ev of (req.body.events || [])) await handleEvent(ev);
  } catch (e) {
    console.error('[webhook error]', e);
  }
});

// その他 API で使う JSON パーサ
app.use(express.json());

/* ===========================================================================
 * 質問フロー
 * ======================================================================== */
const sessions = new Map(); // {userId: {answers:{}, last:{q,v}, step:number}}

const IMG = 'https://via.placeholder.com/1024x512.png?text=%E9%81%B8%E6%8A%9E';

// トリガー/コマンド
const TRIGGER_START = ['カンタン見積りを依頼'];
const CMD_RESET     = ['リセット','はじめからやり直す'];
const CMD_RESULT    = ['見積り結果']; // 手動再配信

const QUESTIONS = [
  { id:'q1_floors',  title:'工事物件の階数は？', options:['1階建て','2階建て','3階建て'] },
  { id:'q2_layout',  title:'物件の間取りは？', options:['1K','1DK','1LDK','2K','2DK','2LDK','3K','3DK','4K','4DK','4LDK'] },
  { id:'q3_age',     title:'物件の築年数は？', options:['新築','〜10年','〜20年','〜30年','〜40年','〜50年','51年以上'] },
  { id:'q4_painted', title:'過去に塗装をした経歴は？', options:['ある','ない','わからない'] },
  { id:'q5_last',    title:'前回の塗装はいつ頃？', options:['〜5年','5〜10年','10〜20年','20〜30年','わからない'] },
  { id:'q6_work',    title:'ご希望の工事内容は？', options:['外壁塗装','屋根塗装','外壁塗装+屋根塗装'] },
  { id:'q7_wall',    title:'外壁の種類は？（外壁を選んだ場合）', options:['モルタル','サイディング','タイル','ALC'],
                      conditional:(a)=> (a.q6_work||'').includes('外壁') },
  { id:'q8_roof',    title:'屋根の種類は？（屋根を選んだ場合）', options:['瓦','スレート','ガルバリウム','トタン'],
                      conditional:(a)=> (a.q6_work||'').includes('屋根') },
  { id:'q9_leak',    title:'雨漏りや漏水の症状はありますか？', options:['雨の日に水滴が落ちる','天井にシミがある','ない'] },
  { id:'q10_dist',   title:'隣や裏の家との距離は？（周囲で一番近い距離）', options:['30cm以下','50cm以下','70cm以下','70cm以上'] },
];

// 概算計算（ダミー）
function calcRoughPrice(a){
  let base = 1000000;
  if ((a.q1_floors||'').includes('2')) base += 150000;
  if ((a.q1_floors||'').includes('3')) base += 300000;
  if ((a.q6_work||'').includes('屋根')) base += 180000;
  if ((a.q6_work||'').includes('外壁')) base += 220000;
  if ((a.q7_wall||'').includes('タイル')) base += 120000;
  if ((a.q9_leak||'') !== 'ない') base += 90000;
  return Math.round(base/1000)*1000;
}

// 安全送信（結果: true/false）
async function safeReply(replyToken, messages){
  try{
    await client.replyMessage(replyToken, Array.isArray(messages)?messages:[messages]);
    return true;
  }catch(err){
    console.error('[safeReply error]', JSON.stringify(err?.response?.data || err?.message || err, null, 2));
    return false;
  }
}
async function safePush(to, messages){
  try{
    await client.pushMessage(to, Array.isArray(messages)?messages:[messages]);
    return true;
  }catch(err){
    console.error('[safePush error]', JSON.stringify(err?.response?.data || err?.message || err, null, 2));
    return false;
  }
}

// Flex
function buildOptionsFlex(title, qid, opts){
  return {
    type:'flex',
    altText:title,
    contents:{
      type:'carousel',
      contents:opts.map(v=>({
        type:'bubble',
        hero:{ type:'image', url:IMG, size:'full', aspectRatio:'16:9', aspectMode:'cover' },
        body:{ type:'box', layout:'vertical', contents:[{ type:'text', text:v, weight:'bold', size:'lg', wrap:true }] },
        footer:{
          type:'box', layout:'vertical', contents:[
            { type:'button', style:'primary',
              action:{ type:'postback', label:'選ぶ',
                       data:JSON.stringify({t:'answer', q:qid, v}), displayText:v } }
          ]
        }
      }))
    }
  };
}
function summarize(a){
  return [
    `・階数: ${a.q1_floors||'—'} / 間取り: ${a.q2_layout||'—'} / 築年数: ${a.q3_age||'—'}`,
    `・過去塗装: ${a.q4_painted||'—'} / 前回から: ${a.q5_last||'—'}`,
    `・工事内容: ${a.q6_work||'—'} / 外壁: ${a.q7_wall||'—'} / 屋根: ${a.q8_roof||'—'}`,
    `・雨漏り: ${a.q9_leak||'—'} / 距離: ${a.q10_dist||'—'}`
  ].join('\n');
}
function buildEstimateFlex(price){
  return {
    type:'flex',
    altText:'概算見積り',
    contents:{
      type:'bubble',
      body:{ type:'box', layout:'vertical', spacing:'md', contents:[
        { type:'text', text:'見積り金額', weight:'bold', size:'md' },
        { type:'text', text:`￥${price.toLocaleString()}`, weight:'bold', size:'xl' },
        { type:'text', text:'上記はご入力内容を元に算出した概算です。', size:'sm', color:'#666', wrap:true },
      ]},
      footer:{ type:'box', layout:'vertical', spacing:'md', contents:[
        { type:'text', text:'正式なお見積りが必要な方は続けてご入力ください。', size:'sm', wrap:true },
        { type:'button', style:'primary',
          action:{ type:'uri', label:'現地調査なしで見積を依頼', uri:'https://line-paint.onrender.com/liff/index.html' } }
      ]}
    }
  };
}

// 今の出題 index
function currentIndex(ans){
  let idx=0;
  for(let i=0;i<QUESTIONS.length;i++){
    const q = QUESTIONS[i];
    if (q.conditional && !q.conditional(ans)) continue;
    if (!ans[q.id]) return i;
    idx = i+1;
  }
  return idx;
}

// 次の質問 or 最終結果
async function sendNext(userId, replyToken=null){
  const sess = sessions.get(userId) || {answers:{}, step:0};
  const idx = currentIndex(sess.answers);

  // ----- 最終 -----
  if (idx >= QUESTIONS.length){
    // まず即時に「作成中」返信（replyToken 可用なら）
    if (replyToken) await safeReply(replyToken, { type:'text', text:'概算を作成中です。数秒お待ちください。' });

    const price = calcRoughPrice(sess.answers);
    const msgs  = [
      { type:'text', text:'ありがとうございます。概算を作成しました。' },
      { type:'text', text:`【回答の確認】\n${summarize(sess.answers)}` },
      buildEstimateFlex(price),
    ];

    const ok = await safePush(userId, msgs);  // push で必ず配信
    if (ok) {
      sessions.delete(userId);                // 送達成功のみ削除
    } else {
      // 失敗時はセッション保持。ユーザーから「見積り結果」で再送可能。
      await safePush(userId, { type:'text', text:'ネットワークの都合で送信に失敗しました。「見積り結果」と入力すると再送します。' });
    }
    return;
  }

  // ----- 途中 -----
  const q = QUESTIONS[idx];
  const messages = [
    { type:'text', text:q.title },
    buildOptionsFlex(q.title, q.id, q.options),
  ];

  if (replyToken) await safeReply(replyToken, messages);
  else            await safePush(userId,   messages);
}

// 停止確認
async function confirmStop(userId){
  const t = {
    type:'template',
    altText:'見積りを停止しますか？',
    template:{
      type:'confirm', text:'見積りを停止しますか？',
      actions:[
        { type:'postback', label:'はい',   data:JSON.stringify({t:'stop',v:'yes'}), displayText:'はい' },
        { type:'postback', label:'いいえ', data:JSON.stringify({t:'stop',v:'no'}),  displayText:'いいえ' }
      ]
    }
  };
  await safePush(userId, t);
}

// イベント処理
async function handleEvent(ev){
  const userId = ev.source?.userId;
  if (!userId) return;

  if (!sessions.has(userId)) sessions.set(userId, {answers:{}, last:{}, step:0});
  const sess = sessions.get(userId);

  // postback
  if (ev.type === 'postback'){
    let data = {};
    try{ data = JSON.parse(ev.postback.data||'{}'); }catch{}
    if (data.t === 'answer'){
      // 重複防止：同じ質問に同じ値を連打されたら無視して次へ
      if (sess.last?.q === data.q && sess.last?.v === data.v){
        await sendNext(userId, ev.replyToken);
        return;
      }
      sess.answers[data.q] = data.v;
      sess.last = { q:data.q, v:data.v };
      await sendNext(userId, ev.replyToken);
      return;
    }
    if (data.t === 'stop'){
      if (data.v === 'yes'){
        sessions.delete(userId);
        await safeReply(ev.replyToken, { type:'text', text:'見積りを停止しました。通常のトークができます。' });
      }else{
        await safeReply(ev.replyToken, { type:'text', text:'見積りを継続します。' });
        await sendNext(userId);
      }
      return;
    }
  }

  // text
  if (ev.type === 'message' && ev.message.type === 'text'){
    const text = (ev.message.text||'').trim();

    // 手動再配信
    if (CMD_RESULT.includes(text)){
      if (currentIndex(sess.answers) >= QUESTIONS.length){
        await sendNext(userId, ev.replyToken); // push で再送される
      }else{
        await safeReply(ev.replyToken, { type:'text', text:'まだ最後の設問まで完了していません。' });
      }
      return;
    }

    // リセット
    if (CMD_RESET.includes(text)){
      sessions.delete(userId);
      await safeReply(ev.replyToken, { type:'text', text:'初期化しました。もう一度「カンタン見積りを依頼」と入力してください。' });
      return;
    }

    // 開始
    if (TRIGGER_START.includes(text)){
      sessions.set(userId, {answers:{}, last:{}, step:0});
      await safeReply(ev.replyToken, { type:'text', text:'見積もりを開始します。以下の質問にお答えください。' });
      await sendNext(userId);
      return;
    }

    // 見積り途中に自由入力が来た場合
    if (currentIndex(sess.answers) < QUESTIONS.length){
      await safeReply(ev.replyToken, { type:'text', text:'ボタンからお選びください。選択肢を再表示します。' });
      await confirmStop(userId);
      return;
    }

    // 待受
    await safeReply(ev.replyToken, { type:'text', text:'「カンタン見積りを依頼」と入力すると見積もりを開始します。' });
  }
}

// ---- 起動 ------------------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`listening on ${PORT}`));
