/**
 * LINE外壁塗装・概算見積りボット（Node.js）
 * ------------------------------------------------------------
 * ・LINEのトーク内だけで、質問→ボタン回答→画像アップロード→概算算出まで完結。
 * ・Quick Reply（最大13件）とPostbackで分岐。
 * ・写真は順番にお願いし、受信ごとに保管。
 * ・概算は“仮ロジック”。係数はダミーなので必ず実情に合わせて修正してください。
 *
 * 必要環境変数（.envなどに設定）
 *  - CHANNEL_SECRET
 *  - CHANNEL_ACCESS_TOKEN
 *  - PORT（省略可。デフォルト 3000）
 *
 * 依存関係（package.json）
 *  {
 *    "type": "module",
 *    "dependencies": {
 *      "@line/bot-sdk": "^9.0.3",
 *      "axios": "^1.7.2",
 *      "express": "^4.19.2",
 *      "qs": "^6.12.1"
 *    }
 *  }
 *
 * Webhook URL を LINE Official Account Manager に登録してください。
 * 例: https://your-domain.com/webhook
 */
import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import fs from 'fs';
import path from 'path';
import qs from 'qs';

// ========================= 基本設定 =========================
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

if (!config.channelSecret || !config.channelAccessToken) {
  console.error('\n[ERROR] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です。');
  process.exit(1);
}

const client = new line.Client(config);
const app = express();

// LINE署名検証のため、ミドルウェアは line.middleware を使用
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

