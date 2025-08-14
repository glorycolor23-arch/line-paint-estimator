// server.js
// ======================================================================
// 外装工事オンライン見積もり（LINE Bot）完全版
//  - 起動語は「カンタン見積りを依頼」完全一致のみ（不可視文字/全角半角を吸収）
//  - 全質問を画像カード（Flex）で提示（10バブル超は自動分割）
//  - 条件分岐（外壁/屋根/両方）
//  - 写真は Quick Reply（カメラ/アルバム/スキップ）。画像受信時は必ず「次へ」も同時返信。
//  - 最終は概算見積りカード＋LIFF起動ボタン
//  - メモリセッション（本番はDB/Redisへ）
//  - 既知の落とし穴回避：express.json()は使わない（署名検証に干渉しないため）
//
// Node: >=18, package.json は既存のままで動作
// ======================================================================

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ────────────────────────────────────────────────────────────
// 基本設定・クライアント
// ────────────────────────────────────────────────────────────
const {
  PORT = 10000,
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  LIFF_ID,           // 例: 2007914959-XXXXXXXX
  FRIEND_ADD_URL,    // 任意：LIFF未使用時の代替誘導URL
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error('[ERROR] CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET が未設定');
  process.exit(1);
}

const lineClient = new line.Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });
const middlewareConfig = { channelSecret: CHANNEL_SECRET };

const app = express();

// Health
app.get('/health', (_, res) => res.status(200).send('ok'));

// （任意）/liff の静的配信（存在しなくてもOK）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/liff', express.static(path.join(__dirname, 'public', 'liff')));

// Webhook（※ express.json() は使わないこと）
app.post('/webhook', line.middleware(middlewareConfig), async (req, res) => {
  try {
    const events = req.body?.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e?.message || e);
    res.status(500).send('Error');
  }
});

app.listen(PORT, () => console.log(`LINE bot listening on ${PORT}`));

// ────────────────────────────────────────────────────────────
// [MEMO] 起動語（ここを書き換えれば変更可能）
// ────────────────────────────────────────────────────────────
const START_TRIGGER = 'カンタン見積りを依頼';

// 目に見えない不可視文字も除去して厳密一致させる
function normalizeStrict(s = '') {
  return String(s)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // ZWSP 等
    .trim();
}
function isExactStart(text = '') {
  return normalizeStrict(text) === normalizeStrict(START_TRIGGER);
}

// ────────────────────────────────────────────────────────────
// セッション（メモリ）
// ────────────────────────────────────────────────────────────
/**
 * step … 進行中のステップ
 * ans  … 回答オブジェクト
 *   floors, layout, age, painted, lastPaint, work, wallType, roofType, leak, distance
 *   photos: { elevation, plan, section, front, right, left, back, garage, cracks } ※URL保存は別レイヤ
 */
const sessions = new Map(); // userId -> { step, ans }

const STEPS = {
  FLOORS: 'q_floors',
  LAYOUT: 'q_layout',
  AGE: 'q_age',
  PAINTED: 'q_painted',
  LAST_PAINT: 'q_last_paint',
  WORK: 'q_work',
  WALLTYPE: 'q_wall_type',
  ROOFTYPE: 'q_roof_type',
  LEAK: 'q_leak',
  DISTANCE: 'q_distance',
  // 写真
  UP_ELEVATION: 'up_elevation',
  UP_PLAN: 'up_plan',
  UP_SECTION: 'up_section',
  UP_FRONT: 'up_front',
  UP_RIGHT: 'up_right',
  UP_LEFT: 'up_left',
  UP_BACK: 'up_back',
  UP_GARAGE: 'up_garage',
  UP_CRACKS: 'up_cracks',
  // 終了
  ESTIMATE: 'estimate',
  DONE: 'done',
};

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

