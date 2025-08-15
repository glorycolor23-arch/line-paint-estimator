/* =========================================================================
 * 外壁塗装オンライン見積もり  安定版 Webhook サーバ
 * - すべての例外を握りつぶし、必ず HTTP 200 を返す
 * - テキスト・ポストバックの両方で ACK -> 次の質問 を保証
 * - 「カンタン見積りを依頼」トリガーは normalize して includes 判定
 * - 途中割込み（雑談等）は「見積りを停止しますか？」で中断/継続を分岐
 * - 最後は概算金額 + LIFF へ誘導
 * -------------------------------------------------------------------------
 * 変更ポイントだけ差し替えると齟齬が出やすいので全文を置き換えてください。
 * ========================================================================= */

import express from 'express';
import bodyParser from 'body-parser';
import { Client, middleware as lineMiddleware } from '@line/bot-sdk';

// -------------------------
// 1) LINE 設定
// -------------------------
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
const client = new Client(config);

// -------------------------
// 2) 小物ユーティリティ
// -------------------------

// 文字列をトリガー判定しやすい形に正規化
const normalize = (t = '') =>
  t
    .toString()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[‐-–ー−―]/g, '-') // ハイフン揺れ
    .toLowerCase();

// LINE API 例外を握りつぶすセーフ返信
async function safeReply(replyToken, messages) {
  try {
    if (!replyToken) return;
    // messages は単体でも配列でも可
    const arr = Array.isArray(messages) ? messages : [messages];
    await client.replyMessage(replyToken, arr);
  } catch (err) {
    console.error('[safeReply error]', err?.response?.data || err?.message || err);
    // ここで throw しない（絶対 500 にしない）
  }
}

// PUSH（確認ダイアログの再提示などに利用）
async function safePush(userId, messages) {
  try {
    if (!userId) return;
    const arr = Array.isArray(messages) ? messages : [messages];
    await client.pushMessage(userId, arr);
  } catch (err) {
    console.error('[safePush error]', err?.response?.data || err?.message || err);
  }
}

// -------------------------
// 3) 質問定義（画像付きボタン）
// -------------------------

// 画像はダミー（CDN の透過 PNG）を使用しています。必要に応じて差替え可
const dummy = 'https://cdn-icons-png.flaticon.com/512/565/565547.png';

const qDefs = [
  {
    key: 'q1_floors',
    text: '工事物件の階数は？',
    choices: ['1階建て', '2階建て', '3階建て'],
  },
  {
    key: 'q2_layout',
    text: '物件の間取りは？',
    choices: ['1K', '1DK', '1LDK', '2K', '2DK', '2LDK', '3K', '3DK', '4K', '4DK', '4LDK'],
  },
  {
    key: 'q3_age',
    text: '物件の築年数は？',
    choices: ['新築', '〜10年', '〜20年', '〜30年', '〜40年', '〜50年', '51年以上'],
  },
  {
    key: 'q4_painted',
    text: '過去に塗装をした経歴は？',
    choices: ['ある', 'ない', 'わからない'],
  },
  {
    key: 'q5_last',
    text: '前回の塗装はいつ頃？',
    choices: ['〜5年', '5〜10年', '10〜20年', '20〜30年', 'わからない'],
  },
  {
    key: 'q6_work',
    text: 'ご希望の工事内容は？',
    choices: ['外壁塗装', '屋根塗装', '外壁塗装+屋根塗装'],
  },
  // 条件付き質問（外壁）
  {
    key: 'q7_wall',
    text: '外壁の種類は？',
    choices: ['モルタル', 'サイディング', 'タイル', 'ALC'],
    condition: (ans) => ['外壁塗装', '外壁塗装+屋根塗装'].includes(ans.q6_work),
  },
  // 条件付き質問（屋根）
  {
    key: 'q8_roof',
    text: '屋根の種類は？',
    choices: ['瓦', 'スレート', 'ガルバリウム', 'トタン'],
    condition: (ans) => ['屋根塗装', '外壁塗装+屋根塗装'].includes(ans.q6_work),
  },
  {
    key: 'q9_leak',
    text: '雨漏りや漏水の症状はありますか？',
    choices: ['雨の日に水滴が落ちる', '天井にシミがある', 'ない'],
  },
  {
    key: 'q10_dist',
    text: '隣や裏の家との距離は？（周囲で一番近い距離）',
    choices: ['30cm以下', '50cm以下', '70cm以下', '70cm以上'],
  },
];

