/**
 * LINE 外壁塗装・概算見積りボット（Render + Supabase）
 * - 10問の回答と写真を集め、概算を算出
 * - 写真は Supabase Storage の `photos` バケットに保存
 * - 完了時に 6桁の受付コードを生成し、public.handoff に保存
 * - 担当チャット用LINE(@189ujduc)へ誘導するFlexを送信（失敗時はテキストにフォールバック）
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import { createClient } from '@supabase/supabase-js';
import { Readable } from 'stream';

// ====== 環境変数 ======
const FRIEND_ADD_URL = 'https://line.me/R/ti/p/@189ujduc'; // チャット可能アカウント

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[ERROR] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_RO_KEY; // タイプミス対策
const PHOTO_BUCKET = process.env.PHOTO_BUCKET || 'photos';

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

if (!supabase) {
  console.warn('[WARN] Supabase が未設定です。画像保存と受付記録は無効になります。');
}

// ====== LINE & Express ======
const client = new line.Client(config);
const app = express();

// Webhook (POST専用)
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook Error:', err);
    res.status(500).send('Error');
  }
});

// Health
app.get('/health', (_, res) => res.status(200).send('healthy'));

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LINE bot listening on ${PORT}`));

// ====== 簡易セッション ======
/** 本番は Redis/DB 推奨 */
const sessions = new Map(); // userId -> { step, answers, photoIndex, photos[], expectingPhoto }

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 1,
      answers: {},
      photoIndex: 0,
      photos: [], // {key,label,url}
      expectingPhoto: false,
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, { step: 1, answers: {}, photoIndex: 0, photos: [], expectingPhoto: false });
}

// ====== UI素材 ======
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

// ====== 汎用ユーティリティ ======
function quickReply(items) {
  return { items };
}
function actionItem(label, data, imageUrl, displayText) {
  return {
    type: 'action',
    imageUrl,
    action: { type: 'postback', label, data, displayText: displayText || label },
  };
}
function replyText(replyToken, text) {
  return client.replyMessage(replyToken, { type: 'text', text });
}

// pushを安全に送る（失敗時も次へ進む）
async function sendPushSafe(userId, messages) {
  const msgs = Array.isArray(messages) ? messages : [messages];
  try {
    await client.pushMessage(userId, msgs);
    return;
  } catch (err) {
    console.error('push error (batch):', err?.response?.data || err?.message || err);
  }
  for (const m of msgs) {
    try { await client.pushMessage(userId, [m]); }
    catch (err) { console.error('push error (single):', m.type, err?.response?.data || err?.message || err); }
  }
}

// 6桁コード
function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 日本語などを安全なファイル名に
function safeName(base, ext = 'jpg') {
  const t = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const slug = (base || 'img')
    .normalize('NFKD')
    .replace(/[^\w\-]+/g, '-') // 非英数を-
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `${slug || 'img'}_${t}.${ext}`;
}

// Stream -> Buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Supabase へ画像保存（public URL を返す）
async function uploadPhotoToSupabase(userId, label, currentKey, lineMessageStream) {
  if (!supabase) return { url: '', path: '' };

  const buf = await streamToBuffer(lineMessageStream);
  const filename = safeName(currentKey || 'photo', 'jpg');
  const objectPath = `${userId}/${filename}`; // userId ごとに整理

  const { error: upErr } = await supabase
    .storage.from(PHOTO_BUCKET)
    .upload(objectPath, buf, { contentType: 'image/jpeg', upsert: true });

  if (upErr) throw upErr;

  // Public バケット前提。Private の場合は getSignedUrl に切替
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(objectPath);
  const url = data?.publicUrl || '';
  return { url, path: objectPath, key: currentKey, label };
}

// handoff 保存
async function createHandoffRow({ code, userId, answers, photos }) {
  if (!supabase) return;
  const { error } = await supabase.from('handoff').insert({
    code,
    src_user_id: userId,
    answers,
    photos,
    status: 'open',
  });
  if (error) throw error;
}

