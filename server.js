/**
 * LINE外壁塗装・概算見積りボット（Supabase 連携・詳細見積り誘導付き）
 * ------------------------------------------------------------
 * ・質問→ボタン回答→画像アップロード→概算算出
 * ・画像は Supabase Storage（photos バケット）へ保存
 * ・完了時に 6桁の受付コードを Supabase の handoff テーブルへ保存
 * ・「詳細見積もりを希望する」ボタン（@189ujduc へ誘導）を表示
 *
 * 必要な環境変数:
 *  - CHANNEL_SECRET
 *  - CHANNEL_ACCESS_TOKEN
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - PORT（任意。Render では自動注入。未指定なら 10000）
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import { createClient } from '@supabase/supabase-js';

// ========= 基本設定 =========
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[ERROR] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FRIEND_ADD_URL = 'https://line.me/R/ti/p/@189ujduc'; // 詳細見積りの誘導先

const client = new line.Client(config);
const app = express();

// ========= Webhook =========
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook Error:', e);
    res.status(500).send('Error');
  }
});

// 健康チェック（Render の Health Check 用）
app.get('/health', (_, res) => res.status(200).send('healthy'));

// Render は PORT を注入。なければ 10000
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LINE bot listening on ${PORT}`));

// ========= 簡易セッション（本番は Redis/DB 推奨）=========
const sessions = new Map(); // userId -> { step, answers, photoIndex, photos[], expectingPhoto }

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 1,
      answers: {},
      photoIndex: 0,
      photos: [],
      expectingPhoto: false,
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, { step: 1, answers: {}, photoIndex: 0, photos: [], expectingPhoto: false });
}

// ========= アイコン/定義 =========
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

// 10/10 の写真順序（任意含む）
const PHOTO_STEPS = [
  { key: 'floor_plan', label: '平面図（任意）' },
  { key: 'elevation',  label: '立面図（任意）' },
  { key: 'section',    label: '断面図（任意）' },
  { key: 'around',     label: '周囲の写真（任意）' },
  { key: 'front',      label: '外観写真：正面' },
  { key: 'right',      label: '外観写真：右側' },
  { key: 'left',       label: '外観写真：左側' },
  { key: 'back',       label: '外観写真：後ろ側' },
  { key: 'damage',     label: '損傷箇所（任意）' },
];

// ========= Supabase: handoff 受付コード =========
async function createHandoff(answers, userId) {
  const code = (Math.floor(100000 + Math.random() * 900000)).toString(); // 6桁
  const { error } = await supabase.from('handoff').insert({
    code,
    src_user_id: userId,
    answers,
    status: 'open',
  });
  if (error) throw error;
  return code;
}

// ========= 誘導用 Flex =========
function buildHandoffFlex(code) {
  return {
    type: 'flex',
    altText: '詳細見積もりのご案内',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '詳細見積もりのご案内', weight: 'bold', size: 'lg' },
          { type: 'text', wrap: true, size: 'sm',
            text: 'より詳しい見積もりをご希望の場合、現地調査なしで1営業日以内にお見積りを差し上げます。' },
          { type: 'text', wrap: true, size: 'sm',
            text: '下のボタン「詳細見積もりを希望する」をタップし、担当アカウントのトークで受付コードを送ってください。' },
          { type: 'text', size: 'sm', color: '#666', margin: 'md', text: `受付コード：${code}` },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: { type: 'uri', label: '詳細見積もりを希望する', uri: FRIEND_ADD_URL },
          },
        ],
      },
    },
  };
}

// ========= イベント処理 =========
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // 友だち追加
  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n\n外壁・屋根塗装の【かんたん概算見積り】をトーク上でご案内します。\nはじめますか？「見積もり」または「スタート」を送ってください。'
    );
  }

  // メッセージ
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

      // 写真待ち中のテキスト（スキップ / 完了）
      const s = getSession(userId);
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(text)) return askNextPhoto(event.replyToken, userId, true);
        if (/^(完了|おわり|終了)$/i.test(text)) {
          s.photoIndex = PHOTO_STEPS.length; // 強制終端
          return finishAndEstimate(event.replyToken, userId);
        }
        return replyText(event.replyToken, '画像を送信してください。スキップは「スキップ」と送ってください。');
      }

      // それ以外
      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。\n途中の方はボタンをタップしてください。');
    }

    // 画像
    if (message.type === 'image') {
      const s = getSession(userId);
      if (!s.expectingPhoto) {
        return replyText(
          event.replyToken,
          'ありがとうございます！\nただいま質問中です。「見積もり」で最初から始めるか、続きのボタンをどうぞ。'
        );
      }
      // 保存は非同期に投げる（返信を待たせない）
      saveImageMessage(userId, message.id, s).catch(err => console.error('saveImageMessage', err));
      // 次へ進めるメッセージを即時返信
      return askNextPhoto(event.replyToken, userId, false);
    }

    // 他タイプは無視
    return;
  }

  // Postback（選択肢）
  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data);
    const s = getSession(userId);

    const q = Number(data.q);
    const v = data.v;
    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    s.answers[`q${q}`] = v;

    // Q4 の分岐（前回塗装なし/不明 → Q5スキップ）
    if (q === 4 && (v === 'ない' || v === 'わからない')) {
      s.answers['q5'] = '該当なし';
      s.step = 6;
      return askQ6(event.replyToken, userId);
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

// ========= 質問UI =========
const quickReply = (items) => ({ items });
const actionItem = (label, data, imageUrl, displayText) => ({
  type: 'action',
  imageUrl,
  action: { type: 'postback', label, data, displayText: displayText || label },
});

async function askQ1(replyToken, userId) {
  getSession(userId).step = 1;
  const text = '1/10 住宅の階数を選んでください';
  const items = [
    actionItem('1階建て', qs.stringify({ q: 1, v: '1階建て' }), ICONS.floor),
    actionItem('2階建て', qs.stringify({ q: 1, v: '2階建て' }), ICONS.floor),
    actionItem('3階建て', qs.stringify({ q: 1, v: '3階建て' }), ICONS.floor),
  ];
  return client.replyMessage(replyToken, { type: 'text', text, quickReply: quickReply(items) });
}
async function askQ2(rt){ return client.replyMessage(rt,{type:'text',text:'2/10 住宅の間取りを選んでください',quickReply:quickReply(['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'].map(l=>actionItem(l,qs.stringify({q:2,v:l}),ICONS.layout)))})}
async function askQ3(rt){ return client.replyMessage(rt,{type:'text',text:'3/10 希望する工事内容を選んでください',quickReply:quickReply([
  actionItem('外壁塗装',qs.stringify({q:3,v:'外壁塗装'}),ICONS.paint),
  actionItem('屋根塗装',qs.stringify({q:3,v:'屋根塗装'}),ICONS.paint),
  actionItem('外壁＋屋根',qs.stringify({q:3,v:'外壁塗装＋屋根塗装'}),ICONS.paint,'外壁塗装＋屋根塗装')
])})}
async function askQ4(rt){ return client.replyMessage(rt,{type:'text',text:'4/10 これまで外壁塗装をしたことはありますか？',quickReply:quickReply([
  actionItem('ある',qs.stringify({q:4,v:'ある'}),ICONS.yes),
  actionItem('ない',qs.stringify({q:4,v:'ない'}),ICONS.no),
  actionItem('わからない',qs.stringify({q:4,v:'わからない'}),ICONS.no),
])})}
async function askQ5(rt){ return client.replyMessage(rt,{type:'text',text:'5/10 前回の外壁塗装からどのくらい経っていますか？',quickReply:quickReply(['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'].map(y=>actionItem(y,qs.stringify({q:5,v:y}),ICONS.years)))})}
async function askQ6(rt){ return client.replyMessage(rt,{type:'text',text:'6/10 外壁の種類を選んでください',quickReply:quickReply(['モルタル','サイディング','タイル','ALC'].map(v=>actionItem(v,qs.stringify({q:6,v}),ICONS.wall)))})}
async function askQ7(rt){ return client.replyMessage(rt,{type:'text',text:'7/10 屋根の種類を選んでください',quickReply:quickReply(['瓦','スレート','ガルバリウム','トタン'].map(v=>actionItem(v,qs.stringify({q:7,v}),ICONS.roof)))})}
async function askQ8(rt){ return client.replyMessage(rt,{type:'text',text:'8/10 雨漏りの状況を選んでください',quickReply:quickReply(['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'].map(v=>actionItem(v,qs.stringify({q:8,v}),ICONS.leak)))})}
async function askQ9(rt){ return client.replyMessage(rt,{type:'text',text:'9/10 周辺との最短距離を選んでください（足場設置の目安）',quickReply:quickReply(['30cm以下','50cm以下','70cm以下','70cm以上'].map(v=>actionItem(v,qs.stringify({q:9,v}),ICONS.distance)))})}

async function askQ10_Begin(replyToken, userId) {
  const s = getSession(userId);
  s.expectingPhoto = true; s.photoIndex = 0;
  return askNextPhoto(replyToken, userId, false, true);
}

async function askNextPhoto(replyToken, userId, skipped = false, first = false) {
  const s = getSession(userId);
  if (!s.expectingPhoto) s.expectingPhoto = true;
  if (!first && skipped) await replyText(replyToken, 'スキップしました。');
  if (!first) s.photoIndex += 1;

  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    return finishAndEstimate(replyToken, userId);
  }

  const current = PHOTO_STEPS[s.photoIndex];
  const prompt = `10/10 写真アップロード\n「${current.label}」を送ってください。`;
  const items = [
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'camera',     label: 'カメラを起動' } },
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'cameraRoll', label: 'アルバムから選択' } },
    { type: 'action', imageUrl: ICONS.skip,   action: { type: 'message',    label: 'スキップ', text: 'スキップ' } },
    { type: 'action', imageUrl: ICONS.skip,   action: { type: 'message',    label: '完了',     text: '完了' } },
  ];
  return client.replyMessage(replyToken, { type: 'text', text: prompt, quickReply: { items } });
}

// ========= 画像保存：Supabase Storage へ =========
async function saveImageMessage(userId, messageId, session) {
  try {
    // LINEの画像を Buffer 化
    const stream = await client.getMessageContent(messageId);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buffer = Buffer.concat(chunks);

    // どの写真か
    const current = PHOTO_STEPS[session.photoIndex] || { key: 'photo', label: '写真' };

    // 日本語ファイル名は使わず、安全なキーに統一
    const objectPath = `${userId}/${Date.now()}_${current.key}.jpg`;

    const { data, error } = await supabase
      .storage.from('photos')         // ← バケット名
      .upload(objectPath, buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (error) throw error;

    session.photos.push({ key: current.key, path: data.path });
    await client.pushMessage(userId, { type: 'text', text: `受け取りました：${current.label}` });
  } catch (err) {
    console.error('saveImageMessage error:', err);
    await client.pushMessage(userId, { type: 'text', text: '画像の保存に失敗しました。もう一度お試しください。' });
  }
}

// ========= 概算ロジック（ダミー係数）=========
function estimateCost(a) {
  const baseByWork = {
    '外壁塗装': 700000,
    '屋根塗装': 300000,
    '外壁塗装＋屋根塗装': 900000,
  };
  const floorsFactor = { '1階建て': 1.0, '2階建て': 1.2, '3階建て': 1.4 };
  const layoutFactor = {
    '1DK': 0.9, '1LDK': 0.95, '2DK': 1.0, '2LDK': 1.05,
    '3DK': 1.1, '3LDK': 1.15, '4DK': 1.2, '4LDK': 1.25,
    '5DK': 1.3, '5LDK': 1.35,
  };
  const wallFactor = { 'モルタル': 1.05, 'サイディング': 1.0, 'タイル': 1.15, 'ALC': 1.1 };
  const roofFactor = { '瓦': 1.1, 'スレート': 1.0, 'ガルバリウム': 1.05, 'トタン': 0.95 };
  const leakFactor = { '雨の日に水滴が落ちる': 1.15, '天井にシミがある': 1.1, '雨漏りはない': 1.0 };
  const distanceFactor = { '30cm以下': 1.2, '50cm以下': 1.15, '70cm以下': 1.1, '70cm以上': 1.0 };
  const yearsFactor = {
    '1〜5年': 0.95, '5〜10年': 1.0, '10〜15年': 1.05, '15〜20年': 1.1,
    '20〜30年': 1.15, '30〜40年': 1.2, '40年以上': 1.25, '0年（新築）': 0.9,
  };

  const work = a.q3;
  let cost = baseByWork[work] || 600000;
  cost *= floorsFactor[a.q1] || 1.0;
  cost *= layoutFactor[a.q2] || 1.0;
  cost *= wallFactor[a.q6] || 1.0;
  cost *= leakFactor[a.q8] || 1.0;
  cost *= distanceFactor[a.q9] || 1.0;
  if (work === '屋根塗装' || work === '外壁塗装＋屋根塗装') cost *= roofFactor[a.q7] || 1.0;
  if (a.q4 === 'ある') cost *= yearsFactor[a.q5] || 1.0;
  return Math.round(cost / 1000) * 1000;
}
const yen = (n) => n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

// ========= 完了・サマリ（受付コード発行 & 誘導）=========
async function finishAndEstimate(replyToken, userId) {
  const s = getSession(userId);
  s.expectingPhoto = false;
  s.step = 11;

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

  let code = '';
  try {
    code = await createHandoff(a, userId);
  } catch (e) {
    console.error('createHandoff failed:', e);
  }

  const msgs = [
    { type: 'text', text: summary },
    { type: 'text', text: `概算金額：${yen(estimate)}\n\n${disclaimer}` },
  ];
  if (code) {
    msgs.push(buildHandoffFlex(code));
  } else {
    msgs.push({ type: 'text', text: `詳細見積もりをご希望の方はこちら → ${FRIEND_ADD_URL}` });
  }

  await client.replyMessage(replyToken, msgs);

  await client.pushMessage(userId, {
    type: 'text',
    text: '最初からやり直す場合は「リセット」と送ってください。'
  });
}

// ========= 返信ユーティリティ =========
function replyText(replyToken, text) {
  return client.replyMessage(replyToken, { type: 'text', text });
}
