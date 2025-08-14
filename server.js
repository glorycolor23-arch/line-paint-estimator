/******************************************************
 * 外壁塗装オンライン見積もり — LINE Bot サーバ
 * 目的:
 *  - 「カンタン見積りを依頼」で確実に会話を開始
 *  - 各ステップは "1イベント=1回のreply" を厳守
 *  - 画像アップロードでも止まらずに次へ進む
 *  - 将来の部分差し替えが容易なよう、見出しコメントを整備
 *
 * 必要な環境変数:
 *  - CHANNEL_SECRET
 *  - CHANNEL_ACCESS_TOKEN
 *  - LIFF_ID (例: 2007914959-XXXXXXX)
 *  - (任意) BASE_URL … /health の確認などでログに出す用
 *
 * 依存:
 *  - @line/bot-sdk
 *  - express
 *  - (任意) axios  … 今後の拡張用。使っていなければ削除可
 ******************************************************/

import 'dotenv/config';
import express from 'express';
import { Client, middleware as lineMiddleware } from '@line/bot-sdk';
import axios from 'axios'; // 使っていなければ package.json と共に削除可
import path from 'path';
import { fileURLToPath } from 'url';

/* =========================
 * 0) 定数・初期化
 * ========================= */

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

if (!config.channelAccessToken || !config.channelSecret) {
  console.error('ENV missing: CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET');
  process.exit(1);
}

const LIFF_ID = process.env.LIFF_ID || '';
const LIFF_URL = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : '';

const app = express();
app.use(express.json());

const client = new Client(config);

// __dirname 互換
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
 * 1) 返信/プッシュ ユーティリティ
 *    ---- このセクションを差し替え/追記することで
 *         返信ポリシーの変更やログの粒度調整が可能
 * ========================= */

/** 1イベント=1回だけ replyMessage を呼ぶ */
async function replyOnce(client, event, messages) {
  const arr = Array.isArray(messages) ? messages : [messages];
  return client.replyMessage(event.replyToken, arr);
}

/** push: replyToken 非依存でいつでも送信できる */
async function pushToUser(client, userId, messages) {
  const arr = Array.isArray(messages) ? messages : [messages];
  return client.pushMessage(userId, arr);
}

/** 返信時のエラー詳細を必ずログに出す */
async function safeReplyOnce(client, event, messages) {
  try {
    await replyOnce(client, event, messages);
  } catch (err) {
    const res = err.originalError?.response || err.response;
    console.error('reply error', res?.status, JSON.stringify(res?.data));
    throw err;
  }
}

/* =========================
 * 2) 簡易ステート（メモリ）
 *    ---- Render 無料プランはプロセス再起動で飛びます。
 *         永続化したい場合は Redis / Supabase 等に差し替え。
 *         差し替え箇所はこのセクション一式です。
 * ========================= */

const sessions = new Map(); // userId -> { step, answers: {} }

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { step: 'idle', answers: {} });
  }
  return sessions.get(userId);
}

function resetSession(userId) {
  sessions.set(userId, { step: 'idle', answers: {} });
}

function setStep(userId, step) {
  const s = getSession(userId);
  s.step = step;
}

function saveAnswer(userId, key, value) {
  const s = getSession(userId);
  s.answers[key] = value;
}

/* =========================
 * 3) UIビルダー（Flex）
 *    ---- ボタン/画像/カード等の見た目を集中管理。
 *         画像はダミーURLを使用（商用フリーのプレースホルダ）。
 *         差し替えたい場合は本セクションのみ修正。
 * ========================= */

const PLACEHOLDER = {
  hero:
    'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1280&q=80&auto=format&fit=crop',
  photo:
    'https://images.unsplash.com/photo-1501183638710-841dd1904471?w=1280&q=80&auto=format&fit=crop',
};

function buildOptionFlex(title, options) {
  // options: string[] … 押すと同じ文言を message 送信するボタン
  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: PLACEHOLDER.hero,
        size: 'full',
        aspectRatio: '16:9',
        aspectMode: 'cover',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: title,
            weight: 'bold',
            size: 'lg',
            wrap: true,
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: options.map((o) => ({
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: {
                type: 'message',
                label: o,
                text: o,
              },
            })),
          },
        ],
      },
    },
  };
}

