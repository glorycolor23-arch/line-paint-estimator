/**
 * ============================================================
 *  server.js  (Render / LINE Messaging API / LIFF 連携)
 * ------------------------------------------------------------
 *  目的：
 *    - Render のヘルスチェックを最優先で 200 を返す
 *    - LINE 署名検証は /webhook のみに限定
 *    - 「カンタン見積りを依頼」で会話が必ず開始
 *    - Flex メッセージ（画像カード風）で選択肢を提示
 *    - すべての質問が完了したら概算結果＋LIFF へ誘導
 *
 *  注意：
 *    - .env（Render の Environment）に以下が必要
 *        CHANNEL_ACCESS_TOKEN, CHANNEL_SECRET
 *        LIFF_ID（例: 2007914959-XXXXXXX）
 *        FRIEND_ADD_URL（任意：友だち追加リンク）
 *    - /liff ディレクトリを静的配信します
 *
 *  変更箇所の目印：
 *    // ===== [A] 質問定義 =====      … 質問内容・順序の編集
 *    // ===== [B] Flex生成関数 =====  … 見た目の調整（画像/文言）
 *    // ===== [C] 返信テンプレ =====  … 定型の返信テキスト
 *    // ===== [D] 状態管理ヘルパ ===== … セッション状態処理
 *    // ===== [E] イベント処理 =====   … トリガー/メッセージ/ポストバック
 * ============================================================
 */

import express from 'express';
import line from '@line/bot-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------- Health Check（最上部で 200 を返す） --------------------
app.get('/health', (_req, res) => res.status(200).send('ok'));
// -----------------------------------------------------------------------------

// JSON ボディ
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// LIFF 静的配信
app.use('/liff', express.static('liff'));

// ----------------------------- LINE Bot 設定 -------------------------------
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new line.Client(config);
// --------------------------------------------------------------------------

// ===== [A] 質問定義（編集可） ===============================================
// ここを書き換えるだけで順序と内容を差し替えられます。
// options: [{label: ボタンに出す文字列, value: 保存される値}]
const QUESTIONS = [
  {
    id: 'kaisuu',
    title: '工事物件の階数は？',
    options: [
      { label: '1階建て', value: '1階建て' },
      { label: '2階建て', value: '2階建て' },
      { label: '3階建て', value: '3階建て' }
    ]
  },
  {
    id: '間取り',
    title: '物件の間取りは？',
    options: [
      { label: '1K', value: '1K' }, { label: '1DK', value: '1DK' }, { label: '1LDK', value: '1LDK' },
      { label: '2K', value: '2K' }, { label: '2DK', value: '2DK' }, { label: '2LDK', value: '2LDK' },
      { label: '3K', value: '3K' }, { label: '3DK', value: '3DK' }, { label: '3LDK', value: '3LDK' },
      { label: '4K', value: '4K' }, { label: '4DK', value: '4DK' }, { label: '4LDK', value: '4LDK' }
    ]
  },
  {
    id: '築年数',
    title: '物件の築年数は？',
    options: [
      { label: '新築', value: '新築' },
      { label: '〜10年', value: '〜10年' },
      { label: '〜20年', value: '〜20年' },
      { label: '〜30年', value: '〜30年' },
      { label: '〜40年', value: '〜40年' },
      { label: '〜50年', value: '〜50年' },
      { label: '51年以上', value: '51年以上' }
    ]
  },
  {
    id: '塗装歴',
    title: '過去に塗装をした経歴は？',
    options: [
      { label: 'ある', value: 'ある' },
      { label: 'ない', value: 'ない' },
      { label: 'わからない', value: 'わからない' }
    ]
  },
  {
    id: '前回塗装',
    title: '前回の塗装はいつ頃？',
    options: [
      { label: '〜5年', value: '〜5年' },
      { label: '5〜10年', value: '5〜10年' },
      { label: '10〜20年', value: '10〜20年' },
      { label: '20〜30年', value: '20〜30年' },
      { label: 'わからない', value: 'わからない' }
    ]
  },
  {
    id: '工事内容',
    title: 'ご希望の工事内容は？',
    options: [
      { label: '外壁塗装', value: '外壁塗装' },
      { label: '屋根塗装', value: '屋根塗装' },
      { label: '外壁塗装+屋根塗装', value: '外壁塗装+屋根塗装' }
    ]
  },
  {
    id: '外壁種類',
    title: '外壁の種類は？（外壁塗装を選択時のみ）',
    depends: { key: '工事内容', values: ['外壁塗装', '外壁塗装+屋根塗装'] },
    options: [
      { label: 'モルタル', value: 'モルタル' },
      { label: 'サイディング', value: 'サイディング' },
      { label: 'タイル', value: 'タイル' },
      { label: 'ALC', value: 'ALC' }
    ]
  },
  {
    id: '屋根種類',
    title: '屋根の種類は？（屋根塗装を選択時のみ）',
    depends: { key: '工事内容', values: ['屋根塗装', '外壁塗装+屋根塗装'] },
    options: [
      { label: '瓦', value: '瓦' },
      { label: 'スレート', value: 'スレート' },
      { label: 'ガルバリウム', value: 'ガルバリウム' },
      { label: 'トタン', value: 'トタン' }
    ]
  },
  {
    id: '雨漏り',
    title: '雨漏りや漏水の症状はありますか？',
    options: [
      { label: '雨の日に水滴が落ちる', value: '雨の日に水滴が落ちる' },
      { label: '天井にシミがある', value: '天井にシミがある' },
      { label: 'ない', value: 'ない' }
    ]
  },
  {
    id: '距離',
    title: '隣や裏の家との距離は？（周囲で一番近い距離）',
    options: [
      { label: '30cm以下', value: '30cm以下' },
      { label: '50cm以下', value: '50cm以下' },
      { label: '70cm以下', value: '70cm以下' },
      { label: '70cm以上', value: '70cm以上' }
    ]
  }
];
// ========================================================================

