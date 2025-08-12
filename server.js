/**
 * LINE外壁塗装・概算見積りボット（Supabase連携・ハンドオフ付き）
 * - 写真は Supabase Storage に保存（bucket: photos / public）
 * - 回答と写真URLは table: public.handoff に保存
 * - 完了時は「詳細見積もり」ボタン（@189ujduc）と受付コードを送付
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import fs from 'fs';
import path from 'path';
import qs from 'qs';
import { createClient } from '@supabase/supabase-js';

// ---------- LINE 設定 ----------
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[ERROR] CHANNEL_SECRET or CHANNEL_ACCESS_TOKEN is missing.');
  process.exit(1);
}
const client = new line.Client(config);

// ---------- Supabase 設定 ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_RO_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY // どちらでも可
);

// 友だち追加先（チャット可能アカウント）
const FRIEND_ADD_URL = 'https://line.me/R/ti/p/@189ujduc';

// ---------- Express ----------
const app = express();
app.get('/health', (_, res) => res.status(200).send('healthy'));
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events ?? [];
    await Promise.all(events.map(handleEvent));
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook error:', e);
    res.sendStatus(500);
  }
});
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LINE bot listening on ${PORT}`));

// ---------- 簡易セッション ----------
const sessions = new Map(); // userId -> { step, answers, photoIndex, photos[], expectingPhoto }
const initSession = () => ({ step: 1, answers: {}, photoIndex: 0, photos: [], expectingPhoto: false });
const getSession = (uid) => (sessions.has(uid) ? sessions.get(uid) : (sessions.set(uid, initSession()), sessions.get(uid)));
const resetSession = (uid) => sessions.set(uid, initSession());

// ---------- UI 素材 ----------
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

// ---------- 共通UI ----------
const quickReply = (items) => ({ items });
const qrAction = (label, data, imageUrl, displayText) => ({
  type: 'action',
  imageUrl,
  action: { type: 'postback', label, data, displayText: displayText || label },
});

async function replyText(replyToken, text) {
  return client.replyMessage(replyToken, { type: 'text', text });
}

// ---------- 受付コード & Supabase I/O ----------
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createHandoffRow({ code, userId, answers, photos }) {
  const { error } = await supabase.from('handoff').insert({
    code,
    src_user_id: userId,
    answers,
    photos,
    status: 'open',
  });
  if (error) throw error;
}

function handoffFlex(code) {
  return {
    type: 'flex',
    altText: '詳しい見積もりのご案内',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: 'より詳しい見積もりをご希望の方へ', weight: 'bold', wrap: true },
          { type: 'text', text: '現地調査なしで1営業日以内に正式お見積りをお送りします。下のボタンから担当アカウントを追加し、受付コードを送ってください。', size: 'sm', wrap: true },
          { type: 'text', text: `受付コード：${code}`, size: 'sm', color: '#666', margin: 'md' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: 'primary', action: { type: 'uri', label: '詳細見積もりを希望する', uri: FRIEND_ADD_URL } },
        ],
      },
    },
  };
}

function toPublicUrl(path) {
  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl;
}

async function streamToBuffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (c) => chunks.push(c));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

async function saveImageToSupabase(userId, stepKey, messageId) {
  const stream = await client.getMessageContent(messageId); // axiosで取得
  const buf = await streamToBuffer(stream);
  const filePath = `${userId}/${stepKey}_${Date.now()}.jpg`; // 日本語名を使わない

  const { error } = await supabase.storage.from('photos').upload(filePath, buf, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;

  return toPublicUrl(filePath);
}

// ---------- 質問 ----------
async function askQ1(replyToken, userId) {
  const s = getSession(userId); s.step = 1;
  const items = [
    qrAction('1階建て', qs.stringify({ q: 1, v: '1階建て' }), ICONS.floor),
    qrAction('2階建て', qs.stringify({ q: 1, v: '2階建て' }), ICONS.floor),
    qrAction('3階建て', qs.stringify({ q: 1, v: '3階建て' }), ICONS.floor),
  ];
  return client.replyMessage(replyToken, { type: 'text', text: '1/10 住宅の階数を選んでください', quickReply: quickReply(items) });
}
async function askQ2(replyToken, userId) {
  const layouts = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  const items = layouts.map(l => qrAction(l, qs.stringify({ q: 2, v: l }), ICONS.layout));
  return client.replyMessage(replyToken, { type: 'text', text: '2/10 住宅の間取りを選んでください', quickReply: quickReply(items) });
}
async function askQ3(replyToken, userId) {
  const items = [
    qrAction('外壁塗装', qs.stringify({ q: 3, v: '外壁塗装' }), ICONS.paint),
    qrAction('屋根塗装', qs.stringify({ q: 3, v: '屋根塗装' }), ICONS.paint),
    qrAction('外壁＋屋根', qs.stringify({ q: 3, v: '外壁塗装＋屋根塗装' }), ICONS.paint, '外壁塗装＋屋根塗装'),
  ];
  return client.replyMessage(replyToken, { type: 'text', text: '3/10 希望する工事内容を選んでください', quickReply: quickReply(items) });
}
async function askQ4(replyToken, userId) {
  const items = [
    qrAction('ある', qs.stringify({ q: 4, v: 'ある' }), ICONS.yes),
    qrAction('ない', qs.stringify({ q: 4, v: 'ない' }), ICONS.no),
    qrAction('わからない', qs.stringify({ q: 4, v: 'わからない' }), ICONS.no),
  ];
  return client.replyMessage(replyToken, { type: 'text', text: '4/10 これまで外壁塗装をしたことはありますか？', quickReply: quickReply(items) });
}
async function askQ5(replyToken, userId) {
  const years = ['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  const items = years.map(y => qrAction(y, qs.stringify({ q: 5, v: y }), ICONS.years));
  return client.replyMessage(replyToken, { type: 'text', text: '5/10 前回の外壁塗装からどのくらい経っていますか？', quickReply: quickReply(items) });
}
async function askQ6(replyToken, userId) {
  const items = ['モルタル','サイディング','タイル','ALC'].map(v => qrAction(v, qs.stringify({ q: 6, v }), ICONS.wall));
  return client.replyMessage(replyToken, { type: 'text', text: '6/10 外壁の種類を選んでください', quickReply: quickReply(items) });
}
async function askQ7(replyToken, userId) {
  const items = ['瓦','スレート','ガルバリウム','トタン'].map(v => qrAction(v, qs.stringify({ q: 7, v }), ICONS.roof));
  return client.replyMessage(replyToken, { type: 'text', text: '7/10 屋根の種類を選んでください', quickReply: quickReply(items) });
}
async function askQ8(replyToken, userId) {
  const items = ['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'].map(v => qrAction(v, qs.stringify({ q: 8, v }), ICONS.leak));
  return client.replyMessage(replyToken, { type: 'text', text: '8/10 雨漏りの状況を選んでください', quickReply: quickReply(items) });
}
async function askQ9(replyToken, userId) {
  const items = ['30cm以下','50cm以下','70cm以下','70cm以上'].map(v => qrAction(v, qs.stringify({ q: 9, v }), ICONS.distance));
  return client.replyMessage(replyToken, { type: 'text', text: '9/10 周辺との最短距離を選んでください（足場設置の目安）', quickReply: quickReply(items) });
}

async function askQ10_Begin(replyToken, userId) {
  const s = getSession(userId);
  s.expectingPhoto = true;
  s.photoIndex = 0;
  return askNextPhoto(replyToken, userId); // index 0
}

async function askNextPhoto(replyToken, userId) {
  const s = getSession(userId);
  if (!s.expectingPhoto) s.expectingPhoto = true;

  if (s.photoIndex >= PHOTO_STEPS.length) {
    // 念のためガード
    return finishAndNotify(userId);
  }
  const current = PHOTO_STEPS[s.photoIndex];
  const items = [
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'camera', label: 'カメラを起動' } },
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'cameraRoll', label: 'アルバムから選択' } },
    { type: 'action', imageUrl: ICONS.skip, action: { type: 'message', label: 'スキップ', text: 'スキップ' } },
    { type: 'action', imageUrl: ICONS.skip, action: { type: 'message', label: '完了', text: '完了' } },
  ];
  return client.replyMessage(replyToken, {
    type: 'text',
    text: `10/10 写真アップロード\n「${current.label}」を送ってください。`,
    quickReply: { items },
  });
}

// ---------- 見積り ----------
function estimateCost(a) {
  const base = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装＋屋根塗装': 900000 };
  const floors = { '1階建て': 1.0, '2階建て': 1.2, '3階建て': 1.4 };
  const layout = { '1DK': .9, '1LDK': .95, '2DK': 1.0, '2LDK': 1.05, '3DK': 1.1, '3LDK': 1.15, '4DK': 1.2, '4LDK': 1.25, '5DK': 1.3, '5LDK': 1.35 };
  const wall = { 'モルタル': 1.05, 'サイディング': 1.0, 'タイル': 1.15, 'ALC': 1.1 };
  const roof = { '瓦': 1.1, 'スレート': 1.0, 'ガルバリウム': 1.05, 'トタン': .95 };
  const leak = { '雨の日に水滴が落ちる': 1.15, '天井にシミがある': 1.1, '雨漏りはない': 1.0 };
  const dist = { '30cm以下': 1.2, '50cm以下': 1.15, '70cm以下': 1.1, '70cm以上': 1.0 };
  const years = { '1〜5年': .95, '5〜10年': 1.0, '10〜15年': 1.05, '15〜20年': 1.1, '20〜30年': 1.15, '30〜40年': 1.2, '40年以上': 1.25, '0年（新築）': .9 };

  let cost = base[a.q3] ?? 600000;
  cost *= floors[a.q1] ?? 1;
  cost *= layout[a.q2] ?? 1;
  cost *= wall[a.q6] ?? 1;
  cost *= leak[a.q8] ?? 1;
  cost *= dist[a.q9] ?? 1;
  if (a.q3 === '屋根塗装' || a.q3 === '外壁塗装＋屋根塗装') cost *= roof[a.q7] ?? 1;
  if (a.q4 === 'ある') cost *= years[a.q5] ?? 1;

  return Math.round(cost / 1000) * 1000;
}
const yen = (n) => n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

// ---------- 完了通知（pushで送る） ----------
async function finishAndNotify(userId) {
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

  // 受付コードを発行＆保存
  let code = '';
  try {
    code = genCode();
    await createHandoffRow({ code, userId, answers: a, photos: s.photos });
  } catch (e) {
    console.error('createHandoff error:', e);
  }

  const disclaimer = '※表示金額は概算の目安です。実際の建物形状・劣化状況・足場条件・使用塗料により変動します。担当者が詳細確認のうえ正式お見積りをご案内します。';

  const msgs = [
    { type: 'text', text: summary },
    { type: 'text', text: `概算金額：${yen(estimate)}\n\n${disclaimer}` },
    code
      ? handoffFlex(code)
      : { type: 'text', text: `担当に相談する：${FRIEND_ADD_URL}\n（受付コード発行に失敗しました）` },
    { type: 'text', text: '最初からやり直す場合は「リセット」と送ってください。' },
  ];
  await client.pushMessage(userId, msgs);
}

// ---------- イベント処理 ----------
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n\n外壁・屋根塗装の【かんたん概算見積り】をトーク上でご案内します。\n「見積もり」または「スタート」と送ってください。'
    );
  }

  if (event.type === 'message') {
    const s = getSession(userId);
    const msg = event.message;

    // テキスト
    if (msg.type === 'text') {
      const t = (msg.text || '').trim();

      if (/^(最初から|リセット)$/i.test(t)) {
        resetSession(userId);
        return replyText(event.replyToken, 'リセットしました。「見積もり」または「スタート」と送ってください。');
      }

      if (/^(見積もり|スタート|start)$/i.test(t)) {
        resetSession(userId);
        return askQ1(event.replyToken, userId);
      }

      // 写真ステップ中のコマンド
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(t)) {
          s.photoIndex += 1;
          if (s.photoIndex >= PHOTO_STEPS.length) {
            await replyText(event.replyToken, 'スキップしました。集計中です…');
            return finishAndNotify(userId);
          }
          return askNextPhoto(event.replyToken, userId);
        }
        if (/^(完了|おわり|終了)$/i.test(t)) {
          s.photoIndex = PHOTO_STEPS.length;
          await replyText(event.replyToken, '完了ですね。集計中です…');
          return finishAndNotify(userId);
        }
        return replyText(event.replyToken, '画像を送ってください。スキップは「スキップ」、終了は「完了」と送れます。');
      }

      // それ以外
      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。');
    }

    // 画像
    if (msg.type === 'image') {
      if (!s.expectingPhoto) {
        return replyText(event.replyToken, 'ただいま質問中です。「見積もり」で最初から始めるか、続きのボタンをどうぞ。');
      }

      const current = PHOTO_STEPS[s.photoIndex];
      try {
        // 保存完了を待つ（ここで Supabase へアップロード）
        const url = await saveImageToSupabase(userId, current.key, msg.id);
        s.photos.push({ key: current.key, url });
      } catch (e) {
        console.error('saveImageToSupabase error:', e);
        // 失敗しても先に進められるよう通知
        await replyText(event.replyToken, '画像の保存に失敗しました。お手数ですがもう一度お試しください。');
        return;
      }

      // 次へ
      s.photoIndex += 1;
      if (s.photoIndex >= PHOTO_STEPS.length) {
        await replyText(event.replyToken, `受け取りました：${current.label}\n集計中です…`);
        return finishAndNotify(userId); // push で本送信
      }
      // 次の案内を reply
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `受け取りました：${current.label}\n次の写真をお願いします。`,
        quickReply: {
          items: [
            { type: 'action', imageUrl: ICONS.camera, action: { type: 'camera', label: 'カメラを起動' } },
            { type: 'action', imageUrl: ICONS.camera, action: { type: 'cameraRoll', label: 'アルバムから選択' } },
            { type: 'action', imageUrl: ICONS.skip, action: { type: 'message', label: 'スキップ', text: 'スキップ' } },
            { type: 'action', imageUrl: ICONS.skip, action: { type: 'message', label: '完了', text: '完了' } },
          ],
        },
      });
    }

    return; // その他のメッセージは無視
  }

  // Postback
  if (event.type === 'postback') {
    const s = getSession(userId);
    const data = qs.parse(event.postback.data);
    const q = Number(data.q);
    const v = data.v;
    if (!q || v === undefined) {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }
    s.answers[`q${q}`] = v;

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
      default: return finishAndNotify(userId);
    }
  }
}
