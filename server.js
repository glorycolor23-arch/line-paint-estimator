/**
 * 見積りBot（A）：LINEトークでQ&A→写真→概算→受付コード発行
 * - 画像は Supabase Storage に保存（公開URLを取得）
 * - 回答＋写真URLは Supabase の handoff テーブルに保存
 * - 最後に「詳細見積もりを希望する」ボタン＋受付コードを案内（@189ujduc へ誘導）
 *
 * 必要な環境変数（Render > Environment Variables）
 *  - CHANNEL_SECRET
 *  - CHANNEL_ACCESS_TOKEN
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - SUPABASE_BUCKET   （任意、省略時 'photos'）
 *  - PORT              （任意、Render は自動で渡す）
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import { createClient } from '@supabase/supabase-js';

// ========= LINE 基本設定 =========
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[ERROR] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN 未設定');
  process.exit(1);
}

const client = new line.Client(config);
const app = express();

// ========= Supabase =========
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'photos';
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[ERROR] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未設定');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ========= 定数 =========
const FRIEND_ADD_URL = 'https://line.me/R/ti/p/@189ujduc'; // チャット対応アカウント

const ICONS = {
  floor: 'https://cdn-icons-png.flaticon.com/512/8911/8911331.png',
  layout: 'https://cdn-icons-png.flaticon.com/512/9193/9193091.png',
  paint: 'https://cdn-icons-png.flaticon.com/512/992/992703.png',
  yes: 'https://cdn-icons-png.flaticon.com/512/5610/5610944.png',
  no: 'https://cdn-icons-png.flaticon.com/512/5610/5610944.png',
  years: 'https://cdn-icons-png.flaticon.com/512/1827/1827370.png',
  wall: 'https://cdn-icons-png.flaticon.com/512/2992/2992653.png',
  roof: 'https://cdn-icons-png.flaticon.com/512/2933/2933922.png',
  leak: 'https://cdn-icons-png.flaticon.com/512/415/415734.png',
  distance: 'https://cdn-icons-png.flaticon.com/512/535/535285.png',
  camera: 'https://cdn-icons-png.flaticon.com/512/685/685655.png',
  skip: 'https://cdn-icons-png.flaticon.com/512/1828/1828665.png',
};

const PHOTO_STEPS = [
  { key: 'floor_plan', label: '平面図（任意）' },
  { key: 'elevation', label: '立面図（任意）' },
  { key: 'section', label: '断面図（任意）' },
  { key: 'around', label: '周囲の写真（任意）' },
  { key: 'front', label: '外観写真：正面' },
  { key: 'right', label: '外観写真：右側' },
  { key: 'left', label: '外観写真：左側' },
  { key: 'back', label: '外観写真：後ろ側' },
  { key: 'damage', label: '損傷箇所（任意）' },
];

// ========= 簡易セッション（本番はRedis/DB推奨） =========
const sessions = new Map(); // userId -> { step, answers, photoIndex, photos:[{key,url}], expectingPhoto }

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 1, answers: {}, photoIndex: 0, photos: [], expectingPhoto: false,
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, { step: 1, answers: {}, photoIndex: 0, photos: [], expectingPhoto: false });
}

// ========= Webhook =========
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error', e);
    res.status(500).send('Error');
  }
});
app.get('/health', (_, res) => res.status(200).send('healthy'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LINE bot listening on ${PORT}`));

// ========= イベント処理 =========
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n\n外壁・屋根塗装の【かんたん概算見積り】をご案内します。\nはじめますか？「見積もり」または「スタート」を送ってください。'
    );
  }

  if (event.type === 'message') {
    const { message } = event;

    // テキスト
    if (message.type === 'text') {
      const text = (message.text || '').trim();

      if (/^(最初から|リセット)$/i.test(text)) {
        resetSession(userId);
        return replyText(event.replyToken, '回答をリセットしました。\n「見積もり」または「スタート」を送ってください。');
      }

      if (/^(見積もり|スタート|start)$/i.test(text)) {
        resetSession(userId);
        return askQ1(event.replyToken, userId);
      }

      // 画像待ち中のテキスト（スキップ/完了）
      const s = getSession(userId);
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(text)) {
          return askNextPhoto(event.replyToken, userId, true);
        }
        if (/^(完了|おわり|終了)$/i.test(text)) {
          s.photoIndex = PHOTO_STEPS.length;
          return finishAndEstimate(event.replyToken, userId);
        }
        return replyText(event.replyToken, '画像を送信してください。スキップは「スキップ」と送ってください。');
      }

      // それ以外
      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。途中の方はボタンをタップしてください。');
    }

    // 画像
    if (message.type === 'image') {
      const s = getSession(userId);
      if (!s.expectingPhoto) {
        return replyText(event.replyToken, 'ありがとうございます！\n質問の続きにお進みください。最初からは「見積もり」と送ってください。');
      }

      // 画像保存は非同期で投げる
      saveImageToSupabase(userId, message.id, s).catch(err => console.error('saveImageToSupabase', err));

      // すぐ次の案内へ
      return askNextPhoto(event.replyToken, userId, false);
    }

    return; // その他のメッセージは無視
  }

  // Postback（ボタン回答）
  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data);
    const q = Number(data.q);
    const v = data.v;
    const s = getSession(userId);

    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }
    s.answers[`q${q}`] = v;

    // Q4: 「ない/わからない」→ Q5をスキップ
    if (q === 4 && (v === 'ない' || v === 'わからない')) {
      s.answers.q5 = '該当なし';
      s.step = 6;
      return askQ6(event.replyToken, userId);
    }

    s.step = q + 1;
    switch (s.step) {
      case 2: return askQ2(event.replyToken, userId);
      case 3: return askQ3(event.replyToken, userId);
      case 4: return askQ4(event.replyToken, userId);
      case 5: return askQ5(event.replyToken, userId);
      case 6: return askQ6(event.replyToken, userId);
      case 7: return askQ7(event.replyToken, userId);
      case 8: return askQ8(event.replyToken, userId);
      case 9: return askQ9(event.replyToken, userId);
      case 10: return askQ10_Begin(event.replyToken, userId);
      case 11: return finishAndEstimate(event.replyToken, userId);
      default: return finishAndEstimate(event.replyToken, userId);
    }
  }
}

// ========= 質問送信 =========
const qr = items => ({ items });
const postItem = (label, data, imageUrl, displayText) => ({
  type: 'action',
  imageUrl,
  action: { type: 'postback', label, data, displayText: displayText || label },
});

async function askQ1(token, uid) {
  getSession(uid).step = 1;
  return client.replyMessage(token, {
    type: 'text',
    text: '1/10 住宅の階数を選んでください',
    quickReply: qr([
      postItem('1階建て', qs.stringify({ q: 1, v: '1階建て' }), ICONS.floor),
      postItem('2階建て', qs.stringify({ q: 1, v: '2階建て' }), ICONS.floor),
      postItem('3階建て', qs.stringify({ q: 1, v: '3階建て' }), ICONS.floor),
    ]),
  });
}
async function askQ2(t){return client.replyMessage(t,{type:'text',text:'2/10 住宅の間取りを選んでください',quickReply:qr(['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'].map(l=>postItem(l,qs.stringify({q:2,v:l}),ICONS.layout)))})}
async function askQ3(t){return client.replyMessage(t,{type:'text',text:'3/10 希望する工事内容を選んでください',quickReply:qr([
  postItem('外壁塗装',qs.stringify({q:3,v:'外壁塗装'}),ICONS.paint),
  postItem('屋根塗装',qs.stringify({q:3,v:'屋根塗装'}),ICONS.paint),
  postItem('外壁＋屋根',qs.stringify({q:3,v:'外壁塗装＋屋根塗装'}),ICONS.paint,'外壁塗装＋屋根塗装')
])})}
async function askQ4(t){return client.replyMessage(t,{type:'text',text:'4/10 これまで外壁塗装をしたことはありますか？',quickReply:qr([
  postItem('ある',qs.stringify({q:4,v:'ある'}),ICONS.yes),
  postItem('ない',qs.stringify({q:4,v:'ない'}),ICONS.no),
  postItem('わからない',qs.stringify({q:4,v:'わからない'}),ICONS.no),
])})}
async function askQ5(t){const years=['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];return client.replyMessage(t,{type:'text',text:'5/10 前回の外壁塗装からどのくらい経っていますか？',quickReply:qr(years.map(y=>postItem(y,qs.stringify({q:5,v:y}),ICONS.years)))})}
async function askQ6(t){return client.replyMessage(t,{type:'text',text:'6/10 外壁の種類を選んでください',quickReply:qr(['モルタル','サイディング','タイル','ALC'].map(v=>postItem(v,qs.stringify({q:6,v}),ICONS.wall)))})}
async function askQ7(t){return client.replyMessage(t,{type:'text',text:'7/10 屋根の種類を選んでください',quickReply:qr(['瓦','スレート','ガルバリウム','トタン'].map(v=>postItem(v,qs.stringify({q:7,v}),ICONS.roof)))})}
async function askQ8(t){return client.replyMessage(t,{type:'text',text:'8/10 雨漏りの状況を選んでください',quickReply:qr(['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'].map(v=>postItem(v,qs.stringify({q:8,v}),ICONS.leak)))})}
async function askQ9(t){return client.replyMessage(t,{type:'text',text:'9/10 周辺との最短距離を選んでください（足場設置の目安）',quickReply:qr(['30cm以下','50cm以下','70cm以下','70cm以上'].map(v=>postItem(v,qs.stringify({q:9,v}),ICONS.distance)))})}

async function askQ10_Begin(token, uid) {
  const s = getSession(uid); s.expectingPhoto = true; s.photoIndex = 0;
  return askNextPhoto(token, uid, false, true);
}
async function askNextPhoto(token, uid, skipped=false, first=false) {
  const s = getSession(uid);
  if (!s.expectingPhoto) s.expectingPhoto = true;
  if (!first && skipped) await replyText(token, 'スキップしました。');
  if (!first) s.photoIndex += 1;

  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    return finishAndEstimate(token, uid);
  }

  const current = PHOTO_STEPS[s.photoIndex];
  const items = [
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'camera', label: 'カメラを起動' } },
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'cameraRoll', label: 'アルバムから選択' } },
    { type: 'action', imageUrl: ICONS.skip, action: { type: 'message', label: 'スキップ', text: 'スキップ' } },
    { type: 'action', imageUrl: ICONS.skip, action: { type: 'message', label: '完了', text: '完了' } },
  ];
  return client.replyMessage(token, { type:'text', text:`10/10 写真アップロード\n「${current.label}」を送ってください。`, quickReply:{ items } });
}

// ========= 画像を Supabase Storage へ保存 =========
async function saveImageToSupabase(userId, messageId, session) {
  // LINEから画像ストリーム取得 → Buffer化
  const stream = await client.getMessageContent(messageId);
  const chunks = [];
  await new Promise((resolve, reject) => {
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const buffer = Buffer.concat(chunks);

  const current = PHOTO_STEPS[session.photoIndex] || { key: 'photo', label: '写真' };
  const filePath = `${userId}/${Date.now()}_${current.key}.jpg`;

  // アップロード（バケットは公開にしておく）
  const { error: upErr } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(filePath, buffer, { contentType: 'image/jpeg', upsert: true });
  if (upErr) throw upErr;

  // 公開URL
  const { data: pub } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
  const url = pub.publicUrl;

  session.photos.push({ key: current.key, url });
  await client.pushMessage(userId, { type: 'text', text: `受け取りました：${current.label}` });
}

// ========= 概算計算（ダミー係数：要調整） =========
function estimateCost(a) {
  const base = { '外壁塗装':700000, '屋根塗装':300000, '外壁塗装＋屋根塗装':900000 };
  const floors = { '1階建て':1.0,'2階建て':1.2,'3階建て':1.4 };
  const layout = { '1DK':0.9,'1LDK':0.95,'2DK':1.0,'2LDK':1.05,'3DK':1.1,'3LDK':1.15,'4DK':1.2,'4LDK':1.25,'5DK':1.3,'5LDK':1.35 };
  const wall = { 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof = { '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak = { '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.1,'雨漏りはない':1.0 };
  const dist = { '30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.1,'70cm以上':1.0 };
  const years = { '1〜5年':0.95,'5〜10年':1.0,'10〜15年':1.05,'15〜20年':1.1,'20〜30年':1.15,'30〜40年':1.2,'40年以上':1.25,'0年（新築）':0.9 };

  let cost = base[a.q3] || 600000;
  cost *= floors[a.q1] || 1;
  cost *= layout[a.q2] || 1;
  cost *= wall[a.q6] || 1;
  cost *= leak[a.q8] || 1;
  cost *= dist[a.q9] || 1;
  if (a.q3 === '屋根塗装' || a.q3 === '外壁塗装＋屋根塗装') cost *= roof[a.q7] || 1;
  if (a.q4 === 'ある') cost *= years[a.q5] || 1;
  return Math.round(cost / 1000) * 1000;
}
const yen = n => n.toLocaleString('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0});

// ========= 受付コード保存＋案内 =========
async function createHandoff(answers, photos, userId) {
  const code = (Math.floor(100000 + Math.random()*900000)).toString();
  const { error } = await supabase.from('handoff').insert({
    code, src_user_id: userId, answers, photos, status: 'open'
  });
  if (error) throw error;
  return code;
}
function buildHandoffFlex(code) {
  return {
    type: 'flex',
    altText: '詳細見積もりのご案内',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type:'text', text:'詳細見積もりをご希望の方へ', weight:'bold', size:'md' },
          { type:'text', wrap:true, size:'sm', color:'#666',
            text:'現地調査なしで1営業日以内に正式なお見積もりをお送りします。下のボタンからチャット可能なLINEへ連携し、「受付コード」を送ってください。' },
          { type:'text', text:`受付コード：${code}`, size:'sm', color:'#555', margin:'md' },
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', contents: [
          { type:'button', style:'primary',
            action:{ type:'uri', label:'詳細見積もりを希望する', uri: FRIEND_ADD_URL } }
        ]
      }
    }
  };
}

// ========= 完了処理 =========
async function finishAndEstimate(token, userId) {
  const s = getSession(userId);
  s.expectingPhoto = false; s.step = 11;

  const a = s.answers;
  const estimate = estimateCost(a);
  const summary =
    '【回答の確認】\n' +
    `・階数: ${a.q1||'-'}\n・間取り: ${a.q2||'-'}\n・工事内容: ${a.q3||'-'}\n` +
    `・過去の外壁塗装: ${a.q4||'-'}\n・前回からの年数: ${a.q5||'該当なし'}\n` +
    `・外壁種類: ${a.q6||'-'}\n・屋根種類: ${a.q7||'-'}\n` +
    `・雨漏り: ${a.q8||'-'}\n・最短距離: ${a.q9||'-'}\n` +
    `・受領写真枚数: ${s.photos.length}枚`;

  let code = '';
  try { code = await createHandoff(a, s.photos, userId); }
  catch (e) { console.error('createHandoff failed:', e); }

  const msgs = [
    { type:'text', text: summary },
    { type:'text', text: `概算金額：${yen(estimate)}\n\nより詳しい見積もりをご希望の場合、現地調査なしで1営業日以内に正式なお見積もりをお送りします。` },
  ];
  if (code) {
    msgs.push(buildHandoffFlex(code));
    msgs.push({ type:'text', text:'ボタン先のLINEで「受付コード（6桁）」を送ってください。担当者がチャットでご案内します。' });
  } else {
    msgs.push({ type:'text', text:`連携先はこちら → ${FRIEND_ADD_URL}\n受付コードが作成できませんでした。お手数ですがこのメッセージを担当へお見せください。` });
  }

  await client.replyMessage(token, msgs);
  await client.pushMessage(userId, { type:'text', text:'やり直す場合は「リセット」と送ってください。' });
}

// ========= ユーティリティ =========
function replyText(token, text) {
  return client.replyMessage(token, { type:'text', text });
}