// ────────────────────────────────────────────────────────────
// ダミー画像（ボタンの背景）
// ────────────────────────────────────────────────────────────
const IMG = {
  FLOOR_1: 'https://placehold.co/800x530/0B8F3F/FFFFFF?text=1%E9%9A%8E%E5%BB%BA%E3%81%A6',
  FLOOR_2: 'https://placehold.co/800x530/0B8F3F/FFFFFF?text=2%E9%9A%8E%E5%BB%BA%E3%81%A6',
  FLOOR_3: 'https://placehold.co/800x530/0B8F3F/FFFFFF?text=3%E9%9A%8E%E5%BB%BA%E3%81%A6',

  LAYOUT_1K: 'https://placehold.co/800x530/2266AA/FFFFFF?text=1K',
  LAYOUT_1DK: 'https://placehold.co/800x530/2266AA/FFFFFF?text=1DK',
  LAYOUT_1LDK: 'https://placehold.co/800x530/2266AA/FFFFFF?text=1LDK',
  LAYOUT_2K: 'https://placehold.co/800x530/2266AA/FFFFFF?text=2K',
  LAYOUT_2DK: 'https://placehold.co/800x530/2266AA/FFFFFF?text=2DK',
  LAYOUT_2LDK: 'https://placehold.co/800x530/2266AA/FFFFFF?text=2LDK',
  LAYOUT_3K: 'https://placehold.co/800x530/2266AA/FFFFFF?text=3K',
  LAYOUT_3DK: 'https://placehold.co/800x530/2266AA/FFFFFF?text=3DK',
  LAYOUT_3LDK: 'https://placehold.co/800x530/2266AA/FFFFFF?text=3LDK',
  LAYOUT_4K: 'https://placehold.co/800x530/2266AA/FFFFFF?text=4K',
  LAYOUT_4DK: 'https://placehold.co/800x530/2266AA/FFFFFF?text=4DK',
  LAYOUT_4LDK: 'https://placehold.co/800x530/2266AA/FFFFFF?text=4LDK',

  AGE_NEW: 'https://placehold.co/800x530/7A4EC2/FFFFFF?text=%E6%96%B0%E7%AF%89',
  AGE_10: 'https://placehold.co/800x530/7A4EC2/FFFFFF?text=%E3%80%9C10%E5%B9%B4',
  AGE_20: 'https://placehold.co/800x530/7A4EC2/FFFFFF?text=%E3%80%9C20%E5%B9%B4',
  AGE_30: 'https://placehold.co/800x530/7A4EC2/FFFFFF?text=%E3%80%9C30%E5%B9%B4',
  AGE_40: 'https://placehold.co/800x530/7A4EC2/FFFFFF?text=%E3%80%9C40%E5%B9%B4',
  AGE_50: 'https://placehold.co/800x530/7A4EC2/FFFFFF?text=%E3%80%9C50%E5%B9%B4',
  AGE_51: 'https://placehold.co/800x530/7A4EC2/FFFFFF?text=51%E5%B9%B4%E4%BB%A5%E4%B8%8A',

  PAINTED_YES: 'https://placehold.co/800x530/FF8C00/FFFFFF?text=%E3%81%82%E3%82%8B',
  PAINTED_NO: 'https://placehold.co/800x530/FF8C00/FFFFFF?text=%E3%81%AA%E3%81%84',
  PAINTED_UNKNOWN: 'https://placehold.co/800x530/FF8C00/FFFFFF?text=%E3%82%8F%E3%81%8B%E3%82%89%E3%81%AA%E3%81%84',

  LAST_5: 'https://placehold.co/800x530/FFBD2F/333?text=%E3%80%9C5%E5%B9%B4',
  LAST_5_10: 'https://placehold.co/800x530/FFBD2F/333?text=5%E3%80%9C10%E5%B9%B4',
  LAST_10_20: 'https://placehold.co/800x530/FFBD2F/333?text=10%E3%80%9C20%E5%B9%B4',
  LAST_20_30: 'https://placehold.co/800x530/FFBD2F/333?text=20%E3%80%9C30%E5%B9%B4',
  LAST_UNKNOWN: 'https://placehold.co/800x530/FFBD2F/333?text=%E3%82%8F%E3%81%8B%E3%82%89%E3%81%AA%E3%81%84',

  WORK_WALL: 'https://placehold.co/800x530/00B8A9/FFFFFF?text=%E5%A4%96%E5%A3%81%E5%A1%97%E8%A3%85',
  WORK_ROOF: 'https://placehold.co/800x530/00B8A9/FFFFFF?text=%E5%B1%8B%E6%A0%B9%E5%A1%97%E8%A3%85',
  WORK_BOTH: 'https://placehold.co/800x530/00B8A9/FFFFFF?text=%E5%A4%96%E5%A3%81%2B%E5%B1%8B%E6%A0%B9',

  WALL_MORTAR: 'https://placehold.co/800x530/DB2B39/FFFFFF?text=%E3%83%A2%E3%83%AB%E3%82%BF%E3%83%AB',
  WALL_SIDING: 'https://placehold.co/800x530/DB2B39/FFFFFF?text=%E3%82%B5%E3%82%A4%E3%83%87%E3%82%A3%E3%83%B3%E3%82%B0',
  WALL_TILE: 'https://placehold.co/800x530/DB2B39/FFFFFF?text=%E3%82%BF%E3%82%A4%E3%83%AB',
  WALL_ALC: 'https://placehold.co/800x530/DB2B39/FFFFFF?text=ALC',

  ROOF_KAWARA: 'https://placehold.co/800x530/118AB2/FFFFFF?text=%E7%93%A6',
  ROOF_SLATE: 'https://placehold.co/800x530/118AB2/FFFFFF?text=%E3%82%B9%E3%83%AC%E3%83%BC%E3%83%88',
  ROOF_GALVA: 'https://placehold.co/800x530/118AB2/FFFFFF?text=%E3%82%AC%E3%83%AB%E3%83%90%E3%83%AA%E3%82%A6%E3%83%A0',
  ROOF_TOTAN: 'https://placehold.co/800x530/118AB2/FFFFFF?text=%E3%83%88%E3%82%BF%E3%83%B3',

  LEAK_DROP: 'https://placehold.co/800x530/2D3142/FFFFFF?text=%E6%B0%B4%E6%BB%B4%E3%81%8C%E8%90%BD%E3%81%A1%E3%82%8B',
  LEAK_STAIN: 'https://placehold.co/800x530/2D3142/FFFFFF?text=%E5%A4%A9%E4%BA%95%E3%81%AB%E3%82%B7%E3%83%9F',
  LEAK_NONE: 'https://placehold.co/800x530/2D3142/FFFFFF?text=%E3%81%AA%E3%81%84',

  DIST_30: 'https://placehold.co/800x530/3A8EBA/FFFFFF?text=30cm%E4%BB%A5%E4%B8%8B',
  DIST_50: 'https://placehold.co/800x530/3A8EBA/FFFFFF?text=50cm%E4%BB%A5%E4%B8%8B',
  DIST_70: 'https://placehold.co/800x530/3A8EBA/FFFFFF?text=70cm%E4%BB%A5%E4%B8%8B',
  DIST_OVER70: 'https://placehold.co/800x530/3A8EBA/FFFFFF?text=70cm%E4%BB%A5%E4%B8%8A',
};

