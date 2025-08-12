/**
 * 外壁塗装 見積ボット（画像付きボタン / 写真アップ復活・保存しない）
 * Node.js + Express + LINE Messaging API
 */
import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import axios from 'axios';
import qs from 'qs';

// ============ LINE 基本設定 ============
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[ERROR] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です');
  process.exit(1);
}
const client = new line.Client(config);
const app = express();

// ============ セッション（簡易・メモリ） ============
const sessions = new Map();
const FLOW = {
  NONE: 'none',
  HANDOFF_NAME: 'handoff_name',
  HANDOFF_ZIP: 'handoff_zip',
  HANDOFF_ADDR_DETAIL: 'handoff_addr_detail',
};
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 1,
      answers: {},
      // 画像関連（保存せず、枚数/進行だけ管理）
      expectingPhoto: false,
      photoIndex: 0,
      photosCount: 0,
      // 連絡先入力フロー
      flow: FLOW.NONE,
      contact: { name: '', zip: '', addr1: '', addr2: '' },
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, {
    step: 1,
    answers: {},
    expectingPhoto: false,
    photoIndex: 0,
    photosCount: 0,
    flow: FLOW.NONE,
    contact: { name: '', zip: '', addr1: '', addr2: '' },
  });
}

// ============ 画像URL（差し替えOKなプレースホルダー） ============
const PH = (t) => `https://placehold.co/800x800/png?text=${encodeURIComponent(t)}`;

// ============ 写真アップロードの手順 ============
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

// ============ Webhook ============
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).send('Error');
  }
});

// Health
app.get('/health', (_, res) => res.status(200).send('healthy'));