function buildInfoCard(title, lines = []) {
  // テキストのみの確認カード
  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true },
          ...lines.map((t) => ({ type: 'text', text: t, wrap: true })),
        ],
      },
    },
  };
}

function buildEstimateCard(amountYen) {
  // 見積り結果 → LIFF 起動ボタン
  const amountText = `¥ ${Number(amountYen).toLocaleString('ja-JP')}`;
  return {
    type: 'flex',
    altText: '詳しい見積もりをご希望の方へ',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: '詳しい見積もりをご希望の方へ',
            weight: 'bold',
            size: 'xl',
            wrap: true,
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#F5F5F5',
            cornerRadius: 'md',
            paddingAll: '12px',
            contents: [
              { type: 'text', text: '見積り金額', size: 'sm', color: '#666666' },
              {
                type: 'text',
                text: amountText,
                weight: 'bold',
                size: 'xl',
              },
              {
                type: 'text',
                text: '上記はご入力内容を元に算出した概算金額です。',
                size: 'sm',
                color: '#666666',
                wrap: true,
                margin: 'sm',
              },
            ],
          },
          {
            type: 'text',
            text: '正式なお見積りが必要な方は続けてご入力をお願いします。',
            wrap: true,
          },
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '現地調査なしで見積を依頼',
              uri: LIFF_URL || 'https://liff.line.me',
            },
          },
        ],
      },
    },
  };
}

/* =========================
 * 4) 質問フロー定義
 *    ---- ここに並ぶ順番で進みます。
 *         条件分岐（外壁/屋根）は handleAnswer 側でスキップ制御。
 *         質問を差し替える場合は本セクションを変更。
 * ========================= */

const QUESTIONS = [
  {
    key: 'floorCount',
    type: 'option',
    title: '工事物件の階数は？',
    options: ['1階建て', '2階建て', '3階建て'],
  },
  {
    key: 'layout',
    type: 'option',
    title: '物件の間取りは？',
    options: ['1K', '1DK', '1LDK', '2K', '2DK', '2LDK', '3K', '3DK', '4K', '4DK', '4LDK'],
  },
  {
    key: 'age',
    type: 'option',
    title: '物件の築年数は？',
    options: ['新築', '〜10年', '〜20年', '〜30年', '〜40年', '〜50年', '51年以上'],
  },
  {
    key: 'history',
    type: 'option',
    title: '過去に塗装をした経歴は？',
    options: ['ある', 'ない', 'わからない'],
  },
  {
    key: 'lastPaint',
    type: 'option',
    title: '前回の塗装はいつ頃？',
    options: ['〜5年', '5〜10年', '10〜20年', '20〜30年', 'わからない'],
  },
  {
    key: 'scope',
    type: 'option',
    title: 'ご希望の工事内容は？',
    options: ['外壁塗装', '屋根塗装', '外壁塗装+屋根塗装'],
  },
  // 条件: scope に外壁が含まれる場合のみ
  {
    key: 'wallType',
    type: 'option',
    conditional: (answers) => /外壁/.test(answers.scope || ''),
    title: '外壁の種類は？',
    options: ['モルタル', 'サイディング', 'タイル', 'ALC'],
  },
  // 条件: scope に屋根が含まれる場合のみ
  {
    key: 'roofType',
    type: 'option',
    conditional: (answers) => /屋根/.test(answers.scope || ''),
    title: '屋根の種類は？',
    options: ['瓦', 'スレート', 'ガルバリウム', 'トタン'],
  },
  {
    key: 'leak',
    type: 'option',
    title: '雨漏りや漏水の症状はありますか？',
    options: ['雨の日に水滴が落ちる', '天井にシミがある', 'ない'],
  },
  {
    key: 'distance',
    type: 'option',
    title: '隣や裏の家との距離は？（周囲で一番近い距離）',
    options: ['30cm以下', '50cm以下', '70cm以下', '70cm以上'],
  },

  // 図面・写真 (image or skip)
  { key: 'elevation', type: 'image', title: '立面図をアップロードしてください。' },
  { key: 'plan', type: 'image', title: '平面図をアップロードしてください。' },
  { key: 'section', type: 'image', title: '断面図をアップロードしてください。' },
  { key: 'photoFront', type: 'image', title: '正面から撮影した物件の写真をアップロードしてください。周囲の地面が見えるようにお願いします。' },
  { key: 'photoRight', type: 'image', title: '右側から撮影した物件の写真をアップロードしてください。周囲の地面が見えるようにお願いします。' },
  { key: 'photoLeft', type: 'image', title: '左側から撮影した物件の写真をアップロードしてください。周囲の地面が見えるようにお願いします。' },
  { key: 'photoBack', type: 'image', title: '後ろ側から撮影した物件の写真をアップロードしてください。周囲の地面が見えるようにお願いします。' },
  { key: 'garage', type: 'image', title: '車庫の位置がわかる写真をアップロードしてください。' },
  {
    key: 'crack',
    type: 'image',
    title: '外壁や屋根にヒビ/割れがある場合は写真をアップしてください。（なければ「スキップ」）',
  },
];