// ────────────────────────────────────────────────────────────
// Flex生成（10バブル自動分割）
// ────────────────────────────────────────────────────────────
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function flexImageOptions(title, subtitle, key, options) {
  const bubbles = options.map(opt => ({
    type: 'bubble',
    hero: {
      type: 'image',
      url: opt.image,
      size: 'full',
      aspectRatio: '16:10',
      aspectMode: 'cover',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'sm', color: '#666', wrap: true },
        ...(subtitle ? [{ type: 'text', text: subtitle, size: 'xs', color: '#888', wrap: true }] : []),
        { type: 'text', text: opt.label, weight: 'bold', size: 'md' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        style: 'primary',
        color: '#00B900',
        action: { type: 'postback', label: '選択する', data: `ANS|${key}|${encodeURIComponent(opt.value)}` }
      }]
    }
  }));
  return chunk(bubbles, 10).map(pg => ({
    type: 'flex',
    altText: title,
    contents: { type: 'carousel', contents: pg }
  }));
}

// ────────────────────────────────────────────────────────────
// 写真アップロード誘導（Quick Reply）
// ────────────────────────────────────────────────────────────
const UPLOAD_ORDER = [
  STEPS.UP_ELEVATION, // 立面図
  STEPS.UP_PLAN,      // 平面図
  STEPS.UP_SECTION,   // 断面図
  STEPS.UP_FRONT,     // 正面
  STEPS.UP_RIGHT,     // 右側
  STEPS.UP_LEFT,      // 左側
  STEPS.UP_BACK,      // 後ろ側
  STEPS.UP_GARAGE,    // 車庫
  STEPS.UP_CRACKS,    // ヒビ/割れ（任意）
];
const UPLOAD_LABELS = {
  [STEPS.UP_ELEVATION]: '立面図',
  [STEPS.UP_PLAN]: '平面図',
  [STEPS.UP_SECTION]: '断面図',
  [STEPS.UP_FRONT]: '正面から撮影（周囲の地面が見えるように）',
  [STEPS.UP_RIGHT]: '右側から撮影（周囲の地面が見えるように）',
  [STEPS.UP_LEFT]: '左側から撮影（周囲の地面が見えるように）',
  [STEPS.UP_BACK]: '後ろ側から撮影（周囲の地面が見えるように）',
  [STEPS.UP_GARAGE]: '車庫の位置がわかる写真',
  [STEPS.UP_CRACKS]: '外壁や屋根のヒビ/割れ（任意・なければスキップ）',
};
function isUploadStep(step) { return UPLOAD_ORDER.includes(step); }
function firstUploadStep() { return UPLOAD_ORDER[0]; }
function nextUploadStep(cur) {
  const i = UPLOAD_ORDER.indexOf(cur);
  return (i >= 0 && i < UPLOAD_ORDER.length - 1) ? UPLOAD_ORDER[i + 1] : null;
}
function buildUploadPrompt(step) {
  const label = UPLOAD_LABELS[step] || '写真';
  return {
    type: 'text',
    text: `写真アップロード\n「${label}」を送ってください。`,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'camera', label: 'カメラを起動' } },
        { type: 'action', action: { type: 'cameraRoll', label: 'アルバムから' } },
        { type: 'action', action: { type: 'postback', label: 'スキップ', data: 'NEXT' } },
      ]
    }
  };
}