// ===== [B] Flex 生成（編集可） =============================================
// 画像はダミー（placehold.jp）を使用
const DUMMY_IMAGE = 'https://placehold.jp/600x300.png';

function buildOptionBubble(title, optLabel, dataPayload) {
  return {
    type: 'bubble',
    hero: {
      type: 'image',
      url: DUMMY_IMAGE,
      size: 'full',
      aspectRatio: '20:10',
      aspectMode: 'cover'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: optLabel, weight: 'bold', size: 'lg', wrap: true }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#1DB446',
          action: {
            type: 'postback',
            label: '選ぶ',
            data: JSON.stringify(dataPayload)
          }
        }
      ],
      flex: 0
    }
  };
}

function buildQuestionFlex(question, index) {
  const bubbles = question.options.slice(0, 10).map(opt => {
    const payload = { type: 'answer', qIndex: index, key: question.id, value: opt.value };
    return buildOptionBubble(question.title, opt.label, payload);
  });

  return {
    type: 'flex',
    altText: question.title,
    contents: { type: 'carousel', contents: bubbles }
  };
}
// ========================================================================

// ===== [C] 返信テンプレート ================================================
function replyText(token, text) {
  return client.replyMessage(token, { type: 'text', text });
}

function pushText(to, text) {
  return client.pushMessage(to, { type: 'text', text });
}

function replyFlex(token, flex) {
  return client.replyMessage(token, flex);
}
// ========================================================================

// ===== [D] 状態管理ヘルパ ==================================================
const sessions = new Map(); // userId -> { step, answers }

function startSession(userId) {
  sessions.set(userId, { step: 0, answers: {} });
}

function getSession(userId) {
  let s = sessions.get(userId);
  if (!s) {
    s = { step: 0, answers: {} };
    sessions.set(userId, s);
  }
  return s;
}

function nextQuestionFor(userId) {
  const s = getSession(userId);

  for (let i = s.step; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    if (q.depends) {
      const base = s.answers[q.depends.key];
      if (!q.depends.values.includes(base)) {
        // 条件を満たさない質問はスキップ
        s.step = i + 1;
        continue;
      }
    }
    return { index: i, question: q };
  }
  return null; // すべて完了
}
// ========================================================================

