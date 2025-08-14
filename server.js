// =============================
// server.js  ← このファイルをそのまま丸ごと置き換え
// LINE Messaging API のみで動作（LIFF なし）
// トリガー: 「カンタン見積りを依頼」
// ・過去の状態が残っていても必ず新規開始（強制リセット）
// ・テキストでもリッチメニューのメッセージでも発火
// ・質問は画像カード（Flex）/ クイックリプライで提示
// ・写真アップロードの待受けも堅牢化（スキップ対応）
// 必要な環境変数: CHANNEL_ACCESS_TOKEN, CHANNEL_SECRET
// =============================

import 'dotenv/config';
import express from 'express';
import { middleware, Client } from '@line/bot-sdk';

// -----------------------------------------------------
// [セクションA] LINE クライアント設定（変更点がある場合はここだけ）
// -----------------------------------------------------
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
const client = new Client(config);

// -----------------------------------------------------
// [セクションB] サーバ基盤
// -----------------------------------------------------
const app = express();
app.get('/health', (_req, res) => res.status(200).send('ok'));

// LINE 署名検証 & Webhook
app.post('/webhook', middleware(config), async (req, res) => {
  // LINE からのイベントを逐次処理
  const events = req.body.events || [];
  await Promise.all(events.map(handleEventSafely));
  res.status(200).end();
});

// -----------------------------------------------------
// [セクションC] セッション管理（メモリ）
//  - TTL を超えたら破棄
//  - 何らかの理由で詰まっても「カンタン見積りを依頼」で必ず開始
// -----------------------------------------------------
const SESS_TTL_MS = 1000 * 60 * 60; // 1時間
const sessions = new Map();
/**
 * 取得（期限切れなら破棄して undefined）
 */
function getSession(userId) {
  const data = sessions.get(userId);
  if (!data) return undefined;
  if (Date.now() - data.updatedAt > SESS_TTL_MS) {
    sessions.delete(userId);
    return undefined;
  }
  return data;
}
/**
 * 保存
 */
function setSession(userId, data) {
  sessions.set(userId, { ...data, updatedAt: Date.now() });
}
function resetSession(userId) {
  sessions.delete(userId);
}

// -----------------------------------------------------
// [セクションD] トリガー/共通ユーティリティ
// -----------------------------------------------------
const TRIGGER_TEXT = 'カンタン見積りを依頼';
const RESET_WORDS = ['リセット', 'はじめから', '最初から', 'やり直し'];

/**
 * 文字正規化（空白/改行/引用符/全角・半角空白を無視）
 */
function normalize(str = '') {
  return String(str)
    .replace(/[\u3000\r\n\t]/g, ' ') // 全角空白/改行/タブ→半角空白
    .replace(/\s+/g, ' ')            // 連続空白→1つ
    .trim();
}
/**
 * TRIGGER の緩め判定
 * - 完全一致 もしくは 含む（メニュー経由で前後に文言が付いた場合を吸収）
 */
function isTrigger(text) {
  const t = normalize(text);
  return t === TRIGGER_TEXT || t.includes(TRIGGER_TEXT);
}
function isReset(text) {
  const t = normalize(text);
  return RESET_WORDS.some(w => w === t);
}

// -----------------------------------------------------
// [セクションE] 質問フロー定義
//  仕様（ユーザー指示の通り）
// -----------------------------------------------------
/*
  ステップキー一覧:
   floors, layout, builtYear, paintedBefore, lastPaint,
   workType, wallType?, roofType?, leak, distance,
   plan_elev, plan_flat, plan_section,
   photo_front, photo_right, photo_left, photo_back,
   photo_garage, photo_crack (任意/スキップ可),
   complete（自動）
*/