// ────────────────────────────────────────────────────────────
/** 質問カード（Flex） */
// ────────────────────────────────────────────────────────────
function buildQuestionMessages(step) {
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
      return flexImageOptions('隣や裏の家との距離は？', '周囲で一番近い距離の数値をお答えください。', 'distance', [
        { label: '30cm以下', value: '30cm以下', image: IMG.DIST_30 },
        { label: '50cm以下', value: '50cm以下', image: IMG.DIST_50 },
        { label: '70cm以下', value: '70cm以下', image: IMG.DIST_70 },
        { label: '70cm以上', value: '70cm以上', image: IMG.DIST_OVER70 },
      ]);
    default:
      return [{ type: 'text', text: '次の質問を用意しています…' }];
  }
}

// ────────────────────────────────────────────────────────────
// 遷移ロジック
// ────────────────────────────────────────────────────────────
function nextStepAfterAnswer(key, s) {
  const a = s.ans;
  switch (key) {
    case 'floors':    return STEPS.LAYOUT;
    case 'layout':    return STEPS.AGE;
    case 'age':       return STEPS.PAINTED;
    case 'painted':   return a.painted === 'ある' ? STEPS.LAST_PAINT : STEPS.WORK;
    case 'lastPaint': return STEPS.WORK;

    case 'work':
      if (a.work === '外壁塗装') return STEPS.WALLTYPE;
      if (a.work === '屋根塗装') return STEPS.ROOFTYPE;
      return STEPS.WALLTYPE; // 両方 → 外壁→屋根

    case 'wallType':
      return (a.work === '外壁塗装+屋根塗装') ? STEPS.ROOFTYPE : STEPS.LEAK;

    case 'roofType':
      return STEPS.LEAK;

    case 'leak':
      return STEPS.DISTANCE;

    case 'distance':
      return firstUploadStep();

    default:
      return s.step;
  }
}