// カード（画像付きボタン）を生成
function makeFlexQuestion(title, options) {
  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'carousel',
      contents: options.map((label) => ({
        type: 'bubble',
        hero: {
          type: 'image',
          url: dummy,
          size: 'full',
          aspectRatio: '1.51:1',
          aspectMode: 'cover',
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: label, weight: 'bold', size: 'md', wrap: true },
            { type: 'text', text: title, size: 'sm', color: '#666666', wrap: true, margin: 'md' },
          ],
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'button',
              style: 'primary',
              height: 'sm',
              action: { type: 'postback', label: '選ぶ', data: `answer=${encodeURIComponent(label)}` },
            },
          ],
        },
      })),
    },
  };
}

// -------------------------
// 4) 状態管理（メモリ）
//    ※ Render 無料プランでは再起動で消えるため、
//      「途中で落ちる」場合はセッションが消え得ます。
//      本番は外部 KVS（Redis 等）推奨。
// -------------------------
const sessions = new Map(); // userId -> { step, answers, pause }

// セッション初期化
function startSession(userId) {
  const s = { step: 0, answers: {}, pause: false };
  sessions.set(userId, s);
  return s;
}

// 次に出すべき質問（条件付きでスキップ）
function nextQuestionFromStep(session) {
  for (let i = session.step; i < qDefs.length; i++) {
    const q = qDefs[i];
    if (!q.condition || q.condition(session.answers)) {
      return { index: i, def: q };
    }
  }
  return null; // すべて終了
}

// 概算金額（ダミー計算）
function calcRoughPrice(ans) {
  let base = 880000; // 基本価格
  if (ans.q1_floors === '3階建て') base += 120000;
  if (ans.q2_layout?.includes('4')) base += 120000;
  if (ans.q6_work === '外壁塗装+屋根塗装') base += 280000;
  if (ans.q7_wall === 'タイル') base += 150000;
  if (ans.q8_roof === '瓦') base += 80000;
  if (ans.q10_dist === '30cm以下') base += 60000;
  return Math.max(base, 580000);
}

// -------------------------
// 5) Express
// -------------------------
const app = express();
app.use(bodyParser.json());

// Health
app.get('/health', (_, res) => res.status(200).send('ok'));

// LIFF 静的
app.use('/liff', express.static('liff', { index: 'index.html' }));

// Webhook（とにかく 200 を返す）
app.post('/webhook', lineMiddleware(config), async (req, res) => {
  res.status(200).end('OK'); // 先に返す（ここが鉄壁）

  try {
    const events = req.body.events || [];
    for (const ev of events) {
      await handleEvent(ev);
    }
  } catch (e) {
    console.error('[webhook handler error]', e);
  }
});

