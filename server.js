// ============================
// server.js  (完全版)
// ============================

import express from 'express';
import bodyParser from 'body-parser';
import * as line from '@line/bot-sdk';

// ====== 環境変数 ======
const {
  CHANNEL_SECRET = '',
  CHANNEL_ACCESS_TOKEN = '',
  PORT,
} = process.env;

if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
  console.error('[BOOT] ENV が不足しています。CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN を設定してください。');
  process.exit(1);
}

// ====== LINE SDK クライアント / ミドルウェア ======
const config = {
  channelSecret: CHANNEL_SECRET,
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
};
const client = new line.Client(config);

// ====== Express ======
const app = express();
app.use(bodyParser.json());

// Render のヘルスチェック用
app.get('/health', (_, res) => res.status(200).send('ok'));

// Webhook エンドポイント
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    if (!Array.isArray(events)) {
      console.error('[WEBHOOK] events が配列ではありません');
      return res.status(200).end();
    }
    await Promise.all(events.map(dispatchEvent));
    res.status(200).end();
  } catch (e) {
    console.error('[WEBHOOK] handler failed', e);
    res.status(200).end(); // LINE 側には 200 を返す
  }
});

// ====== セッション管理 ======
/** { userId: { step: number, answers: {}, flow: Step[] } } */
const S = new Map();

// ====== トリガー判定 ======
const TRIGGER = ['カンタン見積りを依頼', '見積もりスタート'];

function normalizeText(t = '') {
  try {
    return t
      .toString()
      .normalize('NFKC')
      .replace(/\u200B/g, '')        // ゼロ幅スペース
      .replace(/\s+/g, '')           // 空白・タブ・改行を全部除去
      .trim();
  } catch {
    return (t || '').trim();
  }
}

function isStartTrigger(text) {
  const n = normalizeText(text);
  return TRIGGER.some((key) => n.includes(normalizeText(key)));
}

// ====== 質問フロー（最低限・止まらない保証版） ======
/**
 * 各ステップ: type 'select' | 'text' | 'photo'
 *   - key: 保存先キー
 *   - question: 表示テキスト
 *   - options: [{label, value}]  (type='select' のみ)
 */
function newFlow() {
  return [
    {
      type: 'select',
      key: 'leak',
      question: '雨漏りや漏水の症状はありますか？',
      options: [
        { label: '雨の日に水滴が落ちる', value: 'leak_drop' },
        { label: '天井にシミがある', value: 'stain' },
        { label: 'ない', value: 'none' },
      ],
    },
    {
      type: 'select',
      key: 'distance',
      question: '隣や裏の家との距離は？（周囲で一番近い距離）',
      options: [
        { label: '30cm以下', value: 'lt30' },
        { label: '50cm以下', value: 'lt50' },
        { label: '70cm以下', value: 'lt70' },
        { label: '70cm以上', value: 'gte70' },
      ],
    },
    {
      type: 'select',
      key: 'work',
      question: 'ご希望の工事内容は？',
      options: [
        { label: '外壁塗装', value: 'wall' },
        { label: '屋根塗装', value: 'roof' },
        { label: '外壁塗装+屋根塗装', value: 'both' },
      ],
    },
  ];
}

// ====== ハンドラ分岐 ======
async function dispatchEvent(ev) {
  try {
    switch (ev.type) {
      case 'message':
        if (ev.message.type === 'text') return onText(ev);
        if (ev.message.type === 'image') return onImage(ev);
        // 画像以外はスルー
        return;
      case 'postback':
        return onPostback(ev);
      default:
        return;
    }
  } catch (e) {
    console.error('[dispatchEvent] failed', e);
  }
}

// ====== 安全返信ラッパ ======
async function safeReply(token, messages) {
  try {
    const arr = Array.isArray(messages) ? messages : [messages];
    const real = arr.filter(Boolean);
    if (!real.length) real.push({ type: 'text', text: '...' });
    await client.replyMessage(token, real);
  } catch (e) {
    console.error('[safeReply] reply error', e?.response?.data || e);
  }
}

// ====== メッセージ部品 ======
function textMsg(t) {
  return { type: 'text', text: t };
}

