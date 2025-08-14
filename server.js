/**
 * 外壁塗装オンライン相談 – Botサーバ
 * 修正点：
 *  - すべての「次の質問」は reply ではなく push で送る（ACK は reply）。
 *  - 「距離」以降で止まる問題を解消（競合・トークン使い切り対策）。
 *  - 送信の再試行／詳細ログを追加。
 */

import 'dotenv/config';
import express from 'express';
import { Client, middleware as lineMiddleware } from '@line/bot-sdk';

// ====== [A] LINE SDK 設定 =====================================================
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
const client = new Client(config);

// ====== [B] アプリ基本設定 =====================================================
const app = express();
app.use(express.json());
app.use(lineMiddleware(config));

// Memory セッション（本番はRedis推奨）
const sessions = new Map(); // userId -> { stepIndex, answers:{} }

// ステップ定義（質問の順番）
const STEPS = [
  'FLOOR',              // 工事物件の階数
  'LAYOUT',             // 間取り
  'AGE',                // 築年数
  'PAINT_HISTORY',      // 過去に塗装
  'PAINT_HISTORY_AGE',  // 前回の塗装時期
  'WORK_KIND',          // A. 希望工事
  'WALL_TYPE',          // 外壁の種類（条件付き）
  'ROOF_TYPE',          // 屋根の種類（条件付き）
  'LEAK',               // 雨漏り
  'DISTANCE',           // 周囲距離（←ここで止まっていた）
  'BLUEPRINT_ELEV',     // 立面図
  'BLUEPRINT_PLAN',     // 平面図
  'BLUEPRINT_SEC',      // 断面図
  'PHOTO_FRONT',        // 正面
  'PHOTO_RIGHT',        // 右
  'PHOTO_LEFT',         // 左
  'PHOTO_BACK',         // 後ろ
  'PHOTO_GARAGE',       // 車庫
  'PHOTO_CRACK',        // ヒビ/割れ
  'SUMMARY'             // 概算提示 → LIFF誘導
];

// ====== [C] 質問文と選択肢 =====================================================

// 画像（ダミー）URL
const IMG = {
  pick: 'https://dummyimage.com/600x340/efefef/333&text=%E9%81%B8%E6%8A%9E',
};

// 各ステップのメッセージ生成
function buildQuestion(step, userAnswers) {
  switch (step) {
    case 'FLOOR':
      return quickPick('工事物件の階数は？', ['1階建て', '2階建て', '3階建て']);
    case 'LAYOUT':
      return quickPick('物件の間取りは？', ['1K','1DK','1LDK','2K','2DK','2LDK','3K','3DK','4K','4DK','4LDK']);
    case 'AGE':
      return quickPick('物件の築年数は？', ['新築','〜10年','〜20年','〜30年','〜40年','〜50年','51年以上']);
    case 'PAINT_HISTORY':
      return quickPick('過去に塗装をした経歴は？', ['ある','ない','わからない']);
    case 'PAINT_HISTORY_AGE':
      // 「ない」を選んでいればスキップ
      if (userAnswers.PAINT_HISTORY === 'ない') return null;
      return quickPick('前回の塗装はいつ頃？', ['〜5年','5〜10年','10〜20年','20〜30年','わからない']);
    case 'WORK_KIND':
      return quickPick('ご希望の工事内容は？', ['外壁塗装','屋根塗装','外壁塗装+屋根塗装']);
    case 'WALL_TYPE':
      if (!['外壁塗装','外壁塗装+屋根塗装'].includes(userAnswers.WORK_KIND)) return null;
      return quickPick('外壁の種類は？', ['モルタル','サイディング','タイル','ALC']);
    case 'ROOF_TYPE':
      if (!['屋根塗装','外壁塗装+屋根塗装'].includes(userAnswers.WORK_KIND)) return null;
      return quickPick('屋根の種類は？', ['瓦','スレート','ガルバリウム','トタン']);
    case 'LEAK':
      return quickPick('雨漏りや漏水の症状はありますか？', ['雨の日に水滴が落ちる','天井にシミがある','ない']);
    case 'DISTANCE':
      return quickPick('隣や裏の家との距離は？（周囲で一番近い距離）', ['30cm以下','50cm以下','70cm以下','70cm以上']);
    case 'BLUEPRINT_ELEV':
      return textForUpload('立面図をアップロードしてください。');
    case 'BLUEPRINT_PLAN':
      return textForUpload('平面図をアップロードしてください。');
    case 'BLUEPRINT_SEC':
      return textForUpload('断面図をアップロードしてください。');
    case 'PHOTO_FRONT':
      return textForUpload('正面から撮影した物件の写真をアップロードしてください。\n※足場を設置する箇所を確認しますので、周囲の地面が見える写真でお願いします。');
    case 'PHOTO_RIGHT':
      return textForUpload('右側から撮影した物件の写真をアップロードしてください。\n※周囲の地面が見える写真でお願いします。');
    case 'PHOTO_LEFT':
      return textForUpload('左側から撮影した物件の写真をアップロードしてください。');
    case 'PHOTO_BACK':
      return textForUpload('後ろ側から撮影した物件の写真をアップロードしてください。');
    case 'PHOTO_GARAGE':
      return textForUpload('車庫の位置がわかる写真をアップロードしてください。');
    case 'PHOTO_CRACK':
      return textForUpload('外壁や屋根にヒビ/割れがある場合は写真をアップしてください。（なければ「スキップ」）');
    case 'SUMMARY':
      return {
        type: 'flex',
        altText: '概算見積',
        contents: summaryBubble(userAnswers)
      };
    default:
      return { type: 'text', text: 'エラーが発生しました。' };
  }
}

