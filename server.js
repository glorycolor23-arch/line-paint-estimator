/****************************************************
 * 外壁・屋根「カンタン見積り」— 次のステップ（Q1〜Q3）
 *  - トリガー: 「カンタン見積りを依頼」「見積もりスタート」
 *  - リセット: 「はじめからやり直す」「リセット」
 *  - 質問: Q1 階数 → Q2 間取り → Q3 築年数
 *  - 各イベントは 1 回の replyMessage にまとめて送信（止まらない作り）
 *  - 以降の質問（Q4~）は ※変更ポイント に従って追加してください
 ****************************************************/

import express from 'express';
import crypto from 'crypto';
import line from '@line/bot-sdk';

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  LIFF_ID,             // LIFF起動ボタンを出す場合に利用（未使用でも可）
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error('Environment variables CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET are required.');
  process.exit(1);
}

const client = new line.Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
});

const app = express();

/* -----------------------------
 * 署名検証 + body パーサ（LINE Webhook）
 * ----------------------------- */
app.use('/webhook', express.raw({ type: '*/*' }), (req, res, next) => {
  const hmac = crypto.createHmac('sha256', CHANNEL_SECRET);
  hmac.update(req.body);
  const signature = hmac.digest('base64');
  const headerSig = req.get('x-line-signature');

  if (signature !== headerSig) {
    console.warn('Signature validation failed.');
    return res.status(403).send('invalid signature');
  }
  try {
    req.body = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).send('invalid body');
  }
  next();
});

/* -----------------------------
 * Health / LIFF env
 * ----------------------------- */
app.get('/health', (_req, res) => res.send('ok'));
app.get('/liff/env.js', (_req, res) => {
  res.type('application/javascript').send(`window.__LIFF_ENV__ = ${JSON.stringify({ LIFF_ID })};`);
});

/* -----------------------------
 * 会話状態（簡易インメモリ）
 *   userId -> { step: number, answers: { ... }, updatedAt: number }
 *   step: 0=未開始, 1=Q1待ち, 2=Q2待ち, 3=Q3待ち, 9=完了手前
 * ----------------------------- */
const session = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30分

function getOrCreateState(userId) {
  const now = Date.now();
  const s = session.get(userId);
  if (!s || now - s.updatedAt > SESSION_TTL_MS) {
    const st = { step: 0, answers: {}, updatedAt: now };
    session.set(userId, st);
    return st;
  }
  s.updatedAt = now;
  return s;
}

function resetState(userId) {
  session.set(userId, { step: 0, answers: {}, updatedAt: Date.now() });
}

/* -----------------------------
 * 共通送信ユーティリティ
 * ----------------------------- */
async function safeReply(replyToken, messages) {
  try {
    const arr = Array.isArray(messages) ? messages : [messages];
    await client.replyMessage(replyToken, arr);
  } catch (e) {
    console.error('safeReply error:', e?.response?.data || e.message || e);
  }
}

function textMsg(text) {
  return { type: 'text', text };
}

function btnTemplate({ title, text, actions }) {
  return {
    type: 'template',
    altText: title || text || 'メニュー',
    template: {
      type: 'buttons',
      title: title || '選択してください',
      text: text || '選択してください',
      actions,
    },
  };
}

/* ------------------------------------------------
 * 質問ビルダー（Q1〜Q3）
 *  ※変更ポイント：Q4 以降はここに関数を追加
 * ------------------------------------------------ */
