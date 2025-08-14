/**
 * server.js (2025-08-14 修正版)
 * ─────────────────────────────────────────────
 * 変更点サマリ：
 *  - replyOnce(): 1イベント1回返信＋pushフォールバック
 *  - 画像アップロードは即時ACK→後続push
 *  - エラーログ強化（LINEエラー本文出力）
 *  - トリガー「カンタン見積りを依頼」開始ロジックはそのまま
 *  - 既存の質問フローや Flex/ボタンは変更なし
 */

import 'dotenv/config';
import express from 'express';
import { middleware, Client } from '@line/bot-sdk';
import axios from 'axios';

// ─────────────────────────────────────────────
// ■ ENV 読み込み
// ─────────────────────────────────────────────
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const app = express();

// LINE SDK ミドルウェア
app.use(middleware(config));
app.use(express.json());

// 健康監視
app.get('/health', (_, res) => res.send('ok'));

// ─────────────────────────────────────────────
// ■ SECTION: セッション管理（ユーザーごとの進行状況）
//    - ここにユーザーの回答・現在の質問インデックスを保持
//    - 修正時は構造を壊さないこと
// ─────────────────────────────────────────────
const sessions = new Map();
/**
 * セッションの取得・作成
 */
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 0,
      answers: {},
      startedAt: Date.now(),
      mode: 'simple' // 将来拡張用
    });
  }
  return sessions.get(userId);
}
/**
 * セッションの初期化
 */
function resetSession(userId) {
  sessions.delete(userId);
}

// ─────────────────────────────────────────────
// ■ SECTION: 質問定義（選択肢 / 画像 / テキスト）
//    - これを変える時は「質問種別(type)」「id」「next」を壊さない
//    - 「ボタン画像」URLはダミー画像を使用（完成イメージ用）
// ─────────────────────────────────────────────
const IMG = {
  card: 'https://dummyimage.com/600x350/eeeeee/555&text=%E3%82%AB%E3%83%BC%E3%83%89',
};