function flexOptionBubble(title, options) {
  // Flex: 見た目を壊さず 400 を出さない最小構成
  return {
    type: 'bubble',
    size: 'mega',
    hero: {
      type: 'image',
      url: 'https://placehold.co/600x300?text=Paint+Estimator', // ダミー画像
      size: 'full',
      aspectRatio: '20:10',
      aspectMode: 'cover',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: title, weight: 'bold', wrap: true, size: 'md' },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          spacing: 'sm',
          contents: options.map((o) => ({
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: { type: 'postback', label: o.label, data: `ans:${o.data}` },
          })),
        },
        { type: 'text', text: '選択肢をお選びください。', size: 'xs', color: '#888888', margin: 'md' },
      ],
    },
  };
}

// 次の質問を投げる
async function askNext(replyToken, userId) {
  const st = S.get(userId);
  if (!st) return;

  const step = st.step ?? 0;
  const flow = st.flow || [];
  const node = flow[step];

  if (!node) {
    // 完了
    await safeReply(replyToken, [
      textMsg('ご回答ありがとうございました。概算の算出を行います。'),
      textMsg('※実際の現地状況により変動する場合があります。'),
    ]);
    S.delete(userId);
    return;
  }

  if (node.type === 'select') {
    const opts = node.options.map((o) => ({ label: o.label, data: `${node.key}=${o.value}` }));
    const bubble = flexOptionBubble(node.question, opts);
    await safeReply(replyToken, [
      {
        type: 'flex',
        altText: node.question,
        contents: bubble,
      },
    ]);
    return;
  }

  // 今回は select のみを使用。拡張する場合はここに text/photo を実装
  await safeReply(replyToken, textMsg(node.question));
}

// ====== 各イベント処理 ======
async function onText(ev) {
  const userId = ev.source?.userId;
  const raw = ev.message?.text || '';
  const normalized = normalizeText(raw);

  // リセット
  if (normalized === normalizeText('リセット') || normalized === normalizeText('はじめからやり直す')) {
    S.delete(userId);
    await safeReply(ev.replyToken, textMsg('初期化しました。「カンタン見積りを依頼」で開始できます。'));
    return;
  }

  // ★ 発火判定（文字列のゆらぎを吸収した部分一致）
  if (isStartTrigger(raw)) {
    S.set(userId, { step: 0, answers: {}, flow: newFlow() });
    await safeReply(ev.replyToken, textMsg('見積もりを開始します。以下の質問にお答えください。'));
    await askNext(ev.replyToken, userId);
    return;
  }

  // セッション中ではない
  const st = S.get(userId);
  if (!st) {
    await safeReply(ev.replyToken, textMsg('「カンタン見積りを依頼」と送るか、リッチメニューから開始してください。'));
    return;
  }

  // セッション中のフリーテキスト（今回は使用しない）
  await safeReply(ev.replyToken, textMsg('選択肢のボタンをタップしてください。'));
}

async function onPostback(ev) {
  const userId = ev.source?.userId;
  const data = ev.postback?.data || '';

  // ★ リッチメニューの postback で開始
  if (data === 'action=start') {
    S.set(userId, { step: 0, answers: {}, flow: newFlow() });
    await safeReply(ev.replyToken, textMsg('見積もりを開始します。以下の質問にお答えください。'));
    await askNext(ev.replyToken, userId);
    return;
  }

  if (!data.startsWith('ans:')) return;

  const st = S.get(userId);
  if (!st) {
    await safeReply(ev.replyToken, textMsg('「カンタン見積りを依頼」で見積もりを開始してください。'));
    return;
  }

  // ans:key=value
  const payload = data.substring(4);
  const [k, v] = payload.split('=');

  if (k) st.answers[k] = v;
  st.step = (st.step ?? 0) + 1;

  // 軽い確認メッセージ（応答が無いと不安定になるケースへの対策）
  await safeReply(ev.replyToken, textMsg('了解しました。続いて質問です。'));
  await askNext(ev.replyToken, userId);
}

async function onImage(ev) {
  // 今回の最小版では画像は受付けず案内のみ（必要ならここで getMessageContent → 保存）
  await safeReply(ev.replyToken, textMsg('画像は現在のフローでは不要です。選択肢のボタンから回答を進めてください。'));
}

// ====== 起動 ======
const listenPort = Number(PORT) || 10000;
app.listen(listenPort, () => {
  console.log(`listening on ${listenPort}`);
});