const QUESTION_SET = {
  floors: {
    type: 'choice',
    title: '工事物件の階数は？',
    options: ['1階建て', '2階建て', '3階建て']
  },
  layout: {
    type: 'choice',
    title: '物件の間取りは？',
    options: ['1K', '1DK', '1LDK', '2K', '2DK', '2LDK', '3K', '3DK', '4K', '4DK', '4LDK']
  },
  builtYear: {
    type: 'choice',
    title: '物件の築年数は？',
    options: ['新築', '〜10年', '〜20年', '〜30年', '〜40年', '〜50年', '51年以上']
  },
  paintedBefore: {
    type: 'choice',
    title: '過去に塗装をした経歴は？',
    options: ['ある', 'ない', 'わからない']
  },
  lastPaint: {
    type: 'choice',
    title: '前回の塗装はいつ頃？',
    options: ['〜5年', '5〜10年', '10〜20年', '20〜30年', 'わからない']
  },
  workType: {
    type: 'choice',
    title: 'ご希望の工事内容は？',
    options: ['外壁塗装', '屋根塗装', '外壁塗装+屋根塗装']
  },
  wallType: {
    type: 'choice',
    title: '外壁の種類は？（外壁塗装を選んだ場合）',
    options: ['モルタル', 'サイディング', 'タイル', 'ALC']
  },
  roofType: {
    type: 'choice',
    title: '屋根の種類は？（屋根塗装を選んだ場合）',
    options: ['瓦', 'スレート', 'ガルバリウム', 'トタン']
  },
  leak: {
    type: 'choice',
    title: '雨漏りや漏水の症状はありますか？',
    options: ['雨の日に水滴が落ちる', '天井にシミがある', 'ない']
  },
  distance: {
    type: 'choice',
    title: '隣や裏の家との距離は？（周囲で一番近い距離）',
    options: ['30cm以下', '50cm以下', '70cm以下', '70cm以上']
  },
  plan_elev: {
    type: 'image',
    title: '立面図をアップロードしてください'
  },
  plan_flat: {
    type: 'image',
    title: '平面図をアップロードしてください'
  },
  plan_section: {
    type: 'image',
    title: '断面図をアップロードしてください'
  },
  photo_front: {
    type: 'image',
    title: '正面から撮影した写真をアップロードしてください\n※足場確認のため地面まで写るもの'
  },
  photo_right: {
    type: 'image',
    title: '右側から撮影した写真をアップロードしてください\n※地面まで写るもの'
  },
  photo_left: {
    type: 'image',
    title: '左側から撮影した写真をアップロードしてください\n※地面まで写るもの'
  },
  photo_back: {
    type: 'image',
    title: '後ろ側から撮影した写真をアップロードしてください\n※地面まで写るもの'
  },
  photo_garage: {
    type: 'image',
    title: '車庫の位置がわかる写真をアップロードしてください'
  },
  photo_crack: {
    type: 'imageOptional',
    title: '外壁や屋根にヒビ/割れがある場合は写真をアップしてください（なければ「スキップ」）'
  }
};

// フローの並びと条件分岐
function buildSteps(answers) {
  // workType 次第で分岐
  const list = [
    'floors', 'layout', 'builtYear', 'paintedBefore', 'lastPaint', 'workType'
  ];

  const wt = answers?.workType;
  const needWall = wt === '外壁塗装' || wt === '外壁塗装+屋根塗装';
  const needRoof = wt === '屋根塗装' || wt === '外壁塗装+屋根塗装';

  if (needWall) list.push('wallType');
  if (needRoof) list.push('roofType');

  list.push('leak', 'distance',
    'plan_elev', 'plan_flat', 'plan_section',
    'photo_front', 'photo_right', 'photo_left', 'photo_back',
    'photo_garage', 'photo_crack');

  return list;
}

// -----------------------------------------------------
// [セクションF] メッセージUI 生成（Flex/QuickReply）
// 画像はダミーURL（placehold.jp）を使用
// -----------------------------------------------------
function choiceFlex(title, options) {
  // 3列カード風に分割
  const color = 'f0f0f0';
  const cards = options.map(opt => ({
    type: 'bubble',
    size: 'micro',
    hero: {
      type: 'image',
      url: `https://placehold.jp/24/${color}/666/600x400.png?text=${encodeURIComponent(opt)}`,
      size: 'full',
      aspectRatio: '3:2',
      aspectMode: 'cover'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: opt, weight: 'bold', wrap: true, size: 'sm' },
        {
          type: 'button',
          style: 'primary',
          height: 'sm',
          action: { type: 'message', label: '選ぶ', text: opt }
        }
      ]
    }
  }));

  return [
    { type: 'text', text: title },
    {
      type: 'flex',
      altText: title,
      contents: { type: 'carousel', contents: cards }
    }
  ];
}

function askImage(title, optional = false) {
  const qr = [
    {
      type: 'action',
      action: { type: 'message', label: 'スキップ', text: 'スキップ' }
    }
  ];
  return {
    type: 'text',
    text: optional ? `${title}\n（任意・「スキップ」で省略可）` : `${title}\n（写真を送ってください）`,
    quickReply: { items: optional ? qr : [] }
  };
}