// 誘導用 Flex
function handoffFlex(code) {
  return {
    type: 'flex',
    altText: '詳細見積もりのご案内',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: 'より詳しい見積もりをご希望の方へ', weight: 'bold', wrap: true },
          { type: 'text', text: '現地調査なしで1営業日以内に正式お見積りをお送りします。', wrap: true },
          { type: 'text', text: `受付コード：${code}`, size: 'sm', color: '#666666', margin: 'md' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'button', style: 'primary', action: { type: 'uri', label: '詳細見積もりを希望する', uri: FRIEND_ADD_URL } },
          { type: 'text', text: 'ボタンから友だち追加後、受付コードを送ってください。', size: 'xs', color: '#999999', wrap: true },
        ],
      },
    },
  };
}

// ====== イベントハンドラ ======
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(
      event.replyToken,
      '友だち追加ありがとうございます！\n\n外壁・屋根塗装の【かんたん概算見積り】をご案内します。' +
      '\nはじめますか？「見積もり」または「スタート」を送ってください。'
    );
  }

  if (event.type === 'message') {
    const { message } = event;

    // ----- テキスト -----
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
          s.photoIndex = PHOTO_STEPS.length; // 強制終了
          // reply で即応答 → その後 push で結果案内
          await replyText(event.replyToken, '集計中です…');
          await finishAndNotify(userId);
          return;
        }
        return replyText(event.replyToken, '画像を送信してください。スキップは「スキップ」と送ってください。');
      }

      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。\n途中の方はボタンをタップしてください。');
    }

    // ----- 画像 -----
    if (message.type === 'image') {
      const s = getSession(userId);
      if (!s.expectingPhoto) {
        return replyText(
          event.replyToken,
          'ありがとうございます！\nただいま質問中です。「見積もり」で最初から始めるか、続きのボタンをどうぞ。'
        );
      }

      // 受領通知は push、次の案内は reply（Quick Reply が安定）
      try {
        const current = PHOTO_STEPS[s.photoIndex] || { key: 'photo', label: '写真' };
        const stream = await client.getMessageContent(message.id);
        const uploaded = await uploadPhotoToSupabase(userId, current.label, current.key, stream);

        s.photos.push({ key: uploaded.key || current.key, label: uploaded.label || current.label, url: uploaded.url });

        await sendPushSafe(userId, { type: 'text', text: `受け取りました：${current.label}` });
      } catch (e) {
        console.error('save/upload error:', e?.response?.data || e);
        await sendPushSafe(userId, { type: 'text', text: '画像の保存に失敗しました。もう一度お試しください。' });
      }

      return askNextPhoto(event.replyToken, userId, false);
    }

    // 他メッセージは無視
    return;
  }

  // ----- Postback -----
  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data);
    const s = getSession(userId);

    const q = Number(data.q);
    const v = data.v;
    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    s.answers[`q${q}`] = v;

    // Q4の分岐（ない/わからない → Q5スキップ）
    if (q === 4) {
      if (v === 'ない' || v === 'わからない') {
        s.answers['q5'] = '該当なし';
        s.step = 6;
        return askQ6(event.replyToken, userId);
      }
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
      case 11:
        await replyText(event.replyToken, '集計中です…');
        await finishAndNotify(userId);
        return;
      default:
        await replyText(event.replyToken, '集計中です…');
        await finishAndNotify(userId);
        return;
    }
  }
}

