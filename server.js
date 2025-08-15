// ============================================================================
// server.js — LINE 外装工事 かんたん見積り（会話フロー安定版）
// - 返信 400 対策: reply はテキスト 1 件のみ、残りは push に分割
// - トリガー: 「カンタン見積りを依頼」のみで開始（前後空白は無視）
// - 雑談検出: 見積り中に任意テキスト → 「停止しますか？」確認
// - 条件分岐: 外壁／屋根の質問は工事内容に応じて出し分け
// - 画像付き Quick Reply（カード風）
// - /liff 静的配信（public/liff）
// 環境変数:
//   CHANNEL_SECRET, CHANNEL_ACCESS_TOKEN（必須）
//   BASE_URL（任意: 例 https://line-paint.onrender.com）
// ポート: PORT（Renderが注入。無ければ 10000）
// ============================================================================

import 'dotenv/config';
import express from 'express';
import { Client, middleware as lineMiddleware } from '@line/bot-sdk';
import path from 'node:path';

// ---------- 設定 ----------
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error('[FATAL] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です');
  process.exit(1);
}
const BASE_URL = process.env.BASE_URL || 'https://line-paint.onrender.com';

// ---------- LINE クライアント ----------
const client = new Client(config);

// ---------- Express ----------
const app = express();
app.use(express.json());

// /health
app.get('/health', (_, res) => res.status(200).send('ok'));

// /liff を静的配信（public/liff/index.html, env.js など）
app.use('/liff', express.static(path.join(process.cwd(), 'public', 'liff')));

// Webhook
app.post('/webhook', lineMiddleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook error:', e);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('listening on', PORT));

// ============================================================================
// 状態管理（超シンプル: プロセス内 Map）
// 本番は Redis/DB 推奨
// ============================================================================
const sessions = new Map(); // userId -> { step, answers, interrupt }

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { step: 0, answers: {}, interrupt: false });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, { step: 0, answers: {}, interrupt: false });
}

// ============================================================================
// ユーティリティ
// ============================================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logLineApiError(err, context = '') {
  console.error('[LINE-API ERROR]', context);
  try {
    console.error('status:', err?.status || err?.statusCode || '-');
    if (err?.response) {
      console.error('response.data:', JSON.stringify(err.response.data, null, 2));
    }
  } catch (_) {}
  console.error(err);
}

// reply が失敗したら push で救済する
async function replySafeOrPush(userId, replyToken, messages, context = '') {
  const arr = Array.isArray(messages) ? messages : [messages];
  try {
    await client.replyMessage(replyToken, arr);
    return true;
  } catch (e) {
    logLineApiError(e, 'replySafeOrPush: ' + context);
    try {
      await client.pushMessage(userId, arr);
      return false;
    } catch (e2) {
      logLineApiError(e2, 'push fallback: ' + context);
      return false;
    }
  }
}