const QUESTIONS = [
  // 01 工事物件の階数
  { id: 'floor', type: 'choice', text: '工事物件の階数は？', choices: ['1階建て', '2階建て', '3階建て'], next: 'layout' },
  // 02 間取り
  { id: 'layout', type: 'choice', text: '物件の間取りは？', choices: ['1K', '1DK', '1LDK', '2K', '2DK', '2LDK', '3K', '3DK', '4K', '4DK', '4LDK'], next: 'age' },
  // 03 築年数
  { id: 'age', type: 'choice', text: '物件の築年数は？', choices: ['新築', '〜10年', '〜20年', '〜30年', '〜40年', '〜50年', '51年以上'], next: 'history' },
  // 04 過去塗装有無
  { id: 'history', type: 'choice', text: '過去に塗装をした経歴は？', choices: ['ある', 'ない', 'わからない'], next: 'last_paint' },
  // 05 前回いつ
  { id: 'last_paint', type: 'choice', text: '前回の塗装はいつ頃？', choices: ['〜5年', '5〜10年', '10〜20年', '20〜30年', 'わからない'], next: 'work_type' },
  // 06 希望工事内容
  { id: 'work_type', type: 'choice', text: 'ご希望の工事内容は？', choices: ['外壁塗装', '屋根塗装', '外壁塗装+屋根塗装'], next: 'outer_wall' },
  // 07 外壁の種類（条件分岐）
  { id: 'outer_wall', type: 'choice', text: '外壁の種類は？', choices: ['モルタル', 'サイディング', 'タイル', 'ALC'], conditional: (ans) => ['外壁塗装', '外壁塗装+屋根塗装'].includes(ans.work_type), next: 'roof' },
  // 08 屋根の種類（条件分岐）
  { id: 'roof', type: 'choice', text: '屋根の種類は？', choices: ['瓦', 'スレート', 'ガルバリウム', 'トタン'], conditional: (ans) => ['屋根塗装', '外壁塗装+屋根塗装'].includes(ans.work_type), next: 'leak' },
  // 09 雨漏り
  { id: 'leak', type: 'choice', text: '雨漏りや漏水の症状はありますか？', choices: ['雨の日に水滴が落ちる', '天井にシミがある', 'ない'], next: 'distance' },
  // 10 距離
  { id: 'distance', type: 'choice', text: '隣や裏の家との距離は？（周囲で一番近い距離）', choices: ['30cm以下', '50cm以下', '70cm以下', '70cm以上'], next: 'plan_elevation' },
  // 11 立面図
  { id: 'plan_elevation', type: 'image', text: '立面図をアップロードしてください。', next: 'plan_floor' },
  // 12 平面図
  { id: 'plan_floor', type: 'image', text: '平面図をアップロードしてください。', next: 'plan_section' },
  // 13 断面図
  { id: 'plan_section', type: 'image', text: '断面図をアップロードしてください。', next: 'photo_front' },
  // 14 外観：正面
  { id: 'photo_front', type: 'image', text: '正面から撮影した物件の写真をアップロードしてください。\n※足場を設置する箇所を確認しますので、周囲の地面が見える写真でお願いします。', next: 'photo_right' },
  // 15 外観：右
  { id: 'photo_right', type: 'image', text: '右側から撮影した物件の写真をアップロードしてください。\n※足場を設置する箇所を確認しますので、周囲の地面が見える写真でお願いします。', next: 'photo_left' },
  // 16 外観：左
  { id: 'photo_left', type: 'image', text: '左側から撮影した物件の写真をアップロードしてください。\n※足場を設置する箇所を確認しますので、周囲の地面が見える写真でお願いします。', next: 'photo_back' },
  // 17 外観：裏
  { id: 'photo_back', type: 'image', text: '後ろ側から撮影した物件の写真をアップロードしてください。\n※足場を設置する箇所を確認しますので、周囲の地面が見える写真でお願いします。', next: 'photo_garage' },
  // 18 車庫
  { id: 'photo_garage', type: 'image', text: '車庫の位置が分かる写真をアップロードしてください。', next: 'photo_crack' },
  // 19 ヒビ・割れ（任意）
  { id: 'photo_crack', type: 'image-optional', text: '外壁や屋根にヒビ/割れがある場合は写真をアップしてください。（なければ「スキップ」）', next: 'finish' },
  // 20 完了
  { id: 'finish', type: 'finish' }
];

// ─────────────────────────────────────────────
// ■ SECTION: LINE クライアント & 共通送信（replyOnce）
//    - ここが今回の主修正点
//    - 返信は必ず1回だけ。失敗時は push にフォールバック
// ─────────────────────────────────────────────
const client = new Client(config);

/**
 * LINEに1度だけ返信し、400(Invalid reply token等)の場合は自動でpushに切り替える
 * @param {Object} event - webhook event
 * @param {Array|Object} messages - 返信メッセージ（配列推奨）
 */
async function replyOnce(event, messages) {
  const replyToken = event.replyToken;
  const toUserId = event.source?.userId;
  const payload = Array.isArray(messages) ? messages : [messages];

  try {
    await client.replyMessage(replyToken, payload);
  } catch (err) {
    const status = err?.status || err?.response?.status;
    const body = err?.response?.data || err?.originalError?.response?.data;
    console.error('replyMessage error:', status, JSON.stringify(body));

    // 失効/重複などの時はpushで代替
    if (toUserId) {
      try {
        await client.pushMessage(toUserId, payload);
      } catch (pErr) {
        console.error('pushMessage fallback error:', pErr?.response?.status, pErr?.response?.data || pErr);
      }
    }
  }
}