// ────────────────────────────────────────────────────────────
// 概算（調整可能な係数）
// ────────────────────────────────────────────────────────────
function estimateCost(ans) {
  const base = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装+屋根塗装': 980000 };
  const floor = { '1階建て': 1.0, '2階建て': 1.18, '3階建て': 1.36 };
  const layout = { '1K':0.9,'1DK':0.95,'1LDK':1.0,'2K':1.02,'2DK':1.05,'2LDK':1.08,'3K':1.12,'3DK':1.15,'3LDK':1.18,'4K':1.2,'4DK':1.23,'4LDK':1.26 };
  const age = { '新築':0.9,'〜10年':1.0,'〜20年':1.05,'〜30年':1.1,'〜40年':1.15,'〜50年':1.2,'51年以上':1.25 };
  const wall = { 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof = { '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak = { '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.08,'ない':1.0 };
  const dist = { '30cm以下':1.2,'50cm以下':1.12,'70cm以下':1.06,'70cm以上':1.0 };
  const last = { '〜5年':0.95,'5〜10年':1.0,'10〜20年':1.05,'20〜30年':1.12,'わからない':1.0 };

  let cost = base[ans.work] || 600000;
  cost *= floor[ans.floors] || 1.0;
  cost *= layout[ans.layout] || 1.0;
  cost *= age[ans.age] || 1.0;
  if (ans.work === '外壁塗装' || ans.work === '外壁塗装+屋根塗装') cost *= (wall[ans.wallType] || 1.0);
  if (ans.work === '屋根塗装' || ans.work === '外壁塗装+屋根塗装') cost *= (roof[ans.roofType] || 1.0);
  cost *= leak[ans.leak] || 1.0;
  cost *= dist[ans.distance] || 1.0;
  if (ans.painted === 'ある') cost *= (last[ans.lastPaint] || 1.0);

  return Math.round(cost / 1000) * 1000;
}
const yen = (n) => n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

// 概算カード + LIFFボタン
function buildEstimateFlex(ans) {
  const total = estimateCost(ans);
  const liffUrl = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : (FRIEND_ADD_URL || 'https://line.me/');
  return {
    type: 'flex',
    altText: '概算見積もり',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '見積り金額', weight: 'bold', size: 'lg' },
          { type: 'text', text: `${yen(total)}`, weight: 'bold', size: 'xxl' },
          { type: 'text', text: '上記はご入力内容をもとに算出した概算金額です。', size: 'sm', color: '#666', wrap: true },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '正確なお見積もりが必要な方は続けてご入力ください。', size: 'sm', color: '#444', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'button', style: 'primary', color: '#00B900', action: { type: 'uri', label: '現地調査なしで見積を依頼', uri: liffUrl } }
        ]
      }
    }
  };
}

// 送信ユーティリティ
function replyMessage(replyToken, msgs) {
  const arr = Array.isArray(msgs) ? msgs : [msgs];
  return lineClient.replyMessage(replyToken, arr);
}

