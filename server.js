// server.js
// ======================================================================
// 外装工事オンライン見積もり：Webhook + LIFF 静的配信
// 仕様：
//  - 起動キーワードは「カンタン見積りを依頼」のみ（完全一致・空白差異は吸収）
//  - 指示いただいた質問フローを全実装（条件分岐／写真アップロード）
//  - 各質問は画像カード(Flex カルーセル)／写真はQuickReply（カメラ/アルバム/スキップ）
//  - 最後に概算カード → LIFFへ「現地調査なしで見積を依頼」ボタンで遷移
//  - 質問中はメール/管理者通知は一切送らない
// Node: ESM（package.json の "type": "module" 前提）
// ======================================================================

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------
// ルートディレクトリ
// ------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------------------------------------
// 環境変数
// ------------------------------------------------------------
const {
  PORT = 10000,
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,

  // LIFF
  LIFF_ID,
  FRIEND_ADD_URL, // 任意（フォールバック）

  // （既存インフラ向け：ここでは未使用だが温存）
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GSHEET_SPREADSHEET_ID,
  GSHEET_SHEET_NAME,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  EMAIL_TO,
  EMAIL_WEBAPP_URL,
} = process.env;

// ------------------------------------------------------------
// LINE SDK
// ------------------------------------------------------------
const lineConfig = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};
const lineClient = new line.Client(lineConfig);

// ======================================================================
// [MEMO-1] 起動/制御ワード
//   - 起動語を変える→ START_TRIGGER を変更
//   - リセット語を変える→ RESET_TRIGGER を変更
// ======================================================================
const START_TRIGGER = 'カンタン見積りを依頼';
const RESET_TRIGGER = 'リセット';

// 前後空白/全角半角を吸収した完全一致で判定
const normalize = (s = '') => String(s).normalize('NFKC').trim();
const isStartTextStrict = (rawText) => normalize(rawText) === normalize(START_TRIGGER);
const isResetText = (rawText) => normalize(rawText) === normalize(RESET_TRIGGER);

// ======================================================================
// セッション（簡易：メモリ）
//   本番で永続化するなら DB へ差し替え（userId をキー）
// ======================================================================
/**
 * セッション構造：
 * {
 *   step: 'q_floors' | ... | 'done'
 *   ans: {
 *     floors, layout, age, painted, lastPaint, work, wallType, roofType,
 *     leak, distance,
 *     photos: { elevation, plan, section, front, right, left, back, garage, cracks }
 *   }
 * }
 */
const sessions = new Map(); // userId -> session

// ステップ一覧（条件分岐あり）
const STEPS = {
  FLOORS: 'q_floors',
  LAYOUT: 'q_layout',
  AGE: 'q_age',
  PAINTED: 'q_painted',
  LAST_PAINT: 'q_last_paint',
  WORK: 'q_work',
  WALLTYPE: 'q_wall_type', // 条件：外壁 or 両方
  ROOFTYPE: 'q_roof_type', // 条件：屋根 or 両方
  LEAK: 'q_leak',
  DISTANCE: 'q_distance',

  // 写真アップロード
  UP_ELEVATION: 'up_elevation',
  UP_PLAN: 'up_plan',
  UP_SECTION: 'up_section',
  UP_FRONT: 'up_front',
  UP_RIGHT: 'up_right',
  UP_LEFT: 'up_left',
  UP_BACK: 'up_back',
  UP_GARAGE: 'up_garage',
  UP_CRACKS: 'up_cracks',

  ESTIMATE: 'estimate',
  DONE: 'done',
};