// ─────────────────────────────────────────────
// ■ SECTION: 質問カード生成
//    - 選択肢 → ボタン(テンプレ) / 画像質問 → テキスト
// ─────────────────────────────────────────────
function buildChoiceTemplate(text, choices) {
  return {
    type: 'template',
    altText: text,
    template: {
      type: 'carousel',
      columns: choices.map(label => ({
        thumbnailImageUrl: IMG.card,
        title: text.slice(0, 39),
        text: label,
        actions: [
          { type: 'postback', label: '選ぶ', data: `ans=${encodeURIComponent(label)}` }
        ]
      }))
    }
  };
}
function buildImageAsk(text) {
  return { type: 'text', text: `${text}\n（写真を送信してください）` };
}
function buildImageOptionalAsk(text) {
  return {
    type: 'template',
    altText: text,
    template: {
      type: 'buttons',
      title: '任意の写真',
      text,
      actions: [
        { type: 'message', label: 'スキップ', text: 'スキップ' }
      ]
    }
  };
}

// ─────────────────────────────────────────────
// ■ SECTION: 次の質問を決めて送る
// ─────────────────────────────────────────────
function findNextQuestion(session) {
  while (session.step < QUESTIONS.length) {
    const q = QUESTIONS[session.step];
    if (q.type === 'finish') return q;
    if (q.conditional && !q.conditional(session.answers)) {
      session.step++;
      continue;
    }
    return q;
  }
  return { id: 'finish', type: 'finish' };
}

async function sendNextQuestion(event, session) {
  const q = findNextQuestion(session);

  if (q.type === 'finish') {
    // 概算見積もりカードを返す（本文は固定）
    const estimate = 0; // 算出ロジックは別途（ここではフォーマットのみ）
    const flex = {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '詳しい見積もりをご希望の方へ', weight: 'bold', size: 'lg' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '見積り金額', weight: 'bold', margin: 'md' },
          { type: 'text', text: `¥ ${estimate.toLocaleString('ja-JP')}`, size: 'xxl', weight: 'bold', color: '#00AA00' },
          { type: 'text', text: '上記はご入力内容を元に算出した概算金額です。', wrap: true, size: 'sm', color: '#666666', margin: 'sm' },
          { type: 'text', text: '正式なお見積りが必要な方は続けてご入力をお願いします。', wrap: true, size: 'sm', margin: 'md' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: 'primary', color: '#1DB446', action: { type: 'uri', label: '現地調査なしで見積を依頼', uri: process.env.LIFF_URL || 'https://liff.line.me/' + process.env.LIFF_ID } }
        ]
      }
    };
    await replyOnce(event, { type: 'flex', altText: '見積もりのご案内', contents: flex });
    resetSession(event.source.userId);
    return;
  }

  // 質問の種類に応じて表示
  if (q.type === 'choice') {
    const msgs = [
      { type: 'text', text: q.text },
      buildChoiceTemplate(q.text, q.choices)
    ];
    await replyOnce(event, msgs);
  } else if (q.type === 'image') {
    await replyOnce(event, buildImageAsk(q.text));
  } else if (q.type === 'image-optional') {
    await replyOnce(event, buildImageOptionalAsk(q.text));
  } else {
    await replyOnce(event, { type: 'text', text: q.text });
  }
}

// ─────────────────────────────────────────────
// ■ SECTION: 回答の保存
// ─────────────────────────────────────────────
function saveAnswer(session, questionId, value) {
  session.answers[questionId] = value;
  session.step++;
}

// ─────────────────────────────────────────────
// ■ SECTION: Webhook エントリ
// ─────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.status(200).end(); // 先に返す（タイムアウト防止）

  const events = req.body.events || [];
  for (const event of events) {
    try {
      if (event.type === 'message') {
        if (event.message.type === 'text') {
          await onTextMessage(event);
        } else if (event.message.type === 'image') {
          await onImageMessage(event);
        }
      } else if (event.type === 'postback') {
        await onPostback(event);
      }
    } catch (err) {
      // 例外ログ
      console.error('handler error:', err?.response?.data || err);
    }
  }
});