// ====== 質問送信 ======
async function askQ1(replyToken, userId) {
  const s = getSession(userId); s.step = 1;
  const items = [
    actionItem('1階建て', qs.stringify({ q: 1, v: '1階建て' }), ICONS.floor),
    actionItem('2階建て', qs.stringify({ q: 1, v: '2階建て' }), ICONS.floor),
    actionItem('3階建て', qs.stringify({ q: 1, v: '3階建て' }), ICONS.floor),
  ];
  return client.replyMessage(replyToken, { type: 'text', text: '1/10 住宅の階数を選んでください', quickReply: quickReply(items) });
}
async function askQ2(replyToken, userId) {
  const layouts = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  const items = layouts.map(l => actionItem(l, qs.stringify({ q: 2, v: l }), ICONS.layout));
  return client.replyMessage(replyToken, { type: 'text', text: '2/10 住宅の間取りを選んでください', quickReply: quickReply(items) });
}
async function askQ3(replyToken, userId) {
  const items = [
    actionItem('外壁塗装', qs.stringify({ q: 3, v: '外壁塗装' }), ICONS.paint),
    actionItem('屋根塗装', qs.stringify({ q: 3, v: '屋根塗装' }), ICONS.paint),
    actionItem('外壁＋屋根', qs.stringify({ q: 3, v: '外壁塗装＋屋根塗装' }), ICONS.paint, '外壁塗装＋屋根塗装'),
  ];
  return client.replyMessage(replyToken, { type: 'text', text: '3/10 希望する工事内容を選んでください', quickReply: quickReply(items) });
}
async function askQ4(replyToken, userId) {
  const items = [
    actionItem('ある', qs.stringify({ q: 4, v: 'ある' }), ICONS.yes),
    actionItem('ない', qs.stringify({ q: 4, v: 'ない' }), ICONS.no),
    actionItem('わからない', qs.stringify({ q: 4, v: 'わからない' }), ICONS.no),
  ];
  return client.replyMessage(replyToken, { type: 'text', text: '4/10 これまで外壁塗装をしたことはありますか？', quickReply: quickReply(items) });
}
async function askQ5(replyToken, userId) {
  const years = ['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  const items = years.map(y => actionItem(y, qs.stringify({ q: 5, v: y }), ICONS.years));
  return client.replyMessage(replyToken, { type: 'text', text: '5/10 前回の外壁塗装からどのくらい経っていますか？', quickReply: quickReply(items) });
}
async function askQ6(replyToken, userId) {
  const items = ['モルタル','サイディング','タイル','ALC'].map(v => actionItem(v, qs.stringify({ q: 6, v }), ICONS.wall));
  return client.replyMessage(replyToken, { type: 'text', text: '6/10 外壁の種類を選んでください', quickReply: quickReply(items) });
}
async function askQ7(replyToken, userId) {
  const items = ['瓦','スレート','ガルバリウム','トタン'].map(v => actionItem(v, qs.stringify({ q: 7, v }), ICONS.roof));
  return client.replyMessage(replyToken, { type: 'text', text: '7/10 屋根の種類を選んでください', quickReply: quickReply(items) });
}
async function askQ8(replyToken, userId) {
  const items = ['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'].map(v => actionItem(v, qs.stringify({ q: 8, v }), ICONS.leak));
  return client.replyMessage(replyToken, { type: 'text', text: '8/10 雨漏りの状況を選んでください', quickReply: quickReply(items) });
}
async function askQ9(replyToken, userId) {
  const items = ['30cm以下','50cm以下','70cm以下','70cm以上'].map(v => actionItem(v, qs.stringify({ q: 9, v }), ICONS.distance));
  return client.replyMessage(replyToken, { type: 'text', text: '9/10 周辺との最短距離を選んでください（足場設置の目安）', quickReply: quickReply(items) });
}
async function askQ10_Begin(replyToken, userId) {
  const s = getSession(userId);
  s.expectingPhoto = true;
  s.photoIndex = 0;
  return askNextPhoto(replyToken, userId, false, true);
}
async function askNextPhoto(replyToken, userId, skipped = false, first = false) {
  const s = getSession(userId);
  if (!s.expectingPhoto) s.expectingPhoto = true;

  if (!first && skipped) await replyText(replyToken, 'スキップしました。');
  if (!first) s.photoIndex += 1;

  if (s.photoIndex >= PHOTO_STEPS.length) {
    await replyText(replyToken, '集計中です…');
    await finishAndNotify(userId);
    return;
  }

  const current = PHOTO_STEPS[s.photoIndex];
  const prompt = `10/10 写真アップロード\n「${current.label}」を送ってください。`;
  const items = [
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'camera', label: 'カメラを起動' } },
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'cameraRoll', label: 'アルバムから選択' } },
    { type: 'action', imageUrl: ICONS.skip, action: { type: 'message', label: 'スキップ', text: 'スキップ' } },
    { type: 'action', imageUrl: ICONS.skip, action: { type: 'message', label: '完了', text: '完了' } },
  ];
  return client.replyMessage(replyToken, { type: 'text', text: prompt, quickReply: { items } });
}