function buildQ1() {
  return btnTemplate({
    title: '1/3 工事物件の階数は？',
    text: '該当する階数を選択してください。',
    actions: [
      { type: 'message', label: '1階建て', text: '1階建て' },
      { type: 'message', label: '2階建て', text: '2階建て' },
      { type: 'message', label: '3階建て', text: '3階建て' },
    ],
  });
}
function buildQ2() {
  return btnTemplate({
    title: '2/3 物件の間取りは？',
    text: '近いものを選択してください。',
    actions: [
      { type: 'message', label: '1K', text: '1K' },
      { type: 'message', label: '1DK', text: '1DK' },
      { type: 'message', label: '1LDK', text: '1LDK' },
      { type: 'message', label: '2K', text: '2K' },
    ],
  });
}
// 間取りが多いので第2ボタンで続き（reply 1 回内で 2 枚まで）
function buildQ2_part2() {
  return btnTemplate({
    title: '2/3 物件の間取りは？（続き）',
    text: 'さらに選べます。',
    actions: [
      { type: 'message', label: '2DK', text: '2DK' },
      { type: 'message', label: '2LDK', text: '2LDK' },
      { type: 'message', label: '3K', text: '3K' },
      { type: 'message', label: '3DK', text: '3DK' },
    ],
  });
}
function buildQ2_part3() {
  return btnTemplate({
    title: '2/3 物件の間取りは？（続き2）',
    text: 'さらに選べます。',
    actions: [
      { type: 'message', label: '3LDK', text: '3LDK' },
      { type: 'message', label: '4K', text: '4K' },
      { type: 'message', label: '4DK', text: '4DK' },
      { type: 'message', label: '4LDK', text: '4LDK' },
    ],
  });
}

function buildQ3() {
  return btnTemplate({
    title: '3/3 物件の築年数は？',
    text: 'おおよその年数で構いません。',
    actions: [
      { type: 'message', label: '新築', text: '新築' },
      { type: 'message', label: '〜10年', text: '〜10年' },
      { type: 'message', label: '〜20年', text: '〜20年' },
      { type: 'message', label: '〜30年', text: '〜30年' },
    ],
  });
}
function buildQ3_part2() {
  return btnTemplate({
    title: '3/3 物件の築年数は？（続き）',
    text: 'さらに選べます。',
    actions: [
      { type: 'message', label: '〜40年', text: '〜40年' },
      { type: 'message', label: '〜50年', text: '〜50年' },
      { type: 'message', label: '51年以上', text: '51年以上' },
      { type: 'message', label: 'わからない', text: 'わからない' },
    ],
  });
}

/* --------------------------------------------
 * 次の質問へ遷移させる（push ではなく reply 1 回でまとめる）
 *  ※変更ポイント：Q4 以降は switch に case を追加
 * -------------------------------------------- */
function nextQuestionMessages(state) {
  const msgs = [];
  if (state.step === 1) {
    // Q1待ち → Q1を提示
    msgs.push(textMsg('見積もりを開始します。以下の質問にお答えください。'));
    msgs.push(buildQ1());
  } else if (state.step === 2) {
    // Q2待ち
    msgs.push(textMsg('ありがとうございます。次の質問です。'));
    msgs.push(buildQ2(), buildQ2_part2());
    // reply の 1 回あたり 5 通まで送れるが、多すぎると既読性が落ちるので
    // 3 枚目は次イベントでも提示できるように工夫
    // ここでは 2 枚出し、回答時に不足分を出さず確定でも可
    msgs.push(buildQ2_part3());
  } else if (state.step === 3) {
    // Q3待ち
    msgs.push(textMsg('ありがとうございます。次の質問です。'));
    msgs.push(buildQ3(), buildQ3_part2());
  } else if (state.step === 9) {
    // Q3まで完了
    msgs.push(textMsg(
      'ここまでの回答を受け付けました。続き（Q4以降）はこの後のバージョンで追加されます。' +
      '正式なお見積りをご希望の場合は、LIFFからご連絡先をご入力ください。'
    ));
    if (LIFF_ID) {
      msgs.push(btnTemplate({
        title: '詳しい見積もりをご希望の方へ',
        text: '現地調査なしで、詳細な見積りをLINEでお送りします。',
        actions: [
          { type: 'uri', label: '現地調査なしで見積を依頼', uri: `https://liff.line.me/${LIFF_ID}` },
        ],
      }));
    }
  } else {
    msgs.push(textMsg('見積もりを開始するには「カンタン見積りを依頼」と送信してください。'));
  }
  return msgs;
}

/* --------------------------------------------
 * Webhook メイン
 * -------------------------------------------- */