// QuickPick（ボタン3～12個）
function quickPick(title, items) {
  const columns = items.map(label => ({
    thumbnailImageUrl: IMG.pick,
    imageBackgroundColor: '#f5f5f5',
    text: label,
    actions: [{ type: 'message', label: '選ぶ', text: label }]
  }));

  return {
    type: 'template',
    altText: title,
    template: {
      type: 'carousel',
      columns
    }
  };
}

function textForUpload(text) {
  return { type: 'text', text: `${text}\n（画像をそのまま送信してください）` };
}

function summaryBubble(ans) {
  const lines = [
    `階数：${ans.FLOOR ?? '-'}`,
    `間取り：${ans.LAYOUT ?? '-'}`,
    `築年数：${ans.AGE ?? '-'}`,
    `過去の塗装：${ans.PAINT_HISTORY ?? '-'}`,
    (ans.PAINT_HISTORY !== 'ない') ? `前回塗装：${ans.PAINT_HISTORY_AGE ?? '-'}` : null,
    `工事内容：${ans.WORK_KIND ?? '-'}`,
    (['外壁塗装','外壁塗装+屋根塗装'].includes(ans.WORK_KIND) ? `外壁：${ans.WALL_TYPE ?? '-'}` : null),
    (['屋根塗装','外壁塗装+屋根塗装'].includes(ans.WORK_KIND) ? `屋根：${ans.ROOF_TYPE ?? '-'}` : null),
    `最短距離：${ans.DISTANCE ?? '-'}`,
  ].filter(Boolean).join('\n');

  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'ありがとうございます。', weight: 'bold', size: 'md' },
        { type: 'text', text: '工事代金は', margin: 'md' },
        { type: 'text', text: '¥0,000,000', size: 'xxl', weight: 'bold', color: '#0E9E44' },
        { type: 'text', text: '※ご入力いただいた情報を元に計算した概算見積もりです。', wrap: true, margin: 'md', size: 'sm', color: '#555' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: lines, wrap: true, margin: 'md' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: '正確なお見積もりが必要な方はこちら', margin: 'md' },
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        style: 'primary',
        color: '#00C853',
        action: {
          type: 'uri',
          label: '現地調査なしでLINE見積もり',
          uri: `https://liff.line.me/${process.env.LIFF_ID}` // ここでLIFFへ
        }
      }]
    }
  };
}

// ====== [D] 送信ユーティリティ =================================================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function safeReply(replyToken, messages) {
  try {
    await client.replyMessage(replyToken, Array.isArray(messages) ? messages : [messages]);
  } catch (e) {
    console.error('[safeReply] error', e?.response?.data || e);
  }
}

async function safePush(to, messages, retry = 1) {
  try {
    await client.pushMessage(to, Array.isArray(messages) ? messages : [messages]);
  } catch (e) {
    console.error('[safePush] error', e?.response?.data || e);
    if (retry > 0) {
      await sleep(400);
      return safePush(to, messages, retry - 1);
    }
  }
}

// 次のステップへ（pushで送る）
async function askNext(userId) {
  const session = sessions.get(userId);
  if (!session) return;
  // 次に質問すべきステップを探索（スキップ条件を考慮）
  while (session.stepIndex < STEPS.length) {
    const step = STEPS[session.stepIndex];
    const msg = buildQuestion(step, session.answers);
    if (msg) {
      await sleep(250); // 競合回避
      await safePush(userId, msg);
      return;
    }
    session.stepIndex += 1; // スキップ
  }
}

// ====== [E] Webhook ハンドラ ===================================================
app.post('/webhook', async (req, res) => {
  const events = req.body.events;
  await Promise.all(events.map(handleEvent));
  res.status(200).end();
});

async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // セッション初期化
  if (!sessions.has(userId)) {
    sessions.set(userId, { stepIndex: -1, answers: {} });
  }
  const session = sessions.get(userId);

  // トリガー（リッチメニュー or テキスト）
  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();
    if (text === 'カンタン見積りを依頼') {
      // セッション再初期化
      session.stepIndex = 0;
      session.answers = {};
      await safeReply(event.replyToken, { type: 'text', text: '見積もりを開始します。以下の質問にお答えください。' });
      return askNext(userId);
    }

    // 通常回答
    const step = STEPS[session.stepIndex];
    if (!step) return;

    // アップロード系は画像でも受け付けるので、ここではテキスト回答系のみ格納
    if (['FLOOR','LAYOUT','AGE','PAINT_HISTORY','PAINT_HISTORY_AGE','WORK_KIND','WALL_TYPE','ROOF_TYPE','LEAK','DISTANCE']
      .includes(step)) {
      session.answers[step] = text;
      session.stepIndex += 1;
      // ACK は reply、次の質問は push
      await safeReply(event.replyToken, { type: 'text', text: '了解しました。' });
      return askNext(userId);
    }

    // 「スキップ」の取り扱い（ヒビ/割れ写真など）
    if (step === 'PHOTO_CRACK' && text === 'スキップ') {
      session.answers[step] = 'なし（スキップ）';
      session.stepIndex += 1;
      await safeReply(event.replyToken, { type: 'text', text: '了解しました。' });
      return askNext(userId);
    }
  }

  // 画像アップロード
  if (event.type === 'message' && event.message.type === 'image') {
    const step = STEPS[sessions.get(userId).stepIndex];
    const m = event.message;
    // 実装簡略化：画像IDだけ保存（実ファイルはLINE CDN）
    sessions.get(userId).answers[step] = `image:${m.id}`;
    sessions.get(userId).stepIndex += 1;
    await safeReply(event.replyToken, { type: 'text', text: '画像を受け取りました。' });
    return askNext(userId);
  }
}

// ====== [F] Healthチェック ======================================================
app.get('/health', (_, res) => res.status(200).send('ok'));

// ====== [G] 起動 ===============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