// Listen
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LINE bot listening on ${PORT}`));

// ============ 共通ユーティリティ ============
function replyText(replyToken, text) {
  return client.replyMessage(replyToken, { type: 'text', text });
}
async function pushText(userId, text) {
  return client.pushMessage(userId, { type: 'text', text });
}

// 画像付きカード（Flex）の生成
function buildOptionsFlex(qNum, question, options) {
  // options: [{label, value, imageUrl}]
  const bubbles = options.map(opt => ({
    type: 'bubble',
    hero: {
      type: 'image',
      url: opt.imageUrl,
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'cover',
      action: {
        type: 'postback',
        label: opt.label,
        data: qs.stringify({ q: qNum, v: opt.value }),
        displayText: opt.label,
      },
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: opt.label, weight: 'bold', size: 'sm', wrap: true, align: 'center' },
      ],
      spacing: 'sm',
      paddingAll: '12px',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          action: {
            type: 'postback',
            label: '選択する',
            data: qs.stringify({ q: qNum, v: opt.value }),
            displayText: opt.label,
          }
        }
      ]
    }
  }));

  return {
    type: 'flex',
    altText: question,
    contents: { type: 'carousel', contents: bubbles.slice(0, 10) } // 10件まで
  };
}

function makeOptionsFromLabels(labels, labelToImage = {}) {
  return labels.map(l => ({
    label: l,
    value: l,
    imageUrl: labelToImage[l] || PH(l),
  }));
}

async function sendImageOptions(replyToken, qNum, question, labels, labelToImage) {
  const options = makeOptionsFromLabels(labels, labelToImage);
  const flex = buildOptionsFlex(qNum, question, options);
  return client.replyMessage(replyToken, [
    { type: 'text', text: question },
    flex
  ]);
}

// 郵便番号→住所(都道府県市区町村) 取得（zipcloud）
async function lookupZip(zip7) {
  try {
    const r = await axios.get('https://zipcloud.ibsnet.co.jp/api/search', { params: { zipcode: zip7 } });
    if (r.data && r.data.results && r.data.results[0]) {
      const z = r.data.results[0];
      return `${z.address1}${z.address2}${z.address3}`;
    }
  } catch (e) {
    console.error('lookupZip error', e?.response?.data || e.message);
  }
  return '';
}

// ============ イベントハンドラ ============
async function handleEvent(event) {
  const userId = event?.source?.userId;
  if (!userId) return;

  // 友だち追加
  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(
      event.replyToken,
      '友だち追加ありがとうございます！\n外壁・屋根塗装の【かんたん概算見積り】をご案内します。\nはじめますか？「見積もり」または「スタート」を送ってください。'
    );
  }

  // テキスト
  if (event.type === 'message' && event.message.type === 'text') {
    const text = (event.message.text || '').trim();
    const s = getSession(userId);

    // 連絡先フロー
    if (s.flow !== FLOW.NONE) {
      if (s.flow === FLOW.HANDOFF_NAME) {
        s.contact.name = text;
        s.flow = FLOW.HANDOFF_ZIP;
        return replyText(event.replyToken, 'ありがとうございます。郵便番号（例：123-4567）を入力してください。');
      }
      if (s.flow === FLOW.HANDOFF_ZIP) {
        const zip = text.replace(/[^\d]/g, '');
        if (zip.length !== 7) return replyText(event.replyToken, '郵便番号は7桁で入力してください。（例：123-4567）');
        s.contact.zip = zip;
        const addr1 = await lookupZip(zip);
        if (!addr1) return replyText(event.replyToken, '住所が見つかりませんでした。もう一度郵便番号を入力してください。');
        s.contact.addr1 = addr1;
        s.flow = FLOW.HANDOFF_ADDR_DETAIL;
        return replyText(event.replyToken, `住所の続き（番地・建物名・部屋番号）を入力してください。\n\n現在：${addr1} `);
      }
      if (s.flow === FLOW.HANDOFF_ADDR_DETAIL) {
        s.contact.addr2 = text;
        s.flow = FLOW.NONE;
        return replyText(
          event.replyToken,
          `受付しました！\n\nお名前：${s.contact.name}\n住所：${s.contact.addr1}${s.contact.addr2}\n\n担当より1営業日以内にご連絡します。`
        );
      }
    }

    // 共通コマンド
    if (/^(最初から|リセット)$/i.test(text)) {
      resetSession(userId);
      return replyText(event.replyToken, '回答をリセットしました。\n「見積もり」または「スタート」を送ってください。');
    }
    if (/^(見積もり|スタート|start)$/i.test(text)) {
      resetSession(userId);
      return askQ1(event.replyToken, userId);
    }

    // 写真待ち中にテキスト
    if (s.expectingPhoto) {
      if (/^(スキップ|skip)$/i.test(text)) return askNextPhoto(event.replyToken, userId, true);
      if (/^(完了|おわり|終了)$/i.test(text)) {
        s.photoIndex = PHOTO_STEPS.length;
        return finishAndEstimate(event.replyToken, userId);
      }
      return replyText(event.replyToken, '画像を送信してください。スキップは「スキップ」と送ってください。');
    }

    // ガイド
    return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。');
  }

  // 画像（保存しない：受領→次の案内）
  if (event.type === 'message' && event.message.type === 'image') {
    const s = getSession(userId);
    if (!s.expectingPhoto) {
      return replyText(event.replyToken, 'ありがとうございます。現在質問中です。続きのボタンをタップしてください。');
    }
    const current = PHOTO_STEPS[s.photoIndex] || { label: '写真' };
    s.photosCount += 1;

    // 返信で受領→次の案内を push
    await client.replyMessage(event.replyToken, { type: 'text', text: `受け取りました：${current.label}` });
    return askNextPhoto(null, userId, false); // pushで次へ
  }

  // Postback（画像ボタン含む）
  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data || '');
    const s = getSession(userId);

    // 詳細見積もりボタン
    if (data.action === 'handoff') {
      s.flow = FLOW.HANDOFF_NAME;
      return replyText(event.replyToken, '詳しい見積もりのご依頼ですね。まずお名前をご入力ください。');
    }

    const q = Number(data.q);
    const v = data.v;
    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    s.answers[`q${q}`] = v;

    // Q4の分岐
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
      default: return finishAndEstimate(event.replyToken, userId);
    }
  }
}

// ============ 画像付きボタンで各質問 ============
async function askQ1(replyToken, userId) {
  const s = getSession(userId); s.step = 1;
  const labels = ['1階建て','2階建て','3階建て'];
  const imgs = {
    '1階建て': PH('1F'),
    '2階建て': PH('2F'),
    '3階建て': PH('3F'),
  };
  return sendImageOptions(replyToken, 1, '1/10 住宅の階数を選んでください', labels, imgs);
}

async function askQ2(replyToken) {
  const labels = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  const imgs = Object.fromEntries(labels.map(l => [l, PH(l)]));
  return sendImageOptions(replyToken, 2, '2/10 住宅の間取りを選んでください', labels, imgs);
}

async function askQ3(replyToken) {
  const labels = ['外壁塗装','屋根塗装','外壁塗装＋屋根塗装'];
  const imgs = {
    '外壁塗装': PH('壁'),
    '屋根塗装': PH('屋根'),
    '外壁塗装＋屋根塗装': PH('壁+屋根'),
  };
  return sendImageOptions(replyToken, 3, '3/10 希望する工事内容を選んでください', labels, imgs);
}

async function askQ4(replyToken) {
  const labels = ['ある','ない','わからない'];
  const imgs = {
    'ある': PH('YES'),
    'ない': PH('NO'),
    'わからない': PH('？'),
  };
  return sendImageOptions(replyToken, 4, '4/10 これまで外壁塗装をしたことはありますか？', labels, imgs);
}

async function askQ5(replyToken) {
  const labels = ['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  const imgs = Object.fromEntries(labels.map(l => [l, PH(l)]));
  return sendImageOptions(replyToken, 5, '5/10 前回の外壁塗装からどのくらい経っていますか？', labels, imgs);
}

async function askQ6(replyToken) {
  const labels = ['モルタル','サイディング','タイル','ALC'];
  const imgs = {
    'モルタル': PH('モルタル'),
    'サイディング': PH('サイディング'),
    'タイル': PH('タイル'),
    'ALC': PH('ALC'),
  };
  return sendImageOptions(replyToken, 6, '6/10 外壁の種類を選んでください', labels, imgs);
}

async function askQ7(replyToken) {
  const labels = ['瓦','スレート','ガルバリウム','トタン'];
  const imgs = {
    '瓦': PH('瓦'),
    'スレート': PH('スレート'),
    'ガルバリウム': PH('ガルバ'),
    'トタン': PH('トタン'),
  };
  return sendImageOptions(replyToken, 7, '7/10 屋根の種類を選んでください', labels, imgs);
}

async function askQ8(replyToken) {
  const labels = ['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'];
  const imgs = {
    '雨の日に水滴が落ちる': PH('雨漏り・滴'),
    '天井にシミがある': PH('天井シミ'),
    '雨漏りはない': PH('なし'),
  };
  return sendImageOptions(replyToken, 8, '8/10 雨漏りの状況を選んでください', labels, imgs);
}

async function askQ9(replyToken) {
  const labels = ['30cm以下','50cm以下','70cm以下','70cm以上'];
  const imgs = {
    '30cm以下': PH('≤30cm'),
    '50cm以下': PH('≤50cm'),
    '70cm以下': PH('≤70cm'),
    '70cm以上': PH('≥70cm'),
  };
  return sendImageOptions(replyToken, 9, '9/10 周辺との最短距離を選んでください（足場設置の目安）', labels, imgs);
}

// 画像フロー開始
async function askQ10_Begin(replyToken, userId) {
  const s = getSession(userId);
  s.expectingPhoto = true;
  s.photoIndex = 0;
  return askNextPhoto(replyToken, userId, false, true);
}

async function askNextPhoto(replyTokenOrNull, userId, skipped = false, first = false) {
  const s = getSession(userId);
  if (!s.expectingPhoto) s.expectingPhoto = true;

  if (!first && skipped) {
    if (replyTokenOrNull) await replyText(replyTokenOrNull, 'スキップしました。');
    else await pushText(userId, 'スキップしました。');
  }
  if (!first) s.photoIndex += 1;

  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    if (replyTokenOrNull) return finishAndEstimate(replyTokenOrNull, userId);
    return finishAndEstimatePush(userId);
  }

  const current = PHOTO_STEPS[s.photoIndex];
  const prompt = `10/10 写真アップロード\n「${current.label}」を送ってください。`;
  const msg = {
    type: 'text',
    text: prompt,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'camera', label: 'カメラを起動' } },
        { type: 'action', action: { type: 'cameraRoll', label: 'アルバムから選択' } },
        { type: 'action', action: { type: 'message', label: 'スキップ', text: 'スキップ' } },
        { type: 'action', action: { type: 'message', label: '完了', text: '完了' } },
      ],
    },
  };

  if (replyTokenOrNull) return client.replyMessage(replyTokenOrNull, msg);
  return client.pushMessage(userId, msg);
}

// ============ 概算計算・完了 ============
function estimateCost(a) {
  const base = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装＋屋根塗装': 900000 };
  const floors = { '1階建て': 1.0, '2階建て': 1.2, '3階建て': 1.4 };
  const layout = { '1DK': 0.9,'1LDK':0.95,'2DK':1.0,'2LDK':1.05,'3DK':1.1,'3LDK':1.15,'4DK':1.2,'4LDK':1.25,'5DK':1.3,'5LDK':1.35 };
  const wall = { 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof = { '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak = { '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.1,'雨漏りはない':1.0 };
  const dist = { '30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.1,'70cm以上':1.0 };
  const years = { '1〜5年':0.95,'5〜10年':1.0,'10〜15年':1.05,'15〜20年':1.1,'20〜30年':1.15,'30〜40年':1.2,'40年以上':1.25,'0年（新築）':0.9 };

  const work = a.q3;
  let cost = base[work] ?? 600000;
  cost *= floors[a.q1] ?? 1.0;
  cost *= layout[a.q2] ?? 1.0;
  cost *= wall[a.q6] ?? 1.0;
  cost *= leak[a.q8] ?? 1.0;
  cost *= dist[a.q9] ?? 1.0;
  if (work === '屋根塗装' || work === '外壁塗装＋屋根塗装') cost *= roof[a.q7] ?? 1.0;
  if (a.q4 === 'ある') cost *= years[a.q5] ?? 1.0;

  return Math.round(cost / 1000) * 1000;
}
const yen = (n) => n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

function buildHandoffFlex() {
  return {
    type: 'flex',
    altText: '詳しい見積もりを依頼する',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: 'より詳しい見積もりをご希望の方へ', weight: 'bold', size: 'md' },
          { type: 'text', text: 'ボタンを押して、お名前とご住所をお知らせください。1営業日以内にご連絡します。', wrap: true, size: 'sm' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: { type: 'postback', label: '詳しい見積もりを依頼する', data: qs.stringify({ action: 'handoff' }), displayText: '詳しい見積もりを依頼する' }
          }
        ]
      }
    }
  };
}

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
    `・受領写真枚数: ${s.photosCount}枚`;

  const disclaimer = '※表示金額は概算の目安です。実際の建物形状・劣化状況・足場条件・使用塗料により変動します。';

  const msgs = [
    { type: 'text', text: summary },
    { type: 'text', text: `概算金額：${yen(estimate)}\n\n${disclaimer}` },
    buildHandoffFlex(),
  ];

  return client.replyMessage(replyToken, msgs);
}

// pushで完了（画像の次の案内から来たケース）
async function finishAndEstimatePush(userId) {
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
    `・受領写真枚数: ${s.photosCount}枚`;

  await pushText(userId, summary);
  await pushText(userId, `概算金額：${yen(estimate)}\n\n※表示金額は概算の目安です。実際の建物形状・劣化状況・足場条件・使用塗料により変動します。`);
  return client.pushMessage(userId, buildHandoffFlex());
}