// ======================================================================
// 質問の画像素材（差し替え可：任意のCDN）
// ======================================================================
const IMG = {
  FLOOR_1: 'https://placehold.co/600x400?text=1階建て',
  FLOOR_2: 'https://placehold.co/600x400?text=2階建て',
  FLOOR_3: 'https://placehold.co/600x400?text=3階建て',

  LAYOUT_1K: 'https://placehold.co/600x400?text=1K',
  LAYOUT_1DK: 'https://placehold.co/600x400?text=1DK',
  LAYOUT_1LDK: 'https://placehold.co/600x400?text=1LDK',
  LAYOUT_2K: 'https://placehold.co/600x400?text=2K',
  LAYOUT_2DK: 'https://placehold.co/600x400?text=2DK',
  LAYOUT_2LDK: 'https://placehold.co/600x400?text=2LDK',
  LAYOUT_3K: 'https://placehold.co/600x400?text=3K',
  LAYOUT_3DK: 'https://placehold.co/600x400?text=3DK',
  LAYOUT_3LDK: 'https://placehold.co/600x400?text=3LDK',
  LAYOUT_4K: 'https://placehold.co/600x400?text=4K',
  LAYOUT_4DK: 'https://placehold.co/600x400?text=4DK',
  LAYOUT_4LDK: 'https://placehold.co/600x400?text=4LDK',

  AGE_NEW: 'https://placehold.co/600x400?text=新築',
  AGE_10: 'https://placehold.co/600x400?text=〜10年',
  AGE_20: 'https://placehold.co/600x400?text=〜20年',
  AGE_30: 'https://placehold.co/600x400?text=〜30年',
  AGE_40: 'https://placehold.co/600x400?text=〜40年',
  AGE_50: 'https://placehold.co/600x400?text=〜50年',
  AGE_51: 'https://placehold.co/600x400?text=51年以上',

  PAINTED_YES: 'https://placehold.co/600x400?text=ある',
  PAINTED_NO: 'https://placehold.co/600x400?text=ない',
  PAINTED_UNKNOWN: 'https://placehold.co/600x400?text=わからない',

  LAST_5: 'https://placehold.co/600x400?text=〜5年',
  LAST_5_10: 'https://placehold.co/600x400?text=5〜10年',
  LAST_10_20: 'https://placehold.co/600x400?text=10〜20年',
  LAST_20_30: 'https://placehold.co/600x400?text=20〜30年',
  LAST_UNKNOWN: 'https://placehold.co/600x400?text=わからない',

  WORK_WALL: 'https://placehold.co/600x400?text=外壁塗装',
  WORK_ROOF: 'https://placehold.co/600x400?text=屋根塗装',
  WORK_BOTH: 'https://placehold.co/600x400?text=外壁+屋根',

  WALL_MORTAR: 'https://placehold.co/600x400?text=モルタル',
  WALL_SIDING: 'https://placehold.co/600x400?text=サイディング',
  WALL_TILE: 'https://placehold.co/600x400?text=タイル',
  WALL_ALC: 'https://placehold.co/600x400?text=ALC',

  ROOF_KAWARA: 'https://placehold.co/600x400?text=瓦',
  ROOF_SLATE: 'https://placehold.co/600x400?text=スレート',
  ROOF_GALVA: 'https://placehold.co/600x400?text=ガルバリウム',
  ROOF_TOTAN: 'https://placehold.co/600x400?text=トタン',

  LEAK_DROP: 'https://placehold.co/600x400?text=雨の日に水滴が落ちる',
  LEAK_STAIN: 'https://placehold.co/600x400?text=天井にシミがある',
  LEAK_NONE: 'https://placehold.co/600x400?text=ない',

  DIST_30: 'https://placehold.co/600x400?text=30cm以下',
  DIST_50: 'https://placehold.co/600x400?text=50cm以下',
  DIST_70: 'https://placehold.co/600x400?text=70cm以下',
  DIST_OVER70: 'https://placehold.co/600x400?text=70cm以上',
};

