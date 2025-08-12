/**
 * 外壁塗装・概算見積りボット（Render + LINE + Supabase）
 * - 質問→ボタン回答→画像収集→概算算出
 * - 画像は Supabase Storage（photos バケット）へ保存（安全な英数ファイル名に自動変換）
 * - 完了時に 6桁の受付コードを発行し、answers と photos を handoff テーブルへ保存
 * - Flex メッセージの「詳細見積もりを希望する」ボタンで @189ujduc へ誘導
 *
 * 必須環境変数:
 *  CHANNEL_SECRET, CHANNEL_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * 任意:
 *  PORT（Render では自動で渡る。なければ 10000）
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import qs from 'qs';
import { createClient } from '@supabase/supabase-js';

// ========== 設定 ==========
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[ERROR] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN is missing');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 友だち追加URL（チャット対応アカウント）
const FRIEND_ADD_URL = 'https://line.me/R/ti/p/@189ujduc';
const STORAGE_BUCKET = 'photos'; // 事前に作成＆Publicにしておく

// ========== アプリ ==========
const client = new line.Client(config);
const app = express();

// Health check
app.get('/health', (_, res) => res.status(200).send('healthy'));

// Webhook（POSTのみ）
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('LINE bot listening on', PORT));

// ========== 簡易セッション（本番はRedis/DB推奨） ==========
const sessions = new Map(); // key=userId -> { step, answers, photoIndex, photos[], expectingPhoto }

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 1,
      answers: {},
      photoIndex: 0,
      photos: [],          // {key, label, url}
      expectingPhoto: false,
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, { step: 1, answers: {}, photoIndex: 0, photos: [], expectingPhoto: false });
}

// ========== 定義 ==========
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

// 10/10 画像の順序
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

// ========== ユーティリティ ==========
function quickReply(items) { return { items }; }
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

function yen(n) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
}

function randomCode6() {
  return (Math.floor(100000 + Math.random() * 900000)).toString();
}

// stream → Buffer
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// 安全なファイル名（日本語含む任意文字列 → 英数と - _ のみに）
function sanitizeFilename(name) {
  const base = name
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')   // 非ASCIIを落とす
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return base || 'file';
}

// ========== メイン処理 ==========
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // 友だち追加
  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(
      event.replyToken,
      '友だち追加ありがとうございます！\n外壁・屋根塗装の【かんたん概算見積り】をご案内します。\nはじめますか？「見積もり」または「スタート」を送ってください。'
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

      // 画像待ち中のテキスト
      const s = getSession(userId);
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(text)) {
          return askNextPhoto(event.replyToken, userId, true);
        }
        if (/^(完了|終了|おわり)$/i.test(text)) {
          s.photoIndex = PHOTO_STEPS.length;
          return finishAndEstimate(event.replyToken, userId);
        }
        return replyText(event.replyToken, '画像を送信してください。スキップは「スキップ」と送ってください。');
      }

      return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。');
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

      // 今の写真のラベル（返信文で使用）
      const current = PHOTO_STEPS[s.photoIndex] || { label: '写真', key: 'photo' };

      // 保存（非同期、返信は待たない）
      saveImageToSupabase(userId, message.id, s).catch(err => console.error('saveImageToSupabase', err));

      // 受領メッセージ＋次の案内（クイックリプライはこの返信の最後に付く）
      return askNextPhoto(event.replyToken, userId, false, false, `受け取りました：${current.label}`);
    }

    // その他の type は無視
    return;
  }

  // Postback
  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data);
    const q = Number(data.q);
    const v = data.v;
    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    const s = getSession(userId);
    s.answers[`q${q}`] = v;

    // Q4 の分岐（「ない」「わからない」は Q5 を自動で「該当なし」）
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

// ========== 質問 ==========
async function askQ1(replyToken, userId) {
  const s = getSession(userId); s.step = 1;
  const items = [
    actionItem('1階建て', qs.stringify({ q: 1, v: '1階建て' }), ICONS.floor),
    actionItem('2階建て', qs.stringify({ q: 1, v: '2階建て' }), ICONS.floor),
    actionItem('3階建て', qs.stringify({ q: 1, v: '3階建て' }), ICONS.floor),
  ];
  return client.replyMessage(replyToken, {
    type: 'text', text: '1/10 住宅の階数を選んでください', quickReply: quickReply(items),
  });
}
async function askQ2(replyToken, userId) {
  const layouts = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  const items = layouts.map(l => actionItem(l, qs.stringify({ q: 2, v: l }), ICONS.layout));
  return client.replyMessage(replyToken, {
    type: 'text', text: '2/10 住宅の間取りを選んでください', quickReply: quickReply(items),
  });
}
async function askQ3(replyToken, userId) {
  const items = [
    actionItem('外壁塗装', qs.stringify({ q: 3, v: '外壁塗装' }), ICONS.paint),
    actionItem('屋根塗装', qs.stringify({ q: 3, v: '屋根塗装' }), ICONS.paint),
    actionItem('外壁＋屋根', qs.stringify({ q: 3, v: '外壁塗装＋屋根塗装' }), ICONS.paint, '外壁塗装＋屋根塗装'),
  ];
  return client.replyMessage(replyToken, {
    type: 'text', text: '3/10 希望する工事内容を選んでください', quickReply: quickReply(items),
  });
}
async function askQ4(replyToken, userId) {
  const items = [
    actionItem('ある', qs.stringify({ q: 4, v: 'ある' }), ICONS.yes),
    actionItem('ない', qs.stringify({ q: 4, v: 'ない' }), ICONS.no),
    actionItem('わからない', qs.stringify({ q: 4, v: 'わからない' }), ICONS.no),
  ];
  return client.replyMessage(replyToken, {
    type: 'text', text: '4/10 これまで外壁塗装をしたことはありますか？', quickReply: quickReply(items),
  });
}
async function askQ5(replyToken, userId) {
  const years = ['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  const items = years.map(y => actionItem(y, qs.stringify({ q: 5, v: y }), ICONS.years));
  return client.replyMessage(replyToken, {
    type: 'text', text: '5/10 前回の外壁塗装からどのくらい経っていますか？', quickReply: quickReply(items),
  });
}
async function askQ6(replyToken, userId) {
  const items = ['モルタル','サイディング','タイル','ALC'].map(v => actionItem(v, qs.stringify({ q: 6, v }), ICONS.wall));
  return client.replyMessage(replyToken, {
    type: 'text', text: '6/10 外壁の種類を選んでください', quickReply: quickReply(items),
  });
}
async function askQ7(replyToken, userId) {
  const items = ['瓦','スレート','ガルバリウム','トタン'].map(v => actionItem(v, qs.stringify({ q: 7, v }), ICONS.roof));
  return client.replyMessage(replyToken, {
    type: 'text', text: '7/10 屋根の種類を選んでください', quickReply: quickReply(items),
  });
}
async function askQ8(replyToken, userId) {
  const items = ['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'].map(v => actionItem(v, qs.stringify({ q: 8, v }), ICONS.leak));
  return client.replyMessage(replyToken, {
    type: 'text', text: '8/10 雨漏りの状況を選んでください', quickReply: quickReply(items),
  });
}
async function askQ9(replyToken, userId) {
  const items = ['30cm以下','50cm以下','70cm以下','70cm以上'].map(v => actionItem(v, qs.stringify({ q: 9, v }), ICONS.distance));
  return client.replyMessage(replyToken, {
    type: 'text', text: '9/10 周辺との最短距離を選んでください（足場設置の目安）', quickReply: quickReply(items),
  });
}

// 画像の1問目へ
async function askQ10_Begin(replyToken, userId) {
  const s = getSession(userId);
  s.expectingPhoto = true;
  s.photoIndex = 0;
  return askNextPhoto(replyToken, userId, false, true);
}

/**
 * 画像の次案内を返信
 * @param preface 先頭に添える一言（「受け取りました」など） null可
 */