/* =========================
 * 5) 質問送信ヘルパ
 *    ---- 次の質問を送る唯一の関数
 *         replyToken は1回だけ使用
 * ========================= */

function buildQuestionMessage(q) {
  if (q.type === 'option') {
    return buildOptionFlex(q.title, q.options);
  }
  if (q.type === 'image') {
    return buildInfoCard(q.title, [
      '写真をこのトークに直接送ってください。',
      '送らない場合は「スキップ」と入力してください。',
    ]);
  }
  return { type: 'text', text: q.title };
}

function nextVisibleIndex(answers, startIdx) {
  // 条件がある質問はスキップ
  for (let i = startIdx; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    if (typeof q.conditional === 'function') {
      if (q.conditional(answers)) return i;
      continue;
    }
    return i;
  }
  return -1;
}

async function sendNextQuestion(event, userId, sayPrefix) {
  const session = getSession(userId);
  const { step, answers } = session;

  const currentIdx = QUESTIONS.findIndex((q) => q.key === step);
  const nextIdx = nextVisibleIndex(answers, currentIdx < 0 ? 0 : currentIdx + 1);

  if (nextIdx === -1) {
    // 全質問完了 → 概算カードを提示
    const estimate = calcRoughEstimate(answers);
    const card = buildEstimateCard(estimate);
    await safeReplyOnce(client, event, [
      { type: 'text', text: sayPrefix || 'ご回答ありがとうございました。' },
      card,
    ]);
    setStep(userId, 'done');
    return;
  }

  const q = QUESTIONS[nextIdx];
  setStep(userId, q.key);

  const msg = buildQuestionMessage(q);
  const prefix = sayPrefix ? [{ type: 'text', text: sayPrefix }] : [];
  await safeReplyOnce(client, event, [...prefix, msg]);
}

/* =========================
 * 6) 概算金額の計算（ダミー）
 *    ---- ここを置き換えれば概算ロジックのみ差し替え可。
 * ========================= */

function calcRoughEstimate(answers) {
  // 非常に単純な仮ロジック（ダミー）
  let base = 500000; // 基本 50 万
  if (/2階/.test(answers.floorCount || '')) base += 150000;
  if (/3階/.test(answers.floorCount || '')) base += 300000;
  if (/外壁塗装\+屋根塗装/.test(answers.scope || '')) base += 300000;
  else if (/外壁塗装/.test(answers.scope || '')) base += 150000;
  else if (/屋根塗装/.test(answers.scope || '')) base += 120000;

  if (/30cm以下/.test(answers.distance || '')) base += 100000; // 足場難
  if (/ヒビ|割れ/.test(answers.crackNote || '')) base += 80000;

  return base;
}

/* =========================
 * 7) 受信イベント処理
 *    ---- ここがメインの制御。
 *         ・トリガー語の検出
 *         ・各ステップの回答処理
 *         ・画像受信/スキップ
 * ========================= */