// ------------------------------------------------------------
// Flex: 画像カード（カルーセル）を生成（選択→postback）
//   options: [{label, value, image}...]
//   postback は "ANS|<key>|<value>" 形式
// ------------------------------------------------------------
function flexImageOptions(title, subtitle, key, options) {
  const bubbles = options.map((opt) => ({
    type: 'bubble',
    hero: {
      type: 'image',
      url: opt.image,
      size: 'full',
      aspectRatio: '3:2',
      aspectMode: 'cover',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: opt.label, weight: 'bold', size: 'md' },
        ...(subtitle ? [{ type: 'text', text: subtitle, size: 'xs', color: '#666', wrap: true }] : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#00B900',
          action: {
            type: 'postback',
            label: '選択する',
            data: `ANS|${key}|${encodeURIComponent(opt.value)}`,
          },
        },
      ],
    },
  }));

  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'carousel',
      contents: bubbles,
    },
  };
}

// ------------------------------------------------------------
// QuickReply（画像アップ用）
// ------------------------------------------------------------
function qrForUpload(nextData) {
  return {
    items: [
      { type: 'action', action: { type: 'camera', label: 'カメラを起動' } },
      { type: 'action', action: { type: 'cameraRoll', label: 'アルバムから' } },
      { type: 'action', action: { type: 'postback', label: 'スキップ', data: nextData || 'NEXT' } },
    ],
  };
}

// ------------------------------------------------------------
// セッション helper
// ------------------------------------------------------------
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: STEPS.FLOORS,
      ans: { photos: {} },
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.delete(userId);
  return getSession(userId);
}

// ------------------------------------------------------------
// 送信 helper
// ------------------------------------------------------------
async function reply(replyToken, messages) {
  const payload = Array.isArray(messages) ? messages : [messages];
  return lineClient.replyMessage(replyToken, payload);
}