// JSON っぽい postback.data を安全に読む（"k=q1&v=1階建て" 形式）
function parseKV(data) {
  const out = {};
  String(data || '')
    .split('&')
    .forEach((p) => {
      const [k, v] = p.split('=');
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
  return out;
}

// 画像付き QuickReply（カード風）
function makeQuickReply(items) {
  return { items: items.map((it) => ({ type: 'action', imageUrl: it.icon, action: it.action })) };
}
function pb(label, data, icon, displayText) {
  return {
    icon,
    action: {
      type: 'postback',
      label,
      data,
      displayText: displayText || label,
    },
  };
}

// アイコン（ダミー画像：どれも商用フリーのプレースホルダー）
const ICONS = {
  floors:  'https://img.icons8.com/fluency/96/building.png',
  layout:  'https://img.icons8.com/fluency/96/floor-plan.png',
  age:     'https://img.icons8.com/fluency/96/hourglass-sand-bottom.png',
  yes:     'https://img.icons8.com/fluency/96/ok.png',
  no:      'https://img.icons8.com/fluency/96/cancel.png',
  paint:   'https://img.icons8.com/fluency/96/paint-roller.png',
  wall:    'https://img.icons8.com/fluency/96/brick-wall.png',
  roof:    'https://img.icons8.com/fluency/96/roofing.png',
  leak:    'https://img.icons8.com/fluency/96/rain.png',
  distance:'https://img.icons8.com/fluency/96/resize.png',
  stop:    'https://img.icons8.com/fluency/96/error.png',
  resume:  'https://img.icons8.com/fluency/96/redo.png',
};

// ============================================================================
// 質問送信
// step は 1〜10（距離まで）。11 は概算表示へ。
// ============================================================================
async function sendNextQuestion(userId, step, replyToken = null) {
  let message;

  if (step === 1) {
    message = {
      type: 'text',
      text: '工事物件の階数は？',
      quickReply: makeQuickReply([
        pb('1階建て', 'k=q1_floors&v=1階建て', ICONS.floors),
        pb('2階建て', 'k=q1_floors&v=2階建て', ICONS.floors),
        pb('3階建て', 'k=q1_floors&v=3階建て', ICONS.floors),
      ]),
    };
  } else if (step === 2) {
    const opts = ['1K','1DK','1LDK','2K','2DK','2LDK','3K','3DK','4K','4DK','4LDK'];
    message = {
      type: 'text',
      text: '物件の間取りは？',
      quickReply: makeQuickReply(opts.map((v) => pb(v, `k=q2_layout&v=${encodeURIComponent(v)}`, ICONS.layout))),
    };
  } else if (step === 3) {
    const opts = ['新築','〜10年','〜20年','〜30年','〜40年','〜50年','51年以上'];
    message = {
      type: 'text',
      text: '物件の築年数は？',
      quickReply: makeQuickReply(opts.map((v) => pb(v, `k=q3_age&v=${encodeURIComponent(v)}`, ICONS.age))),
    };
  } else if (step === 4) {
    const opts = ['ある','ない','わからない'];
    message = {
      type: 'text',
      text: '過去に塗装をした経歴は？',
      quickReply: makeQuickReply(opts.map((v) => pb(v, `k=q4_painted&v=${encodeURIComponent(v)}`, v==='ある'?ICONS.yes:ICONS.no))),
    };
  } else if (step === 5) {
    const opts = ['〜5年','5〜10年','10〜20年','20〜30年','わからない'];
    message = {
      type: 'text',
      text: '前回の塗装はいつ頃？',
      quickReply: makeQuickReply(opts.map((v) => pb(v, `k=q5_last&v=${encodeURIComponent(v)}`, ICONS.age))),
    };
  } else if (step === 6) {
    const opts = ['外壁塗装','屋根塗装','外壁塗装+屋根塗装'];
    message = {
      type: 'text',
      text: 'ご希望の工事内容は？',
      quickReply: makeQuickReply(opts.map((v) => pb(v, `k=q6_work&v=${encodeURIComponent(v)}`, ICONS.paint))),
    };
  } else if (step === 7) {
    // 外壁の種類
    const opts = ['モルタル','サイディング','タイル','ALC'];
    message = {
      type: 'text',
      text: '外壁の種類は？',
      quickReply: makeQuickReply(opts.map((v) => pb(v, `k=q7_wall&v=${encodeURIComponent(v)}`, ICONS.wall))),
    };
  } else if (step === 8) {
    // 屋根の種類
    const opts = ['瓦','スレート','ガルバリウム','トタン'];
    message = {
      type: 'text',
      text: '屋根の種類は？',
      quickReply: makeQuickReply(opts.map((v) => pb(v, `k=q8_roof&v=${encodeURIComponent(v)}`, ICONS.roof))),
    };
  } else if (step === 9) {
    const opts = ['雨の日に水滴が落ちる','天井にシミがある','ない'];
    message = {
      type: 'text',
      text: '雨漏りや漏水の症状はありますか？',
      quickReply: makeQuickReply(opts.map((v) => pb(v, `k=q9_leak&v=${encodeURIComponent(v)}`, ICONS.leak))),
    };
  } else if (step === 10) {
    const opts = ['30cm以下','50cm以下','70cm以下','70cm以上'];
    message = {
      type: 'text',
      text: '隣や裏の家との距離は？（周囲で一番近い距離）',
      quickReply: makeQuickReply(opts.map((v) => pb(v, `k=q10_dist&v=${encodeURIComponent(v)}`, ICONS.distance))),
    };
  } else {
    // step 11 は概算表示へ（ここでは何も送らない）
    return;
  }

  if (replyToken) {
    await replySafeOrPush(userId, replyToken, message, `ask step=${step}`);
  } else {
    try {
      await client.pushMessage(userId, message);
    } catch (e) {
      logLineApiError(e, `push ask step=${step}`);
    }
  }
}

// ============================================================================
// 概算金額の計算（ダミー係数：必要に応じて調整）
// ============================================================================
function calcRoughAmount(a) {
  const base = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装+屋根塗装': 900000 };
  const floors = { '1階建て': 1.0, '2階建て': 1.18, '3階建て': 1.36 };
  const layout = { '1K':0.85,'1DK':0.9,'1LDK':0.95,'2K':0.98,'2DK':1.0,'2LDK':1.05,'3K':1.08,'3DK':1.12,'4K':1.18,'4DK':1.22,'4LDK':1.28 };
  const age = { '新築':0.9,'〜10年':1.0,'〜20年':1.05,'〜30年':1.1,'〜40年':1.15,'〜50年':1.2,'51年以上':1.25 };
  const wall = { 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof = { '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak = { '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.08,'ない':1.0 };
  const dist = { '30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.08,'70cm以上':1.0 };

  let cost = base[a.q6_work] ?? 600000;
  cost *= floors[a.q1_floors] ?? 1.0;
  cost *= layout[a.q2_layout] ?? 1.0;
  cost *= age[a.q3_age] ?? 1.0;
  if (a.q6_work?.includes('外壁')) cost *= wall[a.q7_wall] ?? 1.0;
  if (a.q6_work?.includes('屋根')) cost *= roof[a.q8_roof] ?? 1.0;
  cost *= leak[a.q9_leak] ?? 1.0;
  cost *= dist[a.q10_dist] ?? 1.0;

  // 千円丸め
  return Math.round(cost / 1000) * 1000;
}

// ============================================================================
// 概算〜LIFF誘導を分割送信（reply は 1 件、残りは push）
// ============================================================================
async function sendEstimateSequence(userId, replyToken, state) {
  const a = state.answers || {};

  // 1) reply — 軽いテキスト 1 件のみ
  await replySafeOrPush(userId, replyToken, { type: 'text', text: 'ありがとうございます。概算を作成しました。' }, 'estimate-first');

  // 2) push — 回答の確認
  const check = [
    '【回答の確認】',
    `・階数: ${a.q1_floors ?? '—'} / 間取り: ${a.q2_layout ?? '—'} / 築年数: ${a.q3_age ?? '—'}`,
    `・過去塗装: ${a.q4_painted ?? '—'} / 前回から: ${a.q5_last ?? '—'}`,
    `・工事内容: ${a.q6_work ?? '—'} / 外壁: ${a.q7_wall ?? '—'} / 屋根: ${a.q8_roof ?? '—'}`,
    `・雨漏り: ${a.q9_leak ?? '—'} / 距離: ${a.q10_dist ?? '—'}`,
  ].join('\n');

  await sleep(250);
  try {
    await client.pushMessage(userId, { type: 'text', text: check });
  } catch (e) {
    logLineApiError(e, 'push check');
  }

  // 3) push — 概算 Flex + LIFF ボタン
  const amount = calcRoughAmount(a);
  const flex = {
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
          { type: 'text', text: `￥${amount.toLocaleString()}`, weight: 'bold', size: 'xl' },
          { type: 'text', text: '上記はご入力内容を元に算出した概算です。', wrap: true, size: 'sm', color: '#666' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '正式なお見積りが必要な方は続けてご入力ください。', wrap: true, size: 'sm' },
          {
            type: 'button',
            style: 'primary',
            action: { type: 'uri', label: '現地調査なしで見積を依頼', uri: `${BASE_URL}/liff/index.html` },
          },
        ],
      },
    },
  };

  await sleep(250);
  try {
    await client.pushMessage(userId, flex);
  } catch (e) {
    logLineApiError(e, 'push flex');
  }
}

// 停止確認カード
function buildStopConfirm() {
  return {
    type: 'flex',
    altText: '見積りを停止しますか？',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', contents: [
          { type: 'text', text: '見積りを停止しますか？', weight: 'bold', size: 'md' },
          { type: 'text', text: '停止すると通常のトークに戻ります。', size: 'sm', color: '#666' },
        ],
      },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'md', contents: [
          { type: 'button', style: 'secondary', action: { type: 'postback', label: 'いいえ', data: 'resume_estimate' } },
          { type: 'button', style: 'primary',   action: { type: 'postback', label: 'はい',   data: 'stop_estimate'   } },
        ],
      },
    },
  };
}