async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  const session = getSession(userId);
  const step = session.step;

  // テキストメッセージ
  if (event.type === 'message' && event.message?.type === 'text') {
    const text = (event.message.text || '').trim();

    // ---- トリガー（完全一致）------------------------
    if (text === 'カンタン見積りを依頼') {
      resetSession(userId);
      // 最初の質問を 1 回の reply で送る
      await sendNextQuestion(event, userId, '見積もりを開始します。以下の質問にお答えください。');
      return;
    }

    // ---- リセット（任意）---------------------------
    if (text === 'リセット') {
      resetSession(userId);
      await safeReplyOnce(client, event, { type: 'text', text: '状態をリセットしました。もう一度「カンタン見積りを依頼」と送ってください。' });
      return;
    }

    // ---- ステップ処理: option / image(skip) --------
    if (step && step !== 'idle' && step !== 'done') {
      const q = QUESTIONS.find((qq) => qq.key === step);
      if (!q) {
        // 状態不整合時は再スタートを促す
        resetSession(userId);
        await safeReplyOnce(client, event, { type: 'text', text: '状態がリセットされました。もう一度「カンタン見積りを依頼」と送ってください。' });
        return;
      }

      if (q.type === 'option') {
        // 任意のテキストで回答採用（ボタンを押しても同じ文言が届く）
        saveAnswer(userId, q.key, text);
        await sendNextQuestion(event, userId, `「${text}」で承りました。`);
        return;
      }

      if (q.type === 'image') {
        // スキップ
        if (/^スキップ$/i.test(text)) {
          saveAnswer(userId, q.key, '(skip)');
          await sendNextQuestion(event, userId, 'スキップしました。');
          return;
        }
        // 画像以外のテキストが来た時
        await safeReplyOnce(client, event, {
          type: 'text',
          text: '写真をこのトークに送信してください。送らない場合は「スキップ」と入力してください。',
        });
        return;
      }
    }

    // （どの条件にも当たらなければ無視）
    return;
  }

  // 画像メッセージ
  if (event.type === 'message' && event.message?.type === 'image') {
    if (step && step !== 'idle' && step !== 'done') {
      const q = QUESTIONS.find((qq) => qq.key === step);
      if (q?.type === 'image') {
        // 本来はここで messageId から画像を取得しクラウド保存しURL化する
        // ここでは messageId を保存しておくダミー
        saveAnswer(userId, q.key, `image:${event.message.id}`);

        await sendNextQuestion(event, userId, '写真を受け取りました。ありがとうございます。');
        return;
      }
    }
    // 画像が不要なステップで届いた場合は丁寧に無視
    await safeReplyOnce(client, event, {
      type: 'text',
      text: '現在は写真のステップではありません。続きの質問にご回答ください。',
    });
    return;
  }

  // その他イベントは適宜無視
  return;
}

/* =========================
 * 8) ルーティング
 * ========================= */

app.get('/health', (_req, res) => res.type('text').send('ok'));

// LIFF ファイル群（/liff/*）を配信（リポジトリ直下の /liff フォルダ）
app.use('/liff', express.static(path.join(__dirname, 'liff'), { extensions: ['html'] }));

// webhook
app.post('/webhook', lineMiddleware(config), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (e) {
    console.error('webhook error', e);
    res.status(500).end();
  }
});

/* =========================
 * 9) サーバ起動
 * ========================= */

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
  console.log('BASE_URL:', process.env.BASE_URL || '(not set)');
  console.log('LIFF_URL :', LIFF_URL || '(not set)');
});

/* =========================
 * 10) 以降の差し替えガイド
 *  - 「質問文や選択肢を変えたい」→ セクション4(質問フロー定義)
 *  - 「見た目(Flex)を変えたい」→ セクション3(UIビルダー)
 *  - 「概算計算式を変えたい」  → セクション6(概算金額の計算)
 *  - 「保存先を永続化したい」  → セクション2(簡易ステート)を実装差し替え
 *  - 「返信ポリシー/ログ強化」 → セクション1(返信/プッシュ)
 * ========================= */