// ====== 概算ロジック ======
function estimateCost(a) {
  const base = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装＋屋根塗装': 900000 };
  const floors = { '1階建て': 1.0, '2階建て': 1.2, '3階建て': 1.4 };
  const layout = {
    '1DK': 0.9, '1LDK': 0.95, '2DK': 1.0, '2LDK': 1.05,
    '3DK': 1.1, '3LDK': 1.15, '4DK': 1.2, '4LDK': 1.25, '5DK': 1.3, '5LDK': 1.35,
  };
  const wall = { 'モルタル': 1.05, 'サイディング': 1.0, 'タイル': 1.15, 'ALC': 1.1 };
  const roof = { '瓦': 1.1, 'スレート': 1.0, 'ガルバリウム': 1.05, 'トタン': 0.95 };
  const leak = { '雨の日に水滴が落ちる': 1.15, '天井にシミがある': 1.1, '雨漏りはない': 1.0 };
  const dist = { '30cm以下': 1.2, '50cm以下': 1.15, '70cm以下': 1.1, '70cm以上': 1.0 };
  const years = {
    '1〜5年': 0.95, '5〜10年': 1.0, '10〜15年': 1.05, '15〜20年': 1.1,
    '20〜30年': 1.15, '30〜40年': 1.2, '40年以上': 1.25, '0年（新築）': 0.9,
  };

  let cost = base[a.q3] || 600000;
  cost *= floors[a.q1] || 1.0;
  cost *= layout[a.q2] || 1.0;
  cost *= wall[a.q6] || 1.0;
  cost *= leak[a.q8] || 1.0;
  cost *= dist[a.q9] || 1.0;
  if (a.q3 === '屋根塗装' || a.q3 === '外壁塗装＋屋根塗装') cost *= roof[a.q7] || 1.0;
  if (a.q4 === 'ある') cost *= years[a.q5] || 1.0;

  return Math.round(cost / 1000) * 1000;
}
function yen(n) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
}

// ====== 完了処理（集計→案内） ======
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

  const disclaimer =
    '※表示金額は概算の目安です。実際の建物形状・劣化状況・足場条件・使用塗料により変動します。' +
    '担当者が詳細確認のうえ正式お見積りをご案内します。';

  // 受付コードの作成・保存（失敗しても進む）
  let code = '';
  try {
    code = genCode();
    await createHandoffRow({ code, userId, answers: a, photos: s.photos });
  } catch (e) {
    console.error('createHandoff error:', e);
  }

  await sendPushSafe(userId, { type: 'text', text: summary });
  await sendPushSafe(userId, { type: 'text', text: `概算金額：${yen(estimate)}\n\n${disclaimer}` });

  if (code) {
    // Flex（失敗時はテキストにフォールバック）
    try {
      await sendPushSafe(userId, handoffFlex(code));
    } catch (e) {
      console.error('flex push failed:', e?.response?.data || e);
      await sendPushSafe(userId, {
        type: 'text',
        text: `より詳しい見積もりをご希望の方は、こちらから → ${FRIEND_ADD_URL}\n受付コード：${code}`,
      });
    }
  } else {
    await sendPushSafe(userId, {
      type: 'text',
      text: `より詳しい見積もりをご希望の方は、こちらから → ${FRIEND_ADD_URL}\n（受付コードの発行に失敗しました）`,
    });
  }

  await sendPushSafe(userId, { type: 'text', text: '最初からやり直す場合は「リセット」と送ってください。' });
}