async function askNextPhoto(replyToken, userId, skipped = false, first = false, preface = null) {
  const s = getSession(userId);
  if (!s.expectingPhoto) s.expectingPhoto = true;

  if (!first) {
    // 直前の「受領 or スキップ」を反映して次へ
    s.photoIndex += 1;
  }

  if (skipped && preface === null) {
    preface = 'スキップしました。';
  }

  // 全部終わった？
  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    return finishAndEstimate(replyToken, userId);
  }

  const current = PHOTO_STEPS[s.photoIndex];
  const prompt = `10/10 写真アップロード\n「${current.label}」を送ってください。`;

  const items = [
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'camera', label: 'カメラを起動' } },
    { type: 'action', imageUrl: ICONS.camera, action: { type: 'cameraRoll', label: 'アルバムから選択' } },
    { type: 'action', imageUrl: ICONS.skip, action: { type: 'message', label: 'スキップ', text: 'スキップ' } },
    { type: 'action', imageUrl: ICONS.skip, action: { type: 'message', label: '完了', text: '完了' } },
  ];

  const msgs = [];
  if (preface) msgs.push({ type: 'text', text: preface });
  // 最後の要素に quickReply を付与（これが後続pushで消えないよう、返信は1回のみ）
  msgs.push({ type: 'text', text: prompt, quickReply: { items } });

  return client.replyMessage(replyToken, msgs);
}

