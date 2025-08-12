/**
 * LINE外壁塗装・概算見積りボット（Node.js + Supabase）
 * - Q&A → 画像受信 → 概算提示 → 「詳細見積もり」へ誘導
 * - 画像は Supabase Storage に“英数字だけの安全名”で保存（日本語名でもOK）
 * - 完了時に 6桁の受付コードを発行して Supabase テーブル handoff に保存
 *
 * 必要環境変数（Render）
 *  CHANNEL_SECRET
 *  CHANNEL_ACCESS_TOKEN
 *  SUPABASE_URL
 *  SUPABASE_SERVICE_ROLE_KEY
 *  SUPABASE_BUCKET  ← 任意（既定: photos）
 *
 * 依存（package.json）
 *  "@line/bot-sdk","express","qs","@supabase/supabase-js","dotenv"
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import { createClient } from '@supabase/supabase-js';

// ============ LINE / Supabase 基本設定 ============
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[ERROR] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[ERROR] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BUCKET = process.env.SUPABASE_BUCKET || 'photos';

// 詳細見積もり用の別アカウント（友だち追加リンク）
const FRIEND_ADD_URL = 'https://line.me/R/ti/p/@189ujduc';

// ============ Express ============
const client = new line.Client(config);
const app = express();

app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook Error:', e);
    res.status(500).send('ERR');
  }
});
app.get('/health', (_, res) => res.status(200).send('healthy'));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('LINE bot listening on', PORT));

// ============ 簡易セッション（本番は DB/Redis を推奨） ============
const sessions = new Map(); // userId -> { step, answers, photoIndex, photos[], expectingPhoto }
const getSession = (uid) => {
  if (!sessions.has(uid)) {
    sessions.set(uid, { step: 1, answers: {}, photoIndex: 0, photos: [], expectingPhoto: false });
  }
  return sessions.get(uid);
};
const resetSession = (uid) => sessions.set(uid, { step: 1, answers: {}, photoIndex: 0, photos: [], expectingPhoto: false });

// ============ 質問UI 定義 ============
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
  { key: 'front',  label: '外観写真：正面' },
  { key: 'right',  label: '外観写真：右側' },
  { key: 'left',   label: '外観写真：左側' },
  { key: 'back',   label: '外観写真：後ろ側' },
  { key: 'damage', label: '損傷箇所（任意）' },
];

// ============ 画像保存（日本語名でも安全名に統一） ============
// stream -> Buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}
// 超ざっくり拡張子判定
function sniffExt(buf) {
  if (!buf || buf.length < 12) return 'jpg';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'; // PNG
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf.slice(8,12).toString('ascii') === 'WEBP') return 'webp'; // WEBP
  if (buf.slice(4,8).toString('ascii') === 'ftyp' &&
      /heic|heif|mif1|msf1/.test(buf.slice(8,12).toString('ascii'))) return 'heic'; // HEIC-ish
  return 'jpg';
}
function mimeByExt(ext) {
  return ({
    jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', heic:'image/heic'
  }[ext] || 'image/jpeg');
}
// 常に ASCII の安全名を生成
function safePath(userId, logicalKey, ext) {
  const ymdHis = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0,14);
  const rand = Math.random().toString(36).slice(2,8);
  return `${userId}/${logicalKey}_${ymdHis}_${rand}.${ext}`; // 例: Uxxx/front_20250812163000_ab12cd.jpg
}

async function saveImageMessage(userId, messageId, session) {
  try {
    const stream = await client.getMessageContent(messageId);
    const buf = await streamToBuffer(stream);
    const ext = sniffExt(buf);
    const contentType = mimeByExt(ext);

    const current = PHOTO_STEPS[session.photoIndex] || { key: 'photo', label: '写真' };
    const path = safePath(userId, current.key, ext);

    const { error: upErr } = await supabase
      .storage
      .from(BUCKET)
      .upload(path, buf, { contentType, cacheControl: '3600', upsert: false });
    if (upErr) throw upErr;

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const url = pub?.publicUrl;

    session.photos.push({ key: current.key, path, url });

    await client.pushMessage(userId, { type: 'text', text: `受け取りました：${current.label}` });
  } catch (err) {
    console.error('saveImageMessage error:', err);
    await client.pushMessage(userId, { type:'text', text:'画像の保存に失敗しました。もう一度お試しください。' });
  }
}

// ============ 受付コード（handoff） ============
async function createHandoff(answers, userId, photos = []) {
  const code = (Math.floor(100000 + Math.random() * 900000)).toString();
  const payload = { code, src_user_id: userId, answers, photos, status: 'open' };
  const { error } = await supabase.from('handoff').insert(payload);
  if (error) throw error;
  return code;
}
function buildHandoffFlex(code) {
  return {
    type: 'flex',
    altText: '詳しい見積もりのご案内',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', contents: [
          { type: 'text', text: 'より詳しい見積もりをご希望の方へ', weight: 'bold' },
          { type: 'text', text: '下のボタンから担当アカウントを友だち追加し、受付コードを送ってください。', wrap: true },
          { type: 'text', text: `受付コード：${code}`, size: 'sm', color: '#666', margin: 'md' },
        ]
      },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', action: { type:'uri', label:'詳細見積もりを希望する', uri: FRIEND_ADD_URL } }
      ]}
    }
  };
}

// ============ イベントハンドラ ============
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n\n外壁・屋根塗装の【かんたん概算見積り】をトーク上でご案内します。\nはじめますか？「見積もり」または「スタート」を送ってください。'
    );
  }

  if (event.type === 'message') {
    const { message } = event;

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

      const s = getSession(userId);
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(text)) {
          await askNextPhoto(event.replyToken, userId, true);
          return;
        }
        if (/^(完了|おわり|終了)$/i.test(text)) {
          s.photoIndex = PHOTO_STEPS.length;
          return finishAndEstimate(event.replyToken, userId);
        }
        return replyText(event.replyToken, '画像を送信してください。スキップは「スキップ」と送ってください。');
      }

      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。\n途中の方はボタンをタップしてください。');
    }

    if (message.type === 'image') {
      const s = getSession(userId);
      if (!s.expectingPhoto) {
        return replyText(event.replyToken,
          'ありがとうございます！\nただいま質問中です。「見積もり」で最初から始めるか、続きのボタンをどうぞ。'
        );
      }
      // 保存は非同期で投げ、すぐ次の案内を返す
      saveImageMessage(userId, message.id, s).catch(err => console.error('saveImageMessage', err));
      return askNextPhoto(event.replyToken, userId, false);
    }
    return;
  }

  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data);
    const s = getSession(userId);
    const q = Number(data.q);
    const v = data.v;
    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    s.answers[`q${q}`] = v;

    // Q4 → Q5 スキップ分岐
    if (q === 4) {
      if (v === 'ない' || v === 'わからない') {
        s.answers['q5'] = '該当なし';
        s.step = 6;
        return askQ6(event.replyToken, userId);
      }
    }

    s.step = q + 1;
    switch (s.step) {
      case 2:  return askQ2(event.replyToken, userId);
      case 3:  return askQ3(event.replyToken, userId);
      case 4:  return askQ4(event.replyToken, userId);
      case 5:  return askQ5(event.replyToken, userId);
      case 6:  return askQ6(event.replyToken, userId);
      case 7:  return askQ7(event.replyToken, userId);
      case 8:  return askQ8(event.replyToken, userId);
      case 9:  return askQ9(event.replyToken, userId);
      case 10: return askQ10_Begin(event.replyToken, userId);
      case 11: return finishAndEstimate(event.replyToken, userId);
      default: return finishAndEstimate(event.replyToken, userId);
    }
  }
}

// ============ 質問送信ヘルパ ============
const quickReply = (items) => ({ items });
const actionItem = (label, data, imageUrl, displayText) => ({
  type: 'action',
  imageUrl,
  action: { type: 'postback', label, data, displayText: displayText || label },
});

async function askQ1(rt, uid) {
  const s = getSession(uid); s.step = 1;
  const text = '1/10 住宅の階数を選んでください';
  const items = [
    actionItem('1階建て', qs.stringify({ q:1, v:'1階建て' }), ICONS.floor),
    actionItem('2階建て', qs.stringify({ q:1, v:'2階建て' }), ICONS.floor),
    actionItem('3階建て', qs.stringify({ q:1, v:'3階建て' }), ICONS.floor),
  ];
  return client.replyMessage(rt, { type:'text', text, quickReply: quickReply(items) });
}
async function askQ2(rt) {
  const text = '2/10 住宅の間取りを選んでください';
  const layouts = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  const items = layouts.map(l => actionItem(l, qs.stringify({ q:2, v:l }), ICONS.layout));
  return client.replyMessage(rt, { type:'text', text, quickReply: quickReply(items) });
}
async function askQ3(rt) {
  const text = '3/10 希望する工事内容を選んでください';
  const items = [
    actionItem('外壁塗装', qs.stringify({ q:3, v:'外壁塗装' }), ICONS.paint),
    actionItem('屋根塗装', qs.stringify({ q:3, v:'屋根塗装' }), ICONS.paint),
    actionItem('外壁＋屋根', qs.stringify({ q:3, v:'外壁塗装＋屋根塗装' }), ICONS.paint, '外壁塗装＋屋根塗装'),
  ];
  return client.replyMessage(rt, { type:'text', text, quickReply: quickReply(items) });
}
async function askQ4(rt) {
  const text = '4/10 これまで外壁塗装をしたことはありますか？';
  const items = [
    actionItem('ある', qs.stringify({ q:4, v:'ある' }), ICONS.yes),
    actionItem('ない', qs.stringify({ q:4, v:'ない' }), ICONS.no),
    actionItem('わからない', qs.stringify({ q:4, v:'わからない' }), ICONS.no),
  ];
  return client.replyMessage(rt, { type:'text', text, quickReply: quickReply(items) });
}
async function askQ5(rt) {
  const text = '5/10 前回の外壁塗装からどのくらい経っていますか？';
  const years = ['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  const items = years.map(y => actionItem(y, qs.stringify({ q:5, v:y }), ICONS.years));
  return client.replyMessage(rt, { type:'text', text, quickReply: quickReply(items) });
}
async function askQ6(rt) {
  const text = '6/10 外壁の種類を選んでください';
  const items = ['モルタル','サイディング','タイル','ALC'].map(v => actionItem(v, qs.stringify({ q:6, v }), ICONS.wall));
  return client.replyMessage(rt, { type:'text', text, quickReply: quickReply(items) });
}
async function askQ7(rt) {
  const text = '7/10 屋根の種類を選んでください';
  const items = ['瓦','スレート','ガルバリウム','トタン'].map(v => actionItem(v, qs.stringify({ q:7, v }), ICONS.roof));
  return client.replyMessage(rt, { type:'text', text, quickReply: quickReply(items) });
}
async function askQ8(rt) {
  const text = '8/10 雨漏りの状況を選んでください';
  const items = ['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'].map(v => actionItem(v, qs.stringify({ q:8, v }), ICONS.leak));
  return client.replyMessage(rt, { type:'text', text, quickReply: quickReply(items) });
}
async function askQ9(rt) {
  const text = '9/10 周辺との最短距離を選んでください（足場設置の目安）';
  const items = ['30cm以下','50cm以下','70cm以下','70cm以上'].map(v => actionItem(v, qs.stringify({ q:9, v }), ICONS.distance));
  return client.replyMessage(rt, { type:'text', text, quickReply: quickReply(items) });
}
async function askQ10_Begin(rt, uid) {
  const s = getSession(uid);
  s.expectingPhoto = true; s.photoIndex = 0;
  return askNextPhoto(rt, uid, false, true);
}
async function askNextPhoto(rt, uid, skipped=false, first=false) {
  const s = getSession(uid);
  if (!s.expectingPhoto) s.expectingPhoto = true;
  if (!first && skipped) await replyText(rt, 'スキップしました。');
  if (!first) s.photoIndex += 1;

  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    return finishAndEstimate(rt, uid);
  }

  const current = PHOTO_STEPS[s.photoIndex];
  const prompt = `10/10 写真アップロード\n「${current.label}」を送ってください。`;
  const items = [
    { type:'action', imageUrl: ICONS.camera, action:{ type:'camera',     label:'カメラを起動' } },
    { type:'action', imageUrl: ICONS.camera, action:{ type:'cameraRoll', label:'アルバムから選択' } },
    { type:'action', imageUrl: ICONS.skip,   action:{ type:'message',    label:'スキップ', text:'スキップ' } },
    { type:'action', imageUrl: ICONS.skip,   action:{ type:'message',    label:'完了',     text:'完了' } },
  ];
  return client.replyMessage(rt, { type:'text', text: prompt, quickReply: { items } });
}

// ============ 概算ロジック（ダミー係数） ============
function estimateCost(a) {
  const base = { '外壁塗装':700000, '屋根塗装':300000, '外壁塗装＋屋根塗装':900000 };
  const floors = { '1階建て':1.0, '2階建て':1.2, '3階建て':1.4 };
  const layout = { '1DK':0.9,'1LDK':0.95,'2DK':1.0,'2LDK':1.05,'3DK':1.1,'3LDK':1.15,'4DK':1.2,'4LDK':1.25,'5DK':1.3,'5LDK':1.35 };
  const wall = { 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof = { '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak = { '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.1,'雨漏りはない':1.0 };
  const dist = { '30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.1,'70cm以上':1.0 };
  const years = { '1〜5年':0.95,'5〜10年':1.0,'10〜15年':1.05,'15〜20年':1.1,'20〜30年':1.15,'30〜40年':1.2,'40年以上':1.25,'0年（新築）':0.9 };

  const w = a.q3;
  let cost = base[w] ?? 600000;
  cost *= floors[a.q1] ?? 1.0;
  cost *= layout[a.q2] ?? 1.0;
  cost *= wall[a.q6] ?? 1.0;
  cost *= leak[a.q8] ?? 1.0;
  cost *= dist[a.q9] ?? 1.0;
  if (w === '屋根塗装' || w === '外壁塗装＋屋根塗装') cost *= roof[a.q7] ?? 1.0;
  if (a.q4 === 'ある') cost *= years[a.q5] ?? 1.0;
  return Math.round(cost/1000)*1000;
}
const yen = (n) => n.toLocaleString('ja-JP', { style:'currency', currency:'JPY', maximumFractionDigits:0 });

// ============ 完了・サマリ（受付コード発行 → 誘導） ============
async function finishAndEstimate(rt, uid) {
  const s = getSession(uid);
  s.expectingPhoto = false; s.step = 11;

  const a = s.answers;
  const estimate = estimateCost(a);

  const summary =
    '【回答の確認】\n' +
    `・階数: ${a.q1 || '-'}\n・間取り: ${a.q2 || '-'}\n・工事内容: ${a.q3 || '-'}\n` +
    `・過去の外壁塗装: ${a.q4 || '-'}\n・前回からの年数: ${a.q5 || '該当なし'}\n` +
    `・外壁種類: ${a.q6 || '-'}\n・屋根種類: ${a.q7 || '-'}\n` +
    `・雨漏り: ${a.q8 || '-'}\n・最短距離: ${a.q9 || '-'}\n` +
    `・受領写真枚数: ${s.photos.length}枚`;

  const disclaimer = '※表示金額は概算の目安です。実際の建物形状・劣化状況・足場条件・使用塗料により変動します。担当者が詳細確認のうえ正式お見積りをご案内します。';

  // 受付コード作成（写真URLも保存）
  let code = '';
  try {
    code = await createHandoff(a, uid, s.photos.map(p => p.url).filter(Boolean));
  } catch (e) {
    console.error('createHandoff failed:', e);
  }

  const msgs = [
    { type:'text', text: summary },
    { type:'text', text: `概算金額：${yen(estimate)}\n\n${disclaimer}` },
  ];

  if (code) {
    msgs.push(buildHandoffFlex(code));
    msgs.push({ type:'text', text:'※「詳細見積もりを希望する」ボタンから友だち追加し、受付コードを送ってください。1営業日以内に担当がご案内します。' });
  } else {
    msgs.push({ type:'text', text:`担当に直接相談される場合はこちら → ${FRIEND_ADD_URL}` });
  }

  await client.replyMessage(rt, msgs);
}

function replyText(rt, text) {
  return client.replyMessage(rt, { type:'text', text });
}