// ------------------------------------------------------------
// [MEMO-2] 質問メッセージを構築して返す（送信はしない）
//  - どこからでも呼べるよう「メッセージオブジェクト」を返す
//  - startFlow() では開始文とこのメッセージを“1回の返信”で送る
// ------------------------------------------------------------
function buildQuestionMessage(step, ans) {
  switch (step) {
    case STEPS.FLOORS:
      return flexImageOptions('工事物件の階数は？', '', 'floors', [
        { label: '1階建て', value: '1階建て', image: IMG.FLOOR_1 },
        { label: '2階建て', value: '2階建て', image: IMG.FLOOR_2 },
        { label: '3階建て', value: '3階建て', image: IMG.FLOOR_3 },
      ]);

    case STEPS.LAYOUT:
      return flexImageOptions('物件の間取りは？', '', 'layout', [
        { label: '1K', value: '1K', image: IMG.LAYOUT_1K },
        { label: '1DK', value: '1DK', image: IMG.LAYOUT_1DK },
        { label: '1LDK', value: '1LDK', image: IMG.LAYOUT_1LDK },
        { label: '2K', value: '2K', image: IMG.LAYOUT_2K },
        { label: '2DK', value: '2DK', image: IMG.LAYOUT_2DK },
        { label: '2LDK', value: '2LDK', image: IMG.LAYOUT_2LDK },
        { label: '3K', value: '3K', image: IMG.LAYOUT_3K },
        { label: '3DK', value: '3DK', image: IMG.LAYOUT_3DK },
        { label: '3LDK', value: '3LDK', image: IMG.LAYOUT_3LDK },
        { label: '4K', value: '4K', image: IMG.LAYOUT_4K },
        { label: '4DK', value: '4DK', image: IMG.LAYOUT_4DK },
        { label: '4LDK', value: '4LDK', image: IMG.LAYOUT_4LDK },
      ]);

    case STEPS.AGE:
      return flexImageOptions('物件の築年数は？', '', 'age', [
        { label: '新築', value: '新築', image: IMG.AGE_NEW },
        { label: '〜10年', value: '〜10年', image: IMG.AGE_10 },
        { label: '〜20年', value: '〜20年', image: IMG.AGE_20 },
        { label: '〜30年', value: '〜30年', image: IMG.AGE_30 },
        { label: '〜40年', value: '〜40年', image: IMG.AGE_40 },
        { label: '〜50年', value: '〜50年', image: IMG.AGE_50 },
        { label: '51年以上', value: '51年以上', image: IMG.AGE_51 },
      ]);

    case STEPS.PAINTED:
      return flexImageOptions('過去に塗装をした経歴は？', '', 'painted', [
        { label: 'ある', value: 'ある', image: IMG.PAINTED_YES },
        { label: 'ない', value: 'ない', image: IMG.PAINTED_NO },
        { label: 'わからない', value: 'わからない', image: IMG.PAINTED_UNKNOWN },
      ]);

    case STEPS.LAST_PAINT:
      return flexImageOptions('前回の塗装はいつ頃？', '', 'lastPaint', [
        { label: '〜5年', value: '〜5年', image: IMG.LAST_5 },
        { label: '5〜10年', value: '5〜10年', image: IMG.LAST_5_10 },
        { label: '10〜20年', value: '10〜20年', image: IMG.LAST_10_20 },
        { label: '20〜30年', value: '20〜30年', image: IMG.LAST_20_30 },
        { label: 'わからない', value: 'わからない', image: IMG.LAST_UNKNOWN },
      ]);

      // 工事内容
    case STEPS.WORK:
      return flexImageOptions('ご希望の工事内容は？', '', 'work', [
        { label: '外壁塗装', value: '外壁塗装', image: IMG.WORK_WALL },
        { label: '屋根塗装', value: '屋根塗装', image: IMG.WORK_ROOF },
        { label: '外壁塗装+屋根塗装', value: '外壁塗装+屋根塗装', image: IMG.WORK_BOTH },
      ]);

    case STEPS.WALLTYPE:
      return flexImageOptions('外壁の種類は？', '', 'wallType', [
        { label: 'モルタル', value: 'モルタル', image: IMG.WALL_MORTAR },
        { label: 'サイディング', value: 'サイディング', image: IMG.WALL_SIDING },
        { label: 'タイル', value: 'タイル', image: IMG.WALL_TILE },
        { label: 'ALC', value: 'ALC', image: IMG.WALL_ALC },
      ]);

    case STEPS.ROOFTYPE:
      return flexImageOptions('屋根の種類は？', '', 'roofType', [
        { label: '瓦', value: '瓦', image: IMG.ROOF_KAWARA },
        { label: 'スレート', value: 'スレート', image: IMG.ROOF_SLATE },
        { label: 'ガルバリウム', value: 'ガルバリウム', image: IMG.ROOF_GALVA },
        { label: 'トタン', value: 'トタン', image: IMG.ROOF_TOTAN },
      ]);

    case STEPS.LEAK:
      return flexImageOptions('雨漏りや漏水の症状はありますか？', '', 'leak', [
        { label: '雨の日に水滴が落ちる', value: '雨の日に水滴が落ちる', image: IMG.LEAK_DROP },
        { label: '天井にシミがある', value: '天井にシミがある', image: IMG.LEAK_STAIN },
        { label: 'ない', value: 'ない', image: IMG.LEAK_NONE },
      ]);

    case STEPS.DISTANCE:
      return flexImageOptions(
        '隣や裏の家との距離は？',
        '周囲で一番近い距離の数値をお答えください。',
        'distance',
        [
          { label: '30cm以下', value: '30cm以下', image: IMG.DIST_30 },
          { label: '50cm以下', value: '50cm以下', image: IMG.DIST_50 },
          { label: '70cm以下', value: '70cm以下', image: IMG.DIST_70 },
          { label: '70cm以上', value: '70cm以上', image: IMG.DIST_OVER70 },
        ]
      );

    // ===== 写真アップロード（QuickReply） =====
    case STEPS.UP_ELEVATION:
      return { type: 'text', text: '立面図をアップロードしてください。', quickReply: qrForUpload('NEXT') };
    case STEPS.UP_PLAN:
      return { type: 'text', text: '平面図をアップロードしてください。', quickReply: qrForUpload('NEXT') };
    case STEPS.UP_SECTION:
      return { type: 'text', text: '断面図をアップロードしてください。', quickReply: qrForUpload('NEXT') };
    case STEPS.UP_FRONT:
      return { type: 'text', text: '正面の写真をアップロードしてください。\n※周囲の地面が見える写真でお願いします。', quickReply: qrForUpload('NEXT') };
    case STEPS.UP_RIGHT:
      return { type: 'text', text: '右側の写真をアップロードしてください。\n※周囲の地面が見える写真でお願いします。', quickReply: qrForUpload('NEXT') };
    case STEPS.UP_LEFT:
      return { type: 'text', text: '左側の写真をアップロードしてください。\n※周囲の地面が見える写真でお願いします。', quickReply: qrForUpload('NEXT') };
    case STEPS.UP_BACK:
      return { type: 'text', text: '後ろ側の写真をアップロードしてください。\n※周囲の地面が見える写真でお願いします。', quickReply: qrForUpload('NEXT') };
    case STEPS.UP_GARAGE:
      return { type: 'text', text: '車庫の位置がわかる写真をアップロードしてください。', quickReply: qrForUpload('NEXT') };
    case STEPS.UP_CRACKS:
      return { type: 'text', text: '外壁や屋根にヒビ/割れがある場合は写真をアップしてください。（なければスキップ）', quickReply: qrForUpload('NEXT') };

    case STEPS.ESTIMATE: {
      const price = computeEstimate(ans);
      return buildEstimateCard(price);
    }

    default:
      return { type: 'text', text: 'ありがとうございました。' };
  }
}