// ========== 画像保存（LINE → Supabase Storage） ==========
async function saveImageToSupabase(userId, messageId, session) {
  const current = PHOTO_STEPS[session.photoIndex] || { key: 'photo', label: '写真' };

  // LINEからデータ取得
  const stream = await client.getMessageContent(messageId);
  const buffer = await streamToBuffer(stream);

  // ファイル名（日本語不可対策）： user/タイムスタンプ_key.jpg
  const base = sanitizeFilename(`${Date.now()}_${current.key}.jpg`);
  const path = `${sanitizeFilename(userId)}/${base}`;

  const { error } = await supabase
    .storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, { contentType: 'image/jpeg', upsert: false });

  if (error) throw error;

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const url = data.publicUrl;

  session.photos.push({ key: current.key, label: current.label, url });
}

// ========== 見積りロジック（ダミー係数） ==========
function estimateCost(a) {
  const baseByWork = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装＋屋根塗装': 900000 };
  const floors = { '1階建て': 1.0, '2階建て': 1.2, '3階建て': 1.4 };
  const layout = {
    '1DK': 0.9, '1LDK': 0.95, '2DK': 1.0, '2LDK': 1.05,
    '3DK': 1.1, '3LDK': 1.15, '4DK': 1.2, '4LDK': 1.25,
    '5DK': 1.3, '5LDK': 1.35,
  };
  const wall = { 'モルタル': 1.05, 'サイディング': 1.0, 'タイル': 1.15, 'ALC': 1.1 };
  const roof = { '瓦': 1.1, 'スレート': 1.0, 'ガルバリウム': 1.05, 'トタン': 0.95 };
  const leak = { '雨の日に水滴が落ちる': 1.15, '天井にシミがある': 1.1, '雨漏りはない': 1.0 };
  const dist = { '30cm以下': 1.2, '50cm以下': 1.15, '70cm以下': 1.1, '70cm以上': 1.0 };
  const years = {
    '1〜5年': 0.95, '5〜10年': 1.0, '10〜15年': 1.05, '15〜20年': 1.1,
    '20〜30年': 1.15, '30〜40年': 1.2, '40年以上': 1.25, '0年（新築）': 0.9,
  };

  let cost = baseByWork[a.q3] || 600000;
  cost *= floors[a.q1] || 1.0;
  cost *= layout[a.q2] || 1.0;
  cost *= wall[a.q6] || 1.0;
  cost *= leak[a.q8] || 1.0;
  cost *= dist[a.q9] || 1.0;
  if (a.q3 === '屋根塗装' || a.q3 === '外壁塗装＋屋根塗装') cost *= roof[a.q7] || 1.0;
  if (a.q4 === 'ある') cost *= years[a.q5] || 1.0;

  return Math.round(cost / 1000) * 1000;
}

// ========== 完了（受付コード発行＋誘導） ==========
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

  const disclaimer =
    '※表示金額は概算の目安です。実際の建物形状・劣化状況・足場条件・使用塗料により変動します。担当者が詳細確認のうえ正式お見積りをご案内します。';

  // 受付コードを発行してDBへ保存
  let code = '';
  try {
    code = randomCode6();
    const { error } = await supabase.from('handoff').insert({
      code,
      src_user_id: userId,
      answers: a,
      photos: s.photos,       // [{key,label,url}, ...]
      status: 'open',
    });
    if (error) throw error;
  } catch (e) {
    console.error('save handoff failed:', e);
  }

  // 誘導用 Flex
  const handoffFlex = {
    type: 'flex',
    altText: '詳しい見積もりのご案内',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: 'より詳しい見積もりをご希望の方へ', weight: 'bold', size: 'md' },
          { type: 'text', wrap: true, size: 'sm',
            text: '現地調査なしで1営業日以内にお見積りを差し上げます。ご希望の方は下のボタンからご連絡ください。' },
          { type: 'text', text: `受付コード：${code}`, size: 'sm', color: '#666', margin: 'md' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'button', style: 'primary',
            action: { type: 'uri', label: '詳細見積もりを希望する', uri: FRIEND_ADD_URL } },
          { type: 'text', text: '※ボタンで友だち追加し、受付コードを送ってください。', size: 'xs', color: '#999', wrap: true }
        ],
      },
    },
  };

  const msgs = [
    { type: 'text', text: summary },
    { type: 'text', text: `概算金額：${yen(estimate)}\n\n${disclaimer}` },
    handoffFlex,
  ];

  await client.replyMessage(replyToken, msgs);

  // 次回の案内
  await client.pushMessage(userId, {
    type: 'text',
    text: '最初からやり直す場合は「リセット」と送ってください。'
  });
}