// ────────────────────────────────────────────────────────────
// イベントハンドラ本体
// ────────────────────────────────────────────────────────────
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // 友だち追加
  if (event.type === 'follow') {
    resetSession(userId);
    return replyMessage(event.replyToken, {
      type: 'text',
      text: `ご利用ありがとうございます。\n「${START_TRIGGER}」と送ると、かんたん見積もりを開始します。`
    });
  }

  // メッセージ
  if (event.type === 'message') {
    const msg = event.message;

    // テキスト
    if (msg.type === 'text') {
      const text = normalizeStrict(msg.text);

      // 起動（完全一致）
      if (isExactStart(text)) {
        const s = resetSession(userId);
        s.step = STEPS.FLOORS;
        const qs = buildQuestionMessages(STEPS.FLOORS);
        return replyMessage(event.replyToken, [
          { type: 'text', text: '見積もりを開始します。以下の質問にお答えください。' },
          ...qs
        ]);
      }

      // セッション状態に応じた応答
      const s = getSession(userId);

      // 写真待ち中にテキストが来た場合
      if (isUploadStep(s.step)) {
        return replyMessage(event.replyToken, '写真を送信するか、右下の「スキップ」を押してください。');
      }

      // 任意：リセット対応（必要なければコメントアウトでOK）
      if (text === 'リセット') {
        resetSession(userId);
        return replyMessage(event.replyToken, `回答をリセットしました。\n「${START_TRIGGER}」と送ると再開します。`);
      }

      // ガイド
      return replyMessage(event.replyToken, `「${START_TRIGGER}」と送ると見積もりを開始します。`);
    }

    // 画像
    if (msg.type === 'image') {
      const s = getSession(userId);

      // 画像が期待されていないとき
      if (!isUploadStep(s.step)) {
        return replyMessage(event.replyToken, 'ありがとうございます。ボタンから続きの質問にお進みください。');
      }

      const current = s.step;
      const label = UPLOAD_LABELS[current] || '写真';

      // ここで保存する場合は実装（Supabase/Storage等）。本実装は省略し、次に進める。
      const next = nextUploadStep(current);
      if (next) {
        s.step = next;
        return replyMessage(event.replyToken, [
          { type: 'text', text: `受け取りました（${label}）` },
          buildUploadPrompt(next),
        ]);
      } else {
        // 最後（ヒビ/割れ）→ 概算
        s.step = STEPS.ESTIMATE;
        return replyMessage(event.replyToken, [
          { type: 'text', text: `受け取りました（${label}）` },
          buildEstimateFlex(s.ans),
        ]);
      }
    }

    // 他タイプは無視
    return;
  }

  // Postback
  if (event.type === 'postback') {
    const data = String(event.postback?.data || '');

    const s = getSession(userId);

    // 写真スキップ
    if (data === 'NEXT') {
      if (!isUploadStep(s.step)) {
        return replyMessage(event.replyToken, '次へ進めませんでした。もう一度お試しください。');
      }
      const next = nextUploadStep(s.step);
      if (next) {
        s.step = next;
        return replyMessage(event.replyToken, [
          { type: 'text', text: 'スキップしました。' },
          buildUploadPrompt(next),
        ]);
      } else {
        s.step = STEPS.ESTIMATE;
        return replyMessage(event.replyToken, [
          { type: 'text', text: 'スキップしました。' },
          buildEstimateFlex(s.ans),
        ]);
      }
    }

    // 回答（ANS|key|value）
    if (data.startsWith('ANS|')) {
      const [, key, encVal] = data.split('|');
      const value = decodeURIComponent(encVal || '');
      s.ans[key] = value;

      // 次のステップ
      const next = nextStepAfterAnswer(key, s);
      s.step = next;

      // 次の表示
      if (isUploadStep(next)) {
        return replyMessage(event.replyToken, buildUploadPrompt(next));
      } else if (next === STEPS.ESTIMATE) {
        return replyMessage(event.replyToken, buildEstimateFlex(s.ans));
      } else {
        const qs = buildQuestionMessages(next);
        return replyMessage(event.replyToken, qs);
      }
    }

    // 不明なポストバック
    return replyMessage(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
  }
}
