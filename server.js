/*******************************************************
 * 外壁塗装オンライン相談 / サーバー起動用 完全版
 * - Render のヘルスチェック /health
 * - LIFF 静的配信 /liff/*
 * - LIFF 用 env.js を /liff/env.js で出力
 * - LINE Webhook /webhook
 * - 起動失敗の原因だった 'cors' を依存に追加し、ここで use 済み
 * 
 * 【構成メモ】
 *   A. import & 初期化
 *   B. Express / Middleware
 *   C. 静的配信とヘルスチェック
 *   D. LINE クライアント / 受信イベント窓口
 *   E. かんたん見積りミニフロー（最低限動く形）
 *   F. エラーハンドラ
 *******************************************************/

/////////////////////////////
// A. import & 初期化
/////////////////////////////
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import * as line from '@line/bot-sdk';

// Render 環境ではプロジェクトルートからの相対を解決するために __dirname を生成
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env / Render Environment から値を取得
const {
  CHANNEL_SECRET,
  CHANNEL_ACCESS_TOKEN,
  LIFF_ID
} = process.env;

// 必須変数チェック（起動時に分かるように）
if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
  console.error('ERROR: CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です。');
}

const PORT = process.env.PORT || 10000; // Render の Health check が参照するポート

/////////////////////////////
// B. Express / Middleware
/////////////////////////////
const app = express();

// ← 依存不足が原因だった 'cors' を正しく読み込み＆use
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' })); // 画像を扱う場合は少し大きめ

// LINE ミドルウェア（署名検証）
const lineConfig = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET
};
const lineMiddleware = line.middleware(lineConfig);
const lineClient = new line.Client(lineConfig);

/////////////////////////////
// C. 静的配信とヘルスチェック
/////////////////////////////

// LIFF ページ配信（/liff 以下に index.html / app.js / style.css などを置く）
app.use('/liff', express.static(path.join(__dirname, 'liff')));

// LIFF 用の env.js を配信（ブラウザ側で LIFF_ID を参照する用途）
app.get('/liff/env.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  const id = LIFF_ID ? `'${LIFF_ID}'` : 'null';
  res.send(`window.__LIFF_ID__ = ${id};`);
});

// Render のヘルスチェック
app.get('/health', (_req, res) => res.status(200).send('ok'));

/////////////////////////////
// D. LINE Webhook エンドポイント
/////////////////////////////
// すべての LINE イベントはここに飛んでくる
app.post('/webhook', lineMiddleware, async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).end();
  }
});

/////////////////////////////
// E. かんたん見積りミニフロー
//   - まずは確実に質問が開始する/進むことを担保
//   - 既存の詳細ロジックはこのセクションを置き換えてください
/////////////////////////////

// セッションは簡易にメモリ保持（本番はストア等に載せ替え可）
const session = new Map(); // userId -> { step: number, answers: {} }

const TRIGGER_WORDS = ['カンタン見積りを依頼'];

// フロー定義を最小限で（必ず動くことを優先）
const FLOW = [
  {
    key: 'floor',
    question: '工事物件の階数は？',
    choices: ['1階建て', '2階建て', '3階建て']
  },
  {
    key: 'leak',
    question: '雨漏りや漏水の症状はありますか？',
    choices: ['雨の日に水滴が落ちる', '天井にシミがある', 'ない']
  },
  {
    key: 'distance',
    question: '隣や裏の家との距離は？（周囲で一番近い距離）',
    choices: ['30cm以下', '50cm以下', '70cm以下', '70cm以上']
  }
];

// イベント分岐
async function handleEvent(event) {
  if (event.type === 'message' && event.message.type === 'text') {
    return onText(event);
  }
  if (event.type === 'postback') {
    return onPostback(event);
  }
  // 画像など来た場合はスキップ
  return Promise.resolve();
}

// テキストメッセージ
async function onText(event) {
  const userId = event.source?.userId;
  const text = (event.message?.text || '').trim();

  // トリガー判定（完全一致 + trim）
  if (TRIGGER_WORDS.includes(text)) {
    startFlow(userId);
    await replyQuestion(event.replyToken, userId, '見積もりを開始します。以下の質問にお答えください。');
    return;
  }

  // セッション中なら手動入力として受理（choices にない文字でも次へ）
  const s = session.get(userId);
  if (s && s.step < FLOW.length) {
    const step = FLOW[s.step];
    s.answers[step.key] = text;
    s.step++;
    await nextOrFinish(event.replyToken, userId);
    return;
  }

  // それ以外は無視して 200
  return;
}

// Postback（カルーセル/ボタンの選択）
async function onPostback(event) {
  const userId = event.source?.userId;
  const data = event.postback?.data || '';

  // data=flow:key=value 形式を採用
  // 例: flow:floor=2階建て
  if (data.startsWith('flow:')) {
    const payload = data.substring(5); // floor=2階建て
    const [key, value] = payload.split('=');
    const s = session.get(userId);
    if (!s) {
      // セッションがない（タイムアウト等）場合は起動し直す
      startFlow(userId);
      await replyText(event.replyToken, 'セッションが切れたため、見積もりを再開します。');
      await nextOrFinish(event.replyToken, userId);
      return;
    }
    s.answers[key] = value;
    s.step++;
    await nextOrFinish(event.replyToken, userId);
    return;
  }
}

// セッション開始
function startFlow(userId) {
  session.set(userId, { step: 0, answers: {} });
}

// 次の質問 or 完了
async function nextOrFinish(replyToken, userId) {
  const s = session.get(userId);
  if (!s) return;

  if (s.step >= FLOW.length) {
    // 完了：ここで LIFF カードを出す（仮）
    const summary = Object.entries(s.answers)
      .map(([k, v]) => `・${k}: ${v}`)
      .join('\n');
    await replyText(replyToken, `ありがとうございます。概算の入力が完了しました。\n${summary}\n\n詳細見積もりはLIFFからご依頼ください。`);
    // 完了後はセッションを消す
    session.delete(userId);
    return;
  }
  // 次の設問
  await replyQuestion(replyToken, userId);
}

// 設問送信（ボタンテンプレート）
async function replyQuestion(replyToken, userId, headMsg) {
  const s = session.get(userId);
  const step = FLOW[s.step];

  const alt = `${headMsg ? `${headMsg}\n` : ''}${step.question}`;
  const actions = (step.choices || []).map(c => ({
    type: 'postback',
    label: c,
    data: `flow:${step.key}=${c}`,
    displayText: c
  }));

  const message = {
    type: 'template',
    altText: alt,
    template: {
      type: 'buttons',
      title: '質問',
      text: step.question,
      actions
    }
  };

  await lineClient.replyMessage(replyToken, message);
}

// 返信（テキスト）
async function replyText(replyToken, text) {
  await lineClient.replyMessage(replyToken, { type: 'text', text });
}

/////////////////////////////
// F. エラーハンドラ
/////////////////////////////
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('internal error');
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