// -------------------------
// 6) メインハンドラ
// -------------------------
async function handleEvent(event) {
  const userId = event.source?.userId;
  const type = event.type;

  // 受け取ったが userId 無い（グループ等）→無視
  if (!userId) return;

  // セッション確保
  let sess = sessions.get(userId) || startSession(userId);

  // 途中割込み（雑談）→ 停止確認
  const maybeInterrupt =
    type === 'message' &&
    event.message.type === 'text' &&
    !sess.pause &&
    sess.step > 0 &&
    // 直前が質問送出直後で選択待ちの場合、別テキストなら割込みと見なす
    normalize(event.message.text) !== normalize('はい') &&
    normalize(event.message.text) !== normalize('いいえ') &&
    !normalize(event.message.text).includes('30cm以下') &&
    !normalize(event.message.text).includes('50cm以下') &&
    !normalize(event.message.text).includes('70cm以下');

  // 1) Postback（選択肢の回答）
  if (type === 'postback') {
    const data = event.postback?.data || '';
    const m = data.match(/^answer=(.+)$/);
    if (m) {
      const value = decodeURIComponent(m[1]);
      // 「了解」メッセージ（ACK）
      await safeReply(event.replyToken, { type: 'text', text: `「${value}」で承りました。` });
      // 回答を保存して次へ
      const { index, def } = nextQuestionFromStep(sess) || {};
      if (def) {
        sess.answers[def.key] = value;
        sess.step = index + 1;
      }
      // 次の質問
      const next = nextQuestionFromStep(sess);
      if (next) {
        await safePush(userId, makeFlexQuestion(next.def.text, next.def.choices));
      } else {
        // 完了 → 概算 & LIFF
        await sendRoughAndLiff(userId, sess);
        // セッションを最後の状態で保持（LIFF で詳細入力するため）
      }
      return;
    }
  }

  // 2) テキスト
  if (type === 'message' && event.message.type === 'text') {
    const text = normalize(event.message.text);

    // トリガー群（ゆるい判定）
    const TRIGGERS = ['かんたん見積りを依頼', '簡単見積もり', '見積もりスタート'];
    const isTrigger = TRIGGERS.some((t) => text.includes(normalize(t)));

    // 「停止しますか？」の Yes/No
    if (text.includes('はい') && sess.pause) {
      // 停止を確定 → 破棄
      sessions.delete(userId);
      await safeReply(event.replyToken, { type: 'text', text: '見積りを停止しました。ご用件があればこのままトークしてください。' });
      return;
    }
    if (text.includes('いいえ') && sess.pause) {
      // 継続 → pause 解除 & 直近の質問を再送
      sess.pause = false;
      await safeReply(event.replyToken, { type: 'text', text: '見積りを継続します。' });
      const next = nextQuestionFromStep(sess) || {};
      if (next.def) {
        await safePush(userId, makeFlexQuestion(next.def.text, next.def.choices));
      }
      return;
    }

    // トリガー（いつでも開始可）
    if (isTrigger) {
      sess = startSession(userId); // 強制的に新規セッションにする
      await safeReply(event.replyToken, { type: 'text', text: '見積もりを開始します。以下の質問にお答えください。' });
      const first = nextQuestionFromStep(sess);
      if (first?.def) {
        await safePush(userId, makeFlexQuestion(first.def.text, first.def.choices));
      }
      return;
    }

    // 途中割込み → 停止確認
    if (maybeInterrupt) {
      sess.pause = true;
      await safeReply(event.replyToken, [
        { type: 'text', text: '見積りを停止しますか？' },
        {
          type: 'template',
          altText: '見積りを停止しますか？',
          template: {
            type: 'confirm',
            text: '見積りを停止しますか？',
            actions: [
              { type: 'message', label: 'はい', text: 'はい' },
              { type: 'message', label: 'いいえ', text: 'いいえ' },
            ],
          },
        },
      ]);
      return;
    }

    // それ以外は通常トーク扱い（無視しない）
    await safeReply(event.replyToken, { type: 'text', text: 'メニューから「カンタン見積りを依頼」を押すと見積りを開始します。' });
    return;
  }

  // 3) フォロー時など
  if (type === 'follow') {
    await safeReply(event.replyToken, { type: 'text', text: '友だち追加ありがとうございます。「カンタン見積りを依頼」で見積りを開始できます。' });
  }
}

// -------------------------
// 7) 概算＋LIFF 誘導
// -------------------------
async function sendRoughAndLiff(userId, sess) {
  const price = calcRoughPrice(sess.answers);
  const priceStr = `￥${price.toLocaleString()}`;

  // 回答まとめ
  const a = sess.answers;
  const lines = [
    `・階数: ${a.q1_floors || '—'} / 間取り: ${a.q2_layout || '—'} / 築年数: ${a.q3_age || '—'}`,
    `・過去塗装: ${a.q4_painted || '—'} / 前回から: ${a.q5_last || '—'}`,
    `・工事内容: ${a.q6_work || '—'} / 外壁: ${a.q7_wall || '—'} / 屋根: ${a.q8_roof || '—'}`,
    `・雨漏り: ${a.q9_leak || '—'} / 距離: ${a.q10_dist || '—'}`,
  ].join('\n');

  const liffUrl = 'https://line-paint.onrender.com/liff/index.html';

  await safePush(userId, [
    { type: 'text', text: 'ありがとうございます。概算を作成しました。' },
    { type: 'text', text: `【回答の確認】\n${lines}` },
    {
      type: 'flex',
      altText: '概算見積り',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            { type: 'text', text: '見積り金額', weight: 'bold', size: 'md' },
            { type: 'text', text: priceStr, weight: 'bold', size: 'xl' },
            { type: 'text', text: '上記はご入力内容を元に算出した概算です。', wrap: true, size: 'sm', color: '#666' },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            {
              type: 'text',
              text: '正式なお見積りが必要な方は続けてご入力ください。',
              wrap: true,
              size: 'sm',
            },
            {
              type: 'button',
              style: 'primary',
              action: { type: 'uri', label: '現地調査なしで見積を依頼', uri: liffUrl },
            },
          ],
        },
      },
    },
  ]);
}

// -------------------------
// 8) 起動
// -------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