// ------------------------------------------------------------
// 現在の質問を送る（1件返信）
// ------------------------------------------------------------
async function sendCurrentQuestion(userId, replyToken) {
  const s = getSession(userId);
  const msg = buildQuestionMessage(s.step, s.ans);
  return reply(replyToken, msg);
}

// ------------------------------------------------------------
// ステップ遷移（回答後）
// ------------------------------------------------------------
function goNext(userId) {
  const s = getSession(userId);
  const a = s.ans;

  switch (s.step) {
    case STEPS.FLOORS: s.step = STEPS.LAYOUT; break;
    case STEPS.LAYOUT: s.step = STEPS.AGE; break;
    case STEPS.AGE: s.step = STEPS.PAINTED; break;
    case STEPS.PAINTED: s.step = STEPS.LAST_PAINT; break;
    case STEPS.LAST_PAINT: s.step = STEPS.WORK; break;

    case STEPS.WORK:
      if (a.work === '外壁塗装') s.step = STEPS.WALLTYPE;
      else if (a.work === '屋根塗装') s.step = STEPS.ROOFTYPE;
      else s.step = STEPS.WALLTYPE; // 両方→外壁から
      break;

    case STEPS.WALLTYPE:
      if (a.work === '外壁塗装+屋根塗装') s.step = STEPS.ROOFTYPE;
      else s.step = STEPS.LEAK;
      break;

    case STEPS.ROOFTYPE: s.step = STEPS.LEAK; break;
    case STEPS.LEAK: s.step = STEPS.DISTANCE; break;

    case STEPS.DISTANCE: s.step = STEPS.UP_ELEVATION; break;
    case STEPS.UP_ELEVATION: s.step = STEPS.UP_PLAN; break;
    case STEPS.UP_PLAN: s.step = STEPS.UP_SECTION; break;
    case STEPS.UP_SECTION: s.step = STEPS.UP_FRONT; break;
    case STEPS.UP_FRONT: s.step = STEPS.UP_RIGHT; break;
    case STEPS.UP_RIGHT: s.step = STEPS.UP_LEFT; break;
    case STEPS.UP_LEFT: s.step = STEPS.UP_BACK; break;
    case STEPS.UP_BACK: s.step = STEPS.UP_GARAGE; break;
    case STEPS.UP_GARAGE: s.step = STEPS.UP_CRACKS; break;
    case STEPS.UP_CRACKS: s.step = STEPS.ESTIMATE; break;

    default: s.step = STEPS.DONE;
  }
}