app.post('/webhook', async (req, res) => {
  const events = req.body.events || [];
  res.sendStatus(200);

  for (const ev of events) {
    try {
      if (!ev.source || !ev.source.userId) continue;
      const userId = ev.source.userId;
      const st = getOrCreateState(userId);

      // フォロー/参加
      if (ev.type === 'follow' || ev.type === 'join') {
        resetState(userId);
        await safeReply(ev.replyToken, [
          textMsg('友だち追加ありがとうございます。'),
          textMsg('「カンタン見積りを依頼」と送ると見積もりを開始します。'),
        ]);
        continue;
      }

      // メッセージ（テキストのみ扱う）
      if (ev.type === 'message' && ev.message.type === 'text') {
        const t = (ev.message.text || '').trim();

        // リセット系
        if (t === 'はじめからやり直す' || t === 'リセット') {
          resetState(userId);
          const s = getOrCreateState(userId);
          s.step = 1; // すぐ Q1 を出す
          await safeReply(ev.replyToken, nextQuestionMessages(s));
          continue;
        }

        // トリガー
        if (t === 'カンタン見積りを依頼' || t === '見積もりスタート') {
          resetState(userId);
          const s = getOrCreateState(userId);
          s.step = 1; // Q1
          await safeReply(ev.replyToken, nextQuestionMessages(s));
          continue;
        }

        // ここから回答の解釈
        // Q1: 階数
        if (st.step === 1 && ['1階建て','2階建て','3階建て'].includes(t)) {
          st.answers.q1_floors = t;
          st.step = 2;
          await safeReply(ev.replyToken, [
            textMsg(`「${t}」で承りました。`),
            ...nextQuestionMessages(st),
          ]);
          continue;
        }
        // Q2: 間取り
        const madoriOptions = ['1K','1DK','1LDK','2K','2DK','2LDK','3K','3DK','3LDK','4K','4DK','4LDK'];
        if (st.step === 2 && madoriOptions.includes(t)) {
          st.answers.q2_layout = t;
          st.step = 3;
          await safeReply(ev.replyToken, [
            textMsg(`「${t}」で承りました。`),
            ...nextQuestionMessages(st),
          ]);
          continue;
        }
        // Q3: 築年数
        const ageOptions = ['新築','〜10年','〜20年','〜30年','〜40年','〜50年','51年以上','わからない'];
        if (st.step === 3 && ageOptions.includes(t)) {
          st.answers.q3_age = t;
          st.step = 9; // Q3 でいったん完了手前
          await safeReply(ev.replyToken, [
            textMsg(`「${t}」で承りました。`),
            ...nextQuestionMessages(st),
          ]);
          continue;
        }

        // 想定外テキスト
        await safeReply(ev.replyToken, textMsg('入力内容を確認できませんでした。ボタンから選択してください。'));
        continue;
      }

      // 画像など別タイプのときも無音で終わらないように一言返す
      if (ev.type === 'message' && ev.message.type !== 'text') {
        await safeReply(ev.replyToken, textMsg('メッセージを受信しました。ボタンからお進みください。'));
        continue;
      }

    } catch (e) {
      console.error('Event error:', e?.response?.data || e.message || e);
    }
  }
});

/* -----------------------------
 * 起動
 * ----------------------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});

/* ============================================
 *  ※変更ポイント（Q4 以降を増やすとき）
 *  1) 上の「質問ビルダー」に buildQ4, buildQ5... を追加
 *  2) nextQuestionMessages(state) の switch に case を追加
 *     - state.step === 4 → Q4 を提示、という流れ
 *  3) /webhook の回答解釈にも
 *     - st.step === 4 && options.includes(t) { st.answers.q4=..., st.step=5; reply([...]); }
 *  4) 画像を受けたあと止まるのを防ぐため
 *     - 画像受領時は必ず 1 行「受領しました、次へ」と返信し、
 *       次の質問は同一 reply 内にテンプレを添える or 次のイベントで push する
 * ============================================ */