// -----------------------------------------------------
// [セクションG] イベント処理本体
// -----------------------------------------------------
async function handleEventSafely(event) {
  try {
    await handleEvent(event);
  } catch (e) {
    // 失敗しても 400 を返してしまうと LINE 側でリトライされるので
    // ログだけ残して握りつぶす（サーバは 200 を返している）
    console.error('[handleEvent error]', e);
  }
}

async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // 1) メッセージイベント
  if (event.type === 'message') {
    const m = event.message;

    // ステッカー等は無視
    if (m.type !== 'text' && m.type !== 'image') {
      return;
    }

    const sess = getSession(userId);

    // 画像アップロード待ち
    if (m.type === 'image') {
      if (!sess || !sess.waitImageKey) {
        // 画像が不要な場面では無視
        return;
      }
      await handleImageAnswer(userId, event.replyToken, sess.waitImageKey, m.id);
      return;
    }

    // テキスト
    const text = normalize(m.text);

    // リセット系
    if (isReset(text)) {
      resetSession(userId);
      await client.replyMessage(event.replyToken, {
        type: 'text', text: '状態をリセットしました。もう一度「カンタン見積りを依頼」と送ってください。'
      });
      return;
    }

    // 2) トリガー判定（常に最優先 / 強制リセットして開始）
    if (isTrigger(text)) {
      resetSession(userId);
      const newSess = { stepIndex: 0, answers: {} };
      setSession(userId, newSess);
      await startQuestion(userId, event.replyToken, newSess);
      return;
    }

    // 3) 進行中の質問に回答
    if (sess) {
      await handleAnswer(userId, event.replyToken, sess, text);
      return;
    }

    // 4) 何も該当しない場合はガイド
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '見積もりを開始するには「カンタン見積りを依頼」と送ってください。'
    });
    return;
  }

  // 2) ポストバック（将来の拡張用：リッチメニューを postback に変えた場合ここで拾える）
  if (event.type === 'postback') {
    const data = event.postback?.data || '';
    if (isTrigger(data)) {
      resetSession(userId);
      const newSess = { stepIndex: 0, answers: {} };
      setSession(userId, newSess);
      await startQuestion(userId, event.replyToken, newSess);
    }
  }
}

// -----------------------------------------------------
// [セクションH] 質問表示・回答処理
// -----------------------------------------------------
async function startQuestion(userId, replyToken, sess) {
  const steps = buildSteps(sess.answers);
  const key = steps[0];
  await client.replyMessage(replyToken, [
    { type: 'text', text: '見積もりを開始します。以下の質問にお答えください。' },
    ...renderQuestion(key)
  ]);
  setSession(userId, { ...sess, currentKey: key });
}

function renderQuestion(key) {
  const q = QUESTION_SET[key];
  if (!q) return [{ type: 'text', text: '質問の定義が見つかりませんでした。' }];

  if (q.type === 'choice') {
    return choiceFlex(q.title, q.options);
  }
  if (q.type === 'image') {
    return [askImage(q.title, false)];
  }
  if (q.type === 'imageOptional') {
    return [askImage(q.title, true)];
  }
  return [{ type: 'text', text: q.title }];
}

async function handleAnswer(userId, replyToken, sess, text) {
  const steps = buildSteps(sess.answers);
  const currKey = sess.currentKey || steps[sess.stepIndex];
  const q = QUESTION_SET[currKey];

  if (!q) {
    // 想定外 → やり直し
    resetSession(userId);
    await client.replyMessage(replyToken, {
      type: 'text', text: '状態をリセットしました。もう一度「カンタン見積りを依頼」と送ってください。'
    });
    return;
  }

  // choice 回答
  if (q.type === 'choice') {
    // 選択肢外 → 再提示
    if (!q.options.includes(text)) {
      await client.replyMessage(replyToken, [
        { type: 'text', text: '選択肢からお選びください。' },
        ...renderQuestion(currKey)
      ]);
      return;
    }
    // 保存
    const answers = { ...sess.answers, [currKey]: text };
    // 次のステップ
    const nextSteps = buildSteps(answers);
    const nextIndex = nextSteps.findIndex(k => k === currKey) + 1;

    if (nextIndex >= nextSteps.length) {
      // すべて終わり
      await finish(userId, replyToken, answers);
      return;
    }

    const nextKey = nextSteps[nextIndex];
    setSession(userId, { stepIndex: nextIndex, currentKey: nextKey, answers });
    await client.replyMessage(replyToken, renderQuestion(nextKey));
    return;
  }

  // image / imageOptional はテキストでは処理しない
  const optional = q.type === 'imageOptional';
  if (text === 'スキップ' && optional) {
    // 次へ
    const answers = { ...sess.answers, [currKey]: '(skipped)' };
    const nextSteps = buildSteps(answers);
    const nextIndex = nextSteps.findIndex(k => k === currKey) + 1;
    const nextKey = nextSteps[nextIndex];
    setSession(userId, { stepIndex: nextIndex, currentKey: nextKey, answers, waitImageKey: undefined });
    await client.replyMessage(replyToken, renderQuestion(nextKey));
    return;
  }

  // 画像待ちに切替（この段階でテキストが来たら再案内）
  setSession(userId, { ...sess, waitImageKey: currKey });
  await client.replyMessage(replyToken, [
    { type: 'text', text: '写真を送ってください。（アルバムから選択可）' },
    askImage(q.title, optional)
  ]);
}