// ------------------------------------------------------------
// 概算見積の計算（必要なら係数調整）
// ------------------------------------------------------------
function computeEstimate(a) {
  let base = 600000;

  const floorK = { '1階建て': 1.0, '2階建て': 1.25, '3階建て': 1.5 };
  base *= floorK[a.floors] || 1.0;

  const workK = { '外壁塗装': 1.0, '屋根塗装': 0.7, '外壁塗装+屋根塗装': 1.6 };
  base *= workK[a.work] || 1.0;

  const ageK = { '新築': 0.9, '〜10年': 1.0, '〜20年': 1.05, '〜30年': 1.1, '〜40年': 1.15, '〜50年': 1.2, '51年以上': 1.25 };
  base *= ageK[a.age] || 1.0;

  const distK = { '30cm以下': 1.2, '50cm以下': 1.1, '70cm以下': 1.05, '70cm以上': 1.0 };
  base *= distK[a.distance] || 1.0;

  const leakK = { '雨の日に水滴が落ちる': 1.2, '天井にシミがある': 1.1, 'ない': 1.0 };
  base *= leakK[a.leak] || 1.0;

  return Math.round(base / 10000) * 10000;
}

// ------------------------------------------------------------
// 概算カード（Flex）→ LIFF 遷移ボタン
// ------------------------------------------------------------
function buildEstimateCard(price) {
  const priceStr = `¥ ${price.toLocaleString()}`;
  const liffUrl = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : (FRIEND_ADD_URL || 'https://line.me');

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
          { type: 'text', text: '詳しい見積もりをご希望の方へ', weight: 'bold', size: 'lg' },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#F5F5F7',
            cornerRadius: 'md',
            paddingAll: '12px',
            contents: [
              { type: 'text', text: '見積り金額', weight: 'bold', size: 'md' },
              { type: 'text', text: priceStr, weight: 'bold', size: 'xxl' },
              { type: 'text', size: 'xs', color: '#666', wrap: true, text: '上記はご入力内容を元に算出した概算金額です。' },
            ],
          },
          { type: 'text', size: 'sm', wrap: true, text: '正式なお見積もりが必要な方は続けてご入力をお願いします。' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#00B900',
            action: { type: 'uri', label: '現地調査なしで見積を依頼', uri: liffUrl },
          },
        ],
      },
    },
  };
}

// ======================================================================
// Express ルーティング
// ======================================================================
const app = express();

// Webhook
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

// Health
app.get('/health', (_, res) => res.type('text/plain').send('ok'));

// LIFF 静的配信
app.use('/liff', express.static(path.join(__dirname, 'liff')));

// LIFF 用 env.js（クライアントから window.__LIFF_ENV__ で参照）
app.get('/liff/env.js', (_, res) => {
  const js = `
    window.__LIFF_ENV__ = {
      LIFF_ID: ${JSON.stringify(LIFF_ID || '')},
      FRIEND_ADD_URL: ${JSON.stringify(FRIEND_ADD_URL || '')}
    };
  `.trim();
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.send(js);
});