// ─────────────────────────────────────────────
// ■ SECTION: テキストメッセージ
//    - トリガー「カンタン見積りを依頼」→ セッション開始
// ─────────────────────────────────────────────
async function onTextMessage(event) {
  const userId = event.source.userId;
  const text = (event.message.text || '').trim();

  // トリガー
  if (text === 'カンタン見積りを依頼') {
    resetSession(userId);
    const session = getSession(userId);
    await replyOnce(event, { type: 'text', text: '見積もりを開始します。以下の質問にお答えください。' });
    // すぐ次の質問を push で送る（replyを2回にしない）
    await client.pushMessage(userId, { type: 'text', text: '最初の質問をお送りします。' });
    await sendNextQuestion({ source: { userId } , replyToken: event.replyToken }, session); // 内部で push fallback するので安全
    return;
  }

  // 画像任意ステップでの「スキップ」
  const session = getSession(userId);
  const q = findNextQuestion(session);
  if (q?.id === 'photo_crack' && text === 'スキップ') {
    saveAnswer(session, q.id, 'skipped');
    await replyOnce(event, { type: 'text', text: 'スキップしました。' });
    await sendNextQuestion(event, session);
    return;
  }

  // それ以外は入力不要のため案内
  await replyOnce(event, { type: 'text', text: '選択肢のある質問はボタンからお答えください。' });
}

// ─────────────────────────────────────────────
// ■ SECTION: Postback（選択肢の回答）
//    - ここは1回だけreply。続きはsendNextQuestionでまとめて返す
// ─────────────────────────────────────────────
async function onPostback(event) {
  const userId = event.source.userId;
  const session = getSession(userId);

  const data = event.postback?.data || '';
  const m = data.match(/^ans=(.*)$/);
  if (!m) {
    await replyOnce(event, { type: 'text', text: '選択を受け付けられませんでした。もう一度お試しください。' });
    return;
  }
  const value = decodeURIComponent(m[1] || '');

  const q = findNextQuestion(session);
  if (!q || q.type !== 'choice') {
    await replyOnce(event, { type: 'text', text: '現在は選択肢の入力を受け付けていません。' });
    return;
  }

  saveAnswer(session, q.id, value);
  // 「回答受領」と「次の質問」を**1回の reply でまとめる**
  const next = findNextQuestion(session);
  const msgs = [{ type: 'text', text: `「${value}」を選択しました。` }];
  if (next.type === 'choice') {
    msgs.push({ type: 'text', text: next.text });
    msgs.push(buildChoiceTemplate(next.text, next.choices));
  } else if (next.type === 'image') {
    msgs.push(buildImageAsk(next.text));
  } else if (next.type === 'image-optional') {
    msgs.push(buildImageOptionalAsk(next.text));
  } else if (next.type === 'finish') {
    // finish は replyOnce 側でflexを返す（ここでは軽く案内）
    msgs.push({ type: 'text', text: '最後のご案内をお送りします。' });
  }
  await replyOnce(event, msgs);

  // finish の場合は最後のカードを push（reply二度打ちを避ける）
  if (next.type === 'finish') {
    await sendNextQuestion(event, session);
  }
}

// ─────────────────────────────────────────────
// ■ SECTION: 画像メッセージ
//    - 先にACKをreply（1回だけ）→ 後続の質問はpushで送る
// ─────────────────────────────────────────────
async function onImageMessage(event) {
  const userId = event.source.userId;
  const session = getSession(userId);
  const q = findNextQuestion(session);

  // 画像を求めていない場合
  if (!q || (q.type !== 'image' && q.type !== 'image-optional')) {
    await replyOnce(event, { type: 'text', text: '現在、画像の送付は不要です。' });
    return;
  }

  // まずACKだけreply（1回）
  await replyOnce(event, { type: 'text', text: '画像を受け取りました。処理中です…' });

  // 画像の保存/転送などがある場合はここで処理（省略）
  // const messageId = event.message.id; // 必要であれば contentAPI で取得

  // 回答記録
  saveAnswer(session, q.id, 'uploaded');

  // 次の質問はpushで送る（reply二重呼び出しを避ける）
  await sendNextQuestion({ source: { userId } }, session);
}

// ─────────────────────────────────────────────
// ■ SECTION: 既定ポートで起動
// ─────────────────────────────────────────────
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log('listening on', port);
});