async function handleImageAnswer(userId, replyToken, key, messageId) {
  // 画像コンテンツ取得 → 今回はIDのみ保存（ストレージ保存は省略）
  const sess = getSession(userId);
  if (!sess) return;

  const answers = { ...sess.answers, [key]: `image:${messageId}` };
  const nextSteps = buildSteps(answers);
  const nextIndex = nextSteps.findIndex(k => k === key) + 1;

  if (nextIndex >= nextSteps.length) {
    await finish(userId, replyToken, answers);
    return;
  }
  const nextKey = nextSteps[nextIndex];
  setSession(userId, { stepIndex: nextIndex, currentKey: nextKey, answers, waitImageKey: undefined });
  await client.replyMessage(replyToken, renderQuestion(nextKey));
}

// -----------------------------------------------------
// [セクションI] 完了メッセージ
// -----------------------------------------------------
async function finish(userId, replyToken, answers) {
  resetSession(userId);
  // 概算のカード（UIのみ。金額の算出はここではダミー表示）
  const alt = '概算見積り';
  const card = {
    type: 'flex',
    altText: alt,
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://placehold.jp/24/e6f4ea/1f7a55/1200x600.png?text=%E6%A6%82%E7%AE%97%E8%A6%8B%E7%A9%8D%E3%82%8A',
        size: 'full',
        aspectRatio: '2:1',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: 'ありがとうございます。', weight: 'bold', size: 'lg' },
          { type: 'text', text: '工事代金（概算）', size: 'sm', color: '#888888' },
          { type: 'text', text: '¥0,000,000', weight: 'bold', size: 'xl' },
          { type: 'text', text: '※ご入力いただいた情報を元に算出した概算見積もりです。', size: 'xs', color: '#666666', wrap: true },
          { type: 'separator' },
          { type: 'text', text: '正確なお見積もりが必要な方はこちら', margin: 'md' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            action: {
              type: 'uri',
              label: '現地調査なしで見積を依頼',
              uri: 'https://liff.line.me/2007914959-XP5Rpoay'
            }
          }
        ]
      }
    }
  };

  // 最後に質問の簡易サマリも付与（テキスト）
  const summaryLines = Object.entries(answers)
    .map(([k, v]) => `・${k}: ${v}`)
    .join('\n');

  await client.replyMessage(replyToken, [
    card,
    { type: 'text', text: '回答の控え：\n' + summaryLines }
  ]);
}

// -----------------------------------------------------
// [セクションJ] サーバ起動
// -----------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('listening on', PORT);
});

/* =====================================================
【このファイルを今後修正するときのガイド】

◆トリガー文言/厳しさを変えたい
  - [セクションD] isTrigger(), TRIGGER_TEXT を変更

◆リセットの合言葉を増やしたい
  - [セクションD] RESET_WORDS を編集

◆質問の内容・順序を変えたい
  - [セクションE] QUESTION_SET に定義
  - 分岐や順序は buildSteps() を編集
  - 画像を任意化したい → type: 'imageOptional'
  - 画像を必須にしたい → type: 'image'

◆UI（カード/クイックリプライ）を変えたい
  - [セクションF] choiceFlex()/askImage() を編集
  - 画像カードのダミー画像は placehold.jp を利用中

◆開始時の強制リセットをやめたい/条件を緩めたい
  - [セクションG] handleEvent() 内の isTrigger(text) ブロックを編集

◆完了時のカードや LIFF のURLを変えたい
  - [セクションI] finish() を編集（URIボタンのリンクなど）

◆メモリセッションの保持時間を変えたい
  - [セクションC] SESS_TTL_MS を編集

===================================================== */