// ======================================================================
// Webhook イベントハンドラ
// ======================================================================
async function handleEvent(event) {
  // ---------- テキスト ----------
  if (event.type === 'message' && event.message?.type === 'text') {
    const text = event.message.text || '';
    const userId = event.source?.userId;
    if (!userId) return null;

    // リセット（任意）
    if (isResetText(text)) {
      resetSession(userId);
      const s = getSession(userId);
      const q = buildQuestionMessage(s.step, s.ans);
      return reply(event.replyToken, [
        { type: 'text', text: '回答をリセットしました。最初の質問から再開します。' },
        q,
      ]);
    }

    // 起動キーワードのみで開始（会話中の「見積もり」等には反応しない）
    if (isStartTextStrict(text)) {
      return startFlow(event);
    }
    return null;
  }

  // ---------- 画像 ----------
  if (event.type === 'message' && event.message?.type === 'image') {
    const userId = event.source?.userId;
    if (!userId) return null;
    const s = getSession(userId);

    // 画像を受け付けるステップのみ保存（messageId を控える）
    const photoKeysByStep = {
      [STEPS.UP_ELEVATION]: 'elevation',
      [STEPS.UP_PLAN]: 'plan',
      [STEPS.UP_SECTION]: 'section',
      [STEPS.UP_FRONT]: 'front',
      [STEPS.UP_RIGHT]: 'right',
      [STEPS.UP_LEFT]: 'left',
      [STEPS.UP_BACK]: 'back',
      [STEPS.UP_GARAGE]: 'garage',
      [STEPS.UP_CRACKS]: 'cracks',
    };

    const key = photoKeysByStep[s.step];
    if (key) {
      s.ans.photos[key] = { messageId: event.message.id };
      goNext(userId);
      return sendCurrentQuestion(userId, event.replyToken);
    }
    return null;
  }

  // ---------- ポストバック ----------
  if (event.type === 'postback') {
    const data = event.postback?.data || '';
    const userId = event.source?.userId;
    if (!userId) return null;

    if (data === 'NEXT') {
      goNext(userId);
      return sendCurrentQuestion(userId, event.replyToken);
    }

    if (data.startsWith('ANS|')) {
      const [, key, encValue] = data.split('|');
      const value = decodeURIComponent(encValue || '');
      const s = getSession(userId);
      s.ans[key] = value;
      goNext(userId);
      return sendCurrentQuestion(userId, event.replyToken);
    }

    return null;
  }

  return null;
}

// スタート：開始文 + 最初の質問を“1回の返信”で返す
async function startFlow(event) {
  const userId = event.source?.userId;
  if (!userId) return null;

  // 新規/再開とも最初からに統一
  resetSession(userId);
  const s = getSession(userId);
  const firstQuestion = buildQuestionMessage(s.step, s.ans);

  return reply(event.replyToken, [
    { type: 'text', text: '見積もりを開始します。以下の質問にお答えください。' },
    firstQuestion, // ★ 同一replyTokenでまとめて返信
  ]);
}

// ======================================================================
// 起動
// ======================================================================
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
  console.log('GET /health       -> ok');
  console.log('GET /liff/index.html');
  console.log('GET /liff/env.js  -> LIFF_IDなどをJSで返却');
});

// ======================================================================
// 【MEMO：パーツ別の役割と改修ポイント】
// ----------------------------------------------------------------------
// [MEMO-1] 起動/制御ワード
//   - 起動語を変える: START_TRIGGER
//   - リセット語を変える: RESET_TRIGGER
//   - “会話中の見積もり”に反応させたくない要件を満たすため、完全一致判定。
//     緩めたい場合は isStartTextStrict()の実装を変更。
// ----------------------------------------------------------------------
// [MEMO-2] buildQuestionMessage()
//   - “質問カード”を作るだけ。ここを編集すれば文言/画像/選択肢を変更可能。
//   - 写真ステップは Quick Reply を返す。カメラ/アルバム/スキップを同梱。
//   - 新しい質問を足す場合：
//       1) STEPS に列挙を追加
//       2) buildQuestionMessage に case を追加
//       3) goNext の遷移にも追加
// ----------------------------------------------------------------------
// goNext()
//   - 質問の遷移順/条件分岐を管理。変更はここ。
// ----------------------------------------------------------------------
// computeEstimate()
//   - 概算のロジック。係数の調整はここ。
// ----------------------------------------------------------------------
// buildEstimateCard()
//   - 概算カードの文言や LIFF 遷移のURLを定義。
//   - LIFF の ID は env の LIFF_ID を使用（未設定時は FRIEND_ADD_URL にフォールバック）。
// ----------------------------------------------------------------------
// handleEvent()
//   - テキスト：リセット/起動。起動は完全一致のみ反応。
//   - 画像：該当ステップだけ messageId を保持→次の質問へ。
//   - ポストバック：ANS|key|value と NEXT を処理→次の質問へ。
// ----------------------------------------------------------------------
// startFlow()
//   - ここが“開始メッセージ→最初の質問”を【1回の reply】で送るポイント。
//   - 同じ replyToken に2回返信すると沈黙するので注意（今回の修正点）。
// ======================================================================