// ===== [E] Webhook & イベント処理 ==========================================
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events;
    const results = await Promise.all(events.map(handleEvent));
    return res.status(200).json(results);
  } catch (e) {
    console.error('[webhook error]', e);
    return res.status(200).end();
  }
});

async function handleEvent(event) {
  // テキストメッセージ
  if (event.type === 'message' && event.message.type === 'text') {
    const text = (event.message.text || '').trim();
    const userId = event.source.userId;

    // トリガー：カンタン見積りを依頼
    if (text === 'カンタン見積りを依頼') {
      startSession(userId);
      await replyText(event.replyToken, '見積もりを開始します。以下の質問にお答えください。');

      const nq = nextQuestionFor(userId);
      if (nq) {
        return replyFlex(event.replyToken, buildQuestionFlex(nq.question, nq.index));
      }
      return replyText(event.replyToken, '質問が見つかりませんでした。');
    }

    // その他のテキストは無視（必要ならここにFAQなど）
    return Promise.resolve(null);
  }

  // Flex のボタンからくる Postback 応答
  if (event.type === 'postback' && event.postback.data) {
    const userId = event.source.userId;
    let payload = {};
    try {
      payload = JSON.parse(event.postback.data);
    } catch {
      return replyText(event.replyToken, 'データ形式が不正です。やり直してください。');
    }

    if (payload.type === 'answer') {
      // 回答を保存
      const s = getSession(userId);
      s.answers[payload.key] = payload.value;
      s.step = payload.qIndex + 1;

      // 次の質問へ
      const nq = nextQuestionFor(userId);
      if (nq) {
        // 「了解しました」などの軽いレスを先に送ってから次のカードを返す
        await client.replyMessage(event.replyToken, [
          { type: 'text', text: `「${payload.value}」で承りました。次の質問です。` },
          buildQuestionFlex(nq.question, nq.index)
        ]);
        return;
      }

      // すべて完了 → 概算表示 & LIFF へ
      const estimate = calcRoughEstimate(s.answers);
      const liffUrl = `https://liff.line.me/${process.env.LIFF_ID}`;
      const summaryText =
        `ありがとうございます。概算の工事代金は *¥${estimate.toLocaleString()}* です。\n` +
        `※ご入力いただいた情報を元に算出した概算金額です。\n\n` +
        `詳しいお見積りをご希望の方は、下のボタンから必要事項をご入力ください。`;

      const buttonFlex = {
        type: 'flex',
        altText: '詳しい見積りをご希望の方へ',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'md',
            contents: [
              { type: 'text', text: '詳しい見積りをご希望の方へ', weight: 'bold', size: 'lg' },
              { type: 'text', text: '現地調査なしで、詳細なお見積りをLINEでお知らせします。', wrap: true },
              { type: 'text', text: `見積り金額（概算）：¥${estimate.toLocaleString()}`, weight: 'bold', size: 'md' }
            ]
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#1DB446',
                action: { type: 'uri', label: '現地調査なしで見積を依頼', uri: liffUrl }
              }
            ]
          }
        }
      };

      await client.replyMessage(event.replyToken, [
        { type: 'text', text: summaryText },
        buttonFlex
      ]);

      // セッション終了
      sessions.delete(userId);
      return;
    }

    return replyText(event.replyToken, '不明な操作です。最初からやり直してください。');
  }

  return Promise.resolve(null);
}

// 概算計算のダミー（要件に合わせて実装を差し替えてください）
function calcRoughEstimate(answers) {
  // かなり簡略化したサンプルの概算
  let base = 600000; // 基本
  if (answers['工事内容'] === '外壁塗装+屋根塗装') base += 300000;
  if (answers['工事内容'] === '屋根塗装') base += 150000;

  if (answers['kaisuu'] === '3階建て') base += 200000;
  if (answers['kaisuu'] === '2階建て') base += 80000;

  if (answers['距離'] === '30cm以下') base += 120000; // 足場難
  if (answers['距離'] === '50cm以下') base += 60000;

  return base;
}

// ----------------------------- サーバ起動 -----------------------------------
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