// ============================================================================
// イベントハンドラ
// ============================================================================
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // 友だち追加
  if (event.type === 'follow') {
    resetSession(userId);
    await client.replyMessage(event.replyToken, { type: 'text', text: '友だち追加ありがとうございます！「カンタン見積りを依頼」で開始できます。' });
    return;
  }

  // メッセージ
  if (event.type === 'message' && event.message.type === 'text') {
    const raw = (event.message.text || '').trim();
    const normalized = raw.replace(/\s/g, ''); // 全角/半角スペース除去
    const s = getSession(userId);

    // 強制開始トリガー
    if (normalized === 'カンタン見積りを依頼') {
      s.step = 1; s.answers = {}; s.interrupt = false;
      console.log('[BOT] TEXT カンタン見積りを依頼 STEP', s.step);
      await replySafeOrPush(userId, event.replyToken, { type: 'text', text: '見積もりを開始します。以下の質問にお答えください。' }, 'start');
      await sleep(150);
      await sendNextQuestion(userId, s.step); // push で安全送信
      return;
    }

    // リセット（必要なら有効化）
    if (raw === 'リセット') {
      resetSession(userId);
      await client.replyMessage(event.replyToken, { type: 'text', text: '状態をリセットしました。「カンタン見積りを依頼」で再開できます。' });
      return;
    }

    // 見積り進行中に雑談が来たら停止確認
    if (s.step >= 1 && s.step <= 10 && !s.interrupt) {
      s.interrupt = true;
      await replySafeOrPush(userId, event.replyToken, buildStopConfirm(), 'confirm-stop');
      return;
    }

    // 通常応答
    await client.replyMessage(event.replyToken, { type: 'text', text: '「カンタン見積りを依頼」で見積りを開始できます。' });
    return;
  }

  // Postback
  if (event.type === 'postback') {
    const data = parseKV(event.postback.data);
    const key = data.k;
    const value = data.v;
    const s = getSession(userId);
    const rt = event.replyToken;

    // 停止→はい
    if (key === 'stop_estimate' || event.postback.data === 'stop_estimate') {
      s.step = 0; s.interrupt = false;
      await replySafeOrPush(userId, rt, { type: 'text', text: '見積りを停止しました。ご用件を自由にお送りください。' }, 'stopped');
      return;
    }
    // 停止→いいえ（再開）
    if (key === 'resume_estimate' || event.postback.data === 'resume_estimate') {
      s.interrupt = false;
      await replySafeOrPush(userId, rt, { type: 'text', text: '見積りを続けます。' }, 'resume');
      await sleep(120);
      await sendNextQuestion(userId, s.step || 1);
      return;
    }

    // 回答を保存して分岐
    if (!key) return;
    s.answers[key] = value;
    console.log('[BOT] POSTBACK answer', key, value, 'STEP', s.step);

    // 次の step を決める（条件分岐つき）
    let next = s.step + 1;

    // 工事内容に応じて外壁/屋根の質問を出し分け
    if (key === 'q6_work') {
      if (value === '外壁塗装') next = 7; // 外壁だけ
      else if (value === '屋根塗装') next = 8; // 屋根だけ
      else next = 7; // 外壁＋屋根 → まず外壁(7)
    } else if (key === 'q7_wall') {
      // 外壁の後、屋根が必要なら 8 へ。不要なら 9 へ。
      if ((s.answers.q6_work || '').includes('屋根')) next = 8;
      else next = 9;
    } else if (key === 'q8_roof') {
      next = 9;
    } else if (key === 'q10_dist') {
      // ここで概算作成フローへ（reply は軽い 1 件のみ）
      s.step = 11;
      await sendEstimateSequence(userId, rt, s);
      return;
    }

    s.step = next;

    // 次の質問を出す
    await sendNextQuestion(userId, s.step, rt);
    return;
  }
}