app.get('/health', (req, res) => res.status(200).send('healthy'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LINE bot listening on ${PORT}`));

// ========================= 簡易セッション =========================
/**
 * 本番運用では Redis / DB を利用してください。
 * ここではサンプルとしてプロセス内の Map を使用します。
 */
const sessions = new Map(); // key: userId, value: { step, answers, photoIndex, photos: [], expectingPhoto }

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

// ========================= 定義・選択肢 =========================
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

// Q10 の写真収集順序
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

// ========================= イベントハンドラ =========================
async function handleEvent(event) {
  // userId 取得（グループ対応は省略）
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    // 友だち追加時にご挨拶
    resetSession(userId);
    return replyText(event.replyToken, [
      '友だち追加ありがとうございます！\n\n外壁・屋根塗装の【かんたん概算見積り】をトーク上でご案内します。',
      'はじめますか？「見積もり」または「スタート」を送ってください。',
    ].join('\n'));
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

      // 写真待ちのときにテキストが来た場合（スキップや完了など）
      const s = getSession(userId);
      if (s.expectingPhoto) {
        if (/^(スキップ|skip)$/i.test(text)) {
          await askNextPhoto(event.replyToken, userId, true); // スキップ扱い
          return;
        }
        if (/^(完了|おわり|終了)$/i.test(text)) {
          // 写真収集を途中終了
          s.photoIndex = PHOTO_STEPS.length; // 終端へ
          return finishAndEstimate(event.replyToken, userId);
        }
        // それ以外
        return replyText(event.replyToken, '画像を送信してください。\nスキップする場合は「スキップ」と送ってください。');
      }

      // 未知のテキストはヘルプ
      return replyText(event.replyToken, 'ご希望の方は「見積もり」または「スタート」と送ってください。\n途中の方はボタンをタップしてください。');
    }

    if (message.type === 'image') {
      const s = getSession(userId);
      if (!s.expectingPhoto) {
        return replyText(event.replyToken, 'ありがとうございます！\nただいま質問中です。\n「見積もり」で最初から始めるか、続きのボタンをタップしてください。');
      }
      // 画像保存
      await saveImageMessage(userId, message.id, s);
      return askNextPhoto(event.replyToken, userId, false); // 次の写真へ
    }

    // それ以外のメッセージタイプは無視
    return;
  }

  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data);
    const s = getSession(userId);

    // データ例: { q: '1', v: '1階建て' }
    const q = Number(data.q);
    const v = data.v;

    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    // 回答保存
    s.answers[`q${q}`] = v;

    // 分岐：Q4の回答次第でQ5をスキップ
    if (q === 4) {
      if (v === 'ない' || v === 'わからない') {
        s.answers['q5'] = '該当なし';
        s.step = 6;
        return askQ6(event.replyToken, userId);
      }
    }

    // 次の質問へ
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

// ========================= 質問送信 =========================
function quickReply(items) {
  return { items };
}

function actionItem(label, data, imageUrl, displayText) {
  return {
    type: 'action',
    imageUrl,
    action: {
      type: 'postback',
      label,
      data,
      displayText: displayText || label,
    },
  };
}

async function askQ1(replyToken, userId) {
  const s = getSession(userId);
  s.step = 1;
  const text = '1/10 住宅の階数を選んでください';
  const items = [
    actionItem('1階建て', qs.stringify({ q: 1, v: '1階建て' }), ICONS.floor),
    actionItem('2階建て', qs.stringify({ q: 1, v: '2階建て' }), ICONS.floor),
    actionItem('3階建て', qs.stringify({ q: 1, v: '3階建て' }), ICONS.floor),
  ];
  return client.replyMessage(replyToken, {
    type: 'text',
    text,
    quickReply: quickReply(items),
  });
}

async function askQ2(replyToken, userId) {
  const text = '2/10 住宅の間取りを選んでください';
  const layouts = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  const items = layouts.map(l => actionItem(l, qs.stringify({ q: 2, v: l }), ICONS.layout));
  return client.replyMessage(replyToken, { type: 'text', text, quickReply: quickReply(items) });
}

async function askQ3(replyToken, userId) {
  const text = '3/10 希望する工事内容を選んでください';
  const items = [
    actionItem('外壁塗装', qs.stringify({ q: 3, v: '外壁塗装' }), ICONS.paint),
    actionItem('屋根塗装', qs.stringify({ q: 3, v: '屋根塗装' }), ICONS.paint),
    actionItem('外壁＋屋根', qs.stringify({ q: 3, v: '外壁塗装＋屋根塗装' }), ICONS.paint, '外壁塗装＋屋根塗装'),
  ];
  return client.replyMessage(replyToken, { type: 'text', text, quickReply: quickReply(items) });
}

async function askQ4(replyToken, userId) {
  const text = '4/10 これまで外壁塗装をしたことはありますか？';
  const items = [
    actionItem('ある', qs.stringify({ q: 4, v: 'ある' }), ICONS.yes),
    actionItem('ない', qs.stringify({ q: 4, v: 'ない' }), ICONS.no),
    actionItem('わからない', qs.stringify({ q: 4, v: 'わからない' }), ICONS.no),
  ];
  return client.replyMessage(replyToken, { type: 'text', text, quickReply: quickReply(items) });
}

async function askQ5(replyToken, userId) {
  const text = '5/10 前回の外壁塗装からどのくらい経っていますか？';
  const years = ['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  const items = years.map(y => actionItem(y, qs.stringify({ q: 5, v: y }), ICONS.years));
  return client.replyMessage(replyToken, { type: 'text', text, quickReply: quickReply(items) });
}

async function askQ6(replyToken, userId) {
  const text = '6/10 外壁の種類を選んでください';
  const items = ['モルタル','サイディング','タイル','ALC'].map(v => actionItem(v, qs.stringify({ q: 6, v }), ICONS.wall));
  return client.replyMessage(replyToken, { type: 'text', text, quickReply: quickReply(items) });
}

async function askQ7(replyToken, userId) {
  const text = '7/10 屋根の種類を選んでください';
  const items = ['瓦','スレート','ガルバリウム','トタン'].map(v => actionItem(v, qs.stringify({ q: 7, v }), ICONS.roof));
  return client.replyMessage(replyToken, { type: 'text', text, quickReply: quickReply(items) });
}

async function askQ8(replyToken, userId) {
  const text = '8/10 雨漏りの状況を選んでください';
  const items = ['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'].map(v => actionItem(v, qs.stringify({ q: 8, v }), ICONS.leak));
  return client.replyMessage(replyToken, { type: 'text', text, quickReply: quickReply(items) });
}

async function askQ9(replyToken, userId) {
  const text = '9/10 周辺との最短距離を選んでください（足場設置の目安）';
  const items = ['30cm以下','50cm以下','70cm以下','70cm以上'].map(v => actionItem(v, qs.stringify({ q: 9, v }), ICONS.distance));
  return client.replyMessage(replyToken, { type: 'text', text, quickReply: quickReply(items) });
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

  if (!first && skipped) {
    // スキップした旨を通知
    await replyText(replyToken, 'スキップしました。');
  }

  // 次のインデックスへ（受信またはスキップ後）
  if (!first) s.photoIndex += 1;

  if (s.photoIndex >= PHOTO_STEPS.length) {
    // 全部終了
    s.expectingPhoto = false;
    return finishAndEstimate(replyToken, userId);
  }

  const current = PHOTO_STEPS[s.photoIndex];
  const prompt = `10/10 写真アップロード\n「${current.label}」を送ってください。`; // 任意のものはスキップ可

  const items = [
    {
      type: 'action',
      imageUrl: ICONS.camera,
      action: { type: 'camera', label: 'カメラを起動' },
    },
    {
      type: 'action',
      imageUrl: ICONS.camera,
      action: { type: 'cameraRoll', label: 'アルバムから選択' },
    },
    {
      type: 'action',
      imageUrl: ICONS.skip,
      action: { type: 'message', label: 'スキップ', text: 'スキップ' },
    },
    {
      type: 'action',
      imageUrl: ICONS.skip,
      action: { type: 'message', label: '完了', text: '完了' },
    },
  ];

  return client.replyMessage(replyToken, {
    type: 'text',
    text: prompt,
    quickReply: { items },
  });
}

// ========================= 画像保存 =========================
async function saveImageMessage(userId, messageId, session) {
  try {
    const stream = await client.getMessageContent(messageId);
    const dir = path.join(process.cwd(), 'uploads', userId);
    await fs.promises.mkdir(dir, { recursive: true });

    const current = PHOTO_STEPS[session.photoIndex] || { key: `photo_${Date.now()}` };
    const filename = `${current.key}_${Date.now()}.jpg`;
    const fullpath = path.join(dir, filename);

    // stream は Readable
    const write = fs.createWriteStream(fullpath);
    await new Promise((resolve, reject) => {
      stream.pipe(write);
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    session.photos.push({ key: current.key, path: fullpath });
    await client.pushMessage(userId, { type: 'text', text: `受け取りました：${current.label}` });
  } catch (err) {
    console.error('saveImageMessage error:', err);
    await client.pushMessage(userId, { type: 'text', text: '画像の保存に失敗しました。もう一度お試しください。' });
  }
}

// ========================= 概算見積り（ダミー係数） =========================
/**
 * 注意：以下はダミーの概算ロジックです。必ず実勢に合わせて調整してください。
 */
function estimateCost(answers) {
  // ベース価格（税別の想定）
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

  const work = answers.q3;
  let cost = baseByWork[work] || 600000; // デフォルト

  cost *= floorsFactor[answers.q1] || 1.0;
  cost *= layoutFactor[answers.q2] || 1.0;
  cost *= wallFactor[answers.q6] || 1.0;
  cost *= leakFactor[answers.q8] || 1.0;
  cost *= distanceFactor[answers.q9] || 1.0;

  // 屋根係数（屋根を含む場合のみ）
  if (work === '屋根塗装' || work === '外壁塗装＋屋根塗装') {
    cost *= roofFactor[answers.q7] || 1.0;
  }

  // 前回塗装時期（「ある」場合のみ）
  if (answers.q4 === 'ある') {
    cost *= yearsFactor[answers.q5] || 1.0;
  }

  // 端数処理（千円単位に丸め）
  cost = Math.round(cost / 1000) * 1000;

  return cost;
}

function yen(n) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
}

// ========================= 完了・サマリ =========================
async function finishAndEstimate(replyToken, userId) {
  const s = getSession(userId);
  s.expectingPhoto = false;
  s.step = 11;

  const a = s.answers;
  const estimate = estimateCost(a);

  const summary = [
    '【回答の確認】',
    `・階数: ${a.q1 || '-'}\n・間取り: ${a.q2 || '-'}\n・工事内容: ${a.q3 || '-'}`,
    `・過去の外壁塗装: ${a.q4 || '-'}\n・前回からの年数: ${a.q5 || '該当なし'}`,
    `・外壁種類: ${a.q6 || '-'}\n・屋根種類: ${a.q7 || '-'}`,
    `・雨漏り: ${a.q8 || '-'}\n・最短距離: ${a.q9 || '-'}`,
    `・受領写真枚数: ${s.photos.length}枚`,
  ].join('\n');

  const disclaimer = '※表示金額は概算の目安です。実際の建物形状・劣化状況・足場条件・使用塗料により変動します。担当者が詳細確認のうえ正式お見積りをご案内します。';

  await client.replyMessage(replyToken, [
    { type: 'text', text: summary },
    { type: 'text', text: `概算金額：${yen(estimate)}\n\n${disclaimer}` },
  ]);

  // 完了後もやり直せるようにガイド
  await client.pushMessage(userId, {
    type: 'text',
    text: 'この内容で担当者に共有しました。\n最初からやり直す場合は「リセット」と送ってください。',
  });
}

// ========================= 送信用ユーティリティ =========================
function replyText(replyToken, text) {
  return client.replyMessage(replyToken, { type: 'text', text });
}
