// server.js
import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client as LineClient, middleware as lineMiddleware } from '@line/bot-sdk';
import axios from 'axios';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

/* ============= 基本設定 ============= */
const {
  CHANNEL_SECRET,
  CHANNEL_ACCESS_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GSHEET_SPREADSHEET_ID,
  GSHEET_SHEET_NAME = 'Entries',
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  EMAIL_TO,
  EMAIL_WEBAPP_URL,
  LIFF_ID,
  LIFF_CHANNEL_ID, // 参照のみ（現在は未使用）
  FRIEND_ADD_URL,  // 参照のみ（必要があればカードに表示）
} = process.env;

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

// 静的ファイル（/liff配下）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/liff', express.static(path.join(__dirname, 'liff')));

// /liff/env.js を動的に返す（LIFF_ID）
app.get('/liff/env.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.send(`window.__LIFF_ENV__ = { LIFF_ID: "${LIFF_ID || ''}" };`);
});

// ヘルスチェック
app.get('/health', (_req, res) => res.type('text').send('ok'));

/* ============= LINE SDK ============= */
const lineConfig = {
  channelSecret: CHANNEL_SECRET,
  channelAccessToken: CHANNEL_ACCESS_TOKEN
};
const lineClient = new LineClient(lineConfig);

// Webhook 署名検証（LINE SDK ミドルウェア）
app.post('/webhook', lineMiddleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook error', e);
    res.sendStatus(500);
  }
});

/* ============= 外部サービス ============= */
// Supabase（画像保存）
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// Google Sheets
let sheets = null;
if (GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY && GSHEET_SPREADSHEET_ID) {
  const auth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    undefined,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  sheets = google.sheets({ version: 'v4', auth });
}

/* ============= 会話状態（簡易：メモリ） ============= */
// 実運用ではKV等へ載せ替え推奨
const session = new Map(); // key: userId, value: { idx, data, photos, multiBuffer }

function getState(userId) {
  if (!session.has(userId)) {
    session.set(userId, { idx: 0, data: {}, photos: {}, cracks: [] });
  }
  return session.get(userId);
}

function resetState(userId) {
  session.delete(userId);
}

/* ============= 質問定義 ============= */
/**
 * kind:
 *  - 'choice' : ボタン選択（画像付きFlex）
 *  - 'image'  : 画像アップロード（1枚、任意でスキップ）
 *  - 'images' : 複数画像（完了ボタンで次へ）
 *
 * when(state) で分岐可
 */
const Q = [
  { id: 'floors', kind: 'choice', title: '工事物件の階数は？', options: ['1階建て', '2階建て', '3階建て'] },
  { id: 'layout', kind: 'choice', title: '物件の間取りは？', options: ['1K', '1DK', '1LDK', '2K', '2DK', '2LDK', '3K', '3DK', '4K', '4DK', '4LDK'] },
  { id: 'age', kind: 'choice', title: '物件の築年数は？', options: ['新築', '〜10年', '〜20年', '〜30年', '〜40年', '〜50年', '51年以上'] },
  { id: 'paintedBefore', kind: 'choice', title: '過去に塗装をした経歴は？', options: ['ある', 'ない', 'わからない'] },
  {
    id: 'lastPaint',
    kind: 'choice',
    title: '前回の塗装はいつ頃？',
    options: ['〜5年', '5〜10年', '10〜20年', '20〜30年', 'わからない'],
    when: s => s.data.paintedBefore === 'ある'
  },
  { id: 'scope', kind: 'choice', title: 'ご希望の工事内容は？', options: ['外壁塗装', '屋根塗装', '外壁塗装+屋根塗装'] },

  /* 分岐：外壁 */
  {
    id: 'wallType',
    kind: 'choice',
    title: '外壁の種類は？',
    options: ['モルタル', 'サイディング', 'タイル', 'ALC'],
    when: s => s.data.scope === '外壁塗装' || s.data.scope === '外壁塗装+屋根塗装'
  },
  /* 分岐：屋根 */
  {
    id: 'roofType',
    kind: 'choice',
    title: '屋根の種類は？',
    options: ['瓦', 'スレート', 'ガルバリウム', 'トタン'],
    when: s => s.data.scope === '屋根塗装' || s.data.scope === '外壁塗装+屋根塗装'
  },

  { id: 'leak', kind: 'choice', title: '雨漏りや漏水の症状はありますか？', options: ['雨の日に水滴が落ちる', '天井にシミがある', 'ない'] },
  {
    id: 'gap',
    kind: 'choice',
    title: '隣や裏の家との距離は？',
    note: '周囲で一番近い距離の数値をお答えください。',
    options: ['30cm以下', '50cm以下', '70cm以下', '70cm以上']
  },

  // 図面・写真（個別）
  { id: 'elevation', kind: 'image', title: '立面図をアップロードしてください。' },
  { id: 'plan', kind: 'image', title: '平面図をアップロードしてください。' },
  { id: 'section', kind: 'image', title: '断面図をアップロードしてください。' },
  {
    id: 'front', kind: 'image',
    title: '正面から撮影した物件の写真をアップロードしてください。',
    note: '※足場を設置する箇所を確認しますので、周囲の地面が見える写真でお願いします。'
  },
  {
    id: 'right', kind: 'image',
    title: '右側から撮影した物件の写真をアップロードしてください。',
    note: '※足場を設置する箇所を確認しますので、周囲の地面が見える写真でお願いします。'
  },
  {
    id: 'left', kind: 'image',
    title: '左側から撮影した物件の写真をアップロードしてください。',
    note: '※足場を設置する箇所を確認しますので、周囲の地面が見える写真でお願いします。'
  },
  {
    id: 'back', kind: 'image',
    title: '後ろ側から撮影した物件の写真をアップロードしてください。',
    note: '※足場を設置する箇所を確認しますので、周囲の地面が見える写真でお願いします。'
  },
  { id: 'garage', kind: 'image', title: '車庫の位置がわかる写真をアップロードしてください。' },
  { id: 'cracks', kind: 'images', title: '外壁や屋根にヒビや割れがある場合アップロードしてください。（複数可・「完了」で次へ）' },
];

/* ============= Flex（カード）生成 ============= */
function choiceFlex(title, options, note) {
  // 画像つきカード（シンプルなヒーロー無し）
  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'md', wrap: true },
          ...(note ? [{ type: 'text', text: note, size: 'sm', color: '#666666', wrap: true, margin: 'sm' }] : []),
          { type: 'separator', margin: 'md' },
          ...options.map(o => ({
            type: 'button',
            action: { type: 'postback', label: o, data: `ans=${encodeURIComponent(o)}` },
            style: 'primary',
            color: '#00b900',
            margin: 'md'
          }))
        ]
      }
    }
  };
}

function quickForImage(kind) {
  const items = [];
  if (kind === 'image') {
    items.push({ type: 'action', action: { type: 'message', label: 'スキップ', text: 'スキップ' } });
  }
  if (kind === 'images') {
    items.push({ type: 'action', action: { type: 'message', label: '完了', text: '完了' } });
  }
  return items.length
    ? { items, type: 'quickReply' }
    : undefined;
}

function estimateCard(amountYen, userId) {
  const liffUrl = `https://liff.line.me/${LIFF_ID}?uid=${encodeURIComponent(userId)}`;
  return {
    type: 'flex',
    altText: '概算見積り',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'ありがとうございます。', weight: 'bold', size: 'md' },
          {
            type: 'text',
            text: `工事代金は ¥${amountYen.toLocaleString()} です。`,
            size: 'xl',
            weight: 'bold',
            margin: 'md'
          },
          {
            type: 'text',
            text: '※ご入力いただいた情報を元に計算した概算見積もりです。',
            size: 'sm',
            color: '#666666',
            wrap: true,
            margin: 'sm'
          },
          { type: 'separator', margin: 'lg' },
          {
            type: 'text',
            text: '1〜3営業日以内にLINEでお見積書をお送りします。',
            size: 'sm',
            color: '#666666',
            wrap: true,
            margin: 'md'
          },
          {
            type: 'button',
            style: 'primary',
            color: '#00b900',
            action: { type: 'uri', label: '現地調査なしでLINE見積もり', uri: liffUrl },
            margin: 'lg'
          }
        ]
      }
    }
  };
}

/* ============= 概算の計算（簡易係数） ============= */
function calcEstimate(data) {
  // 基礎面積（間取り→目安㎡）
  const layoutArea = {
    '1K': 30, '1DK': 35, '1LDK': 40,
    '2K': 45, '2DK': 55, '2LDK': 60,
    '3K': 70, '3DK': 80,
    '4K': 85, '4DK': 95, '4LDK': 100
  };
  let area = layoutArea[data.layout] || 60;
  // 階数で外壁面積増
  const floorMul = { '1階建て': 1.0, '2階建て': 1.25, '3階建て': 1.5 };
  area *= floorMul[data.floors] || 1.2;

  // ベース単価（円/㎡）
  let unit = 2800;
  // 外壁/屋根の種別係数
  if (data.scope?.includes('外壁')) {
    if (data.wallType === 'タイル') unit += 400;
    if (data.wallType === 'ALC') unit += 600;
  }
  if (data.scope?.includes('屋根')) {
    unit += 600;
    if (data.roofType === 'ガルバリウム') unit += 300;
    if (data.roofType === '瓦') unit += 200;
  }
  // 漏水補正
  if (data.leak === '雨の日に水滴が落ちる') unit += 800;
  if (data.leak === '天井にシミがある') unit += 400;
  // 近接補正（足場）  
  const gapMul = { '30cm以下': 1.15, '50cm以下': 1.1, '70cm以下': 1.05, '70cm以上': 1.0 };
  const amount = Math.round(area * unit * (gapMul[data.gap] || 1.0));
  return amount;
}

/* ============= 次質問出し分け ============= */
function nextIndex(state) {
  // 現在idx以降で when がtrue の最初
  for (let i = state.idx; i < Q.length; i++) {
    const q = Q[i];
    if (!q.when || q.when(state)) return i;
  }
  return Q.length; // 終了
}

async function askNext(userId) {
  const state = getState(userId);
  state.idx = nextIndex(state);

  if (state.idx >= Q.length) {
    // 全回答 → 概算提示カード
    const amount = calcEstimate(state.data);
    const flex = estimateCard(amount, userId);
    await lineClient.pushMessage(userId, [
      { type: 'text', text: 'ありがとうございます。概算見積りを作成しました。' },
      flex
    ]);
    return;
  }

  const q = Q[state.idx];
  if (q.kind === 'choice') {
    await lineClient.pushMessage(userId, choiceFlex(q.title, q.options, q.note));
  } else if (q.kind === 'image') {
    await lineClient.pushMessage(userId, {
      type: 'text',
      text: [q.title, q.note].filter(Boolean).join('\n'),
      quickReply: quickForImage('image')
    });
  } else if (q.kind === 'images') {
    await lineClient.pushMessage(userId, {
      type: 'text',
      text: q.title,
      quickReply: quickForImage('images')
    });
  }
}

/* ============= 画像保存（Supabase） ============= */
async function saveImageToSupabase(userId, messageId, tag) {
  if (!supabase) return null;
  const content = await lineClient.getMessageContent(messageId);
  const chunks = [];
  for await (const c of content) chunks.push(c);
  const buff = Buffer.concat(chunks);
  const filePath = `${userId}/${Date.now()}_${tag}.jpg`;
  const { data, error } = await supabase.storage.from('uploads').upload(filePath, buff, {
    contentType: 'image/jpeg', upsert: false
  });
  if (error) throw error;
  const { data: pub } = supabase.storage.from('uploads').getPublicUrl(filePath);
  return pub?.publicUrl || null;
}

/* ============= イベントハンドラ ============= */
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  const state = getState(userId);

  // Postback（選択肢）
  if (event.type === 'postback') {
    const data = new URLSearchParams(event.postback.data);
    const ans = data.get('ans');
    if (ans) {
      const q = Q[state.idx];
      state.data[q.id] = decodeURIComponent(ans);
      state.idx++;
      await askNext(userId);
    }
    return;
  }

  if (event.type === 'message') {
    const msg = event.message;

    // キーワードで最初から
    if (msg.type === 'text') {
      const t = (msg.text || '').trim();
      if (['リセット', 'reset'].includes(t)) {
        resetState(userId);
        await lineClient.replyMessage(event.replyToken, { type: 'text', text: '状態をリセットしました。「見積もり」と送ると開始します。' });
        return;
      }
      if (['見積もり', '見積り', 'スタート', '開始'].includes(t)) {
        resetState(userId);
        await lineClient.replyMessage(event.replyToken, { type: 'text', text: '見積もりを開始します。' });
        await askNext(userId);
        return;
      }
      // 画像系ステップの制御（スキップ/完了）
      const q = Q[state.idx];
      if (q?.kind === 'image' && t === 'スキップ') {
        state.photos[q.id] = null;
        state.idx++;
        await askNext(userId);
        return;
      }
      if (q?.kind === 'images' && t === '完了') {
        state.idx++;
        await askNext(userId);
        return;
      }
      // それ以外は無視
      return;
    }

    // 画像メッセージ処理
    if (msg.type === 'image') {
      const q = Q[state.idx];
      if (!q || (q.kind !== 'image' && q.kind !== 'images')) {
        // 想定外のタイミングは無視
        await lineClient.replyMessage(event.replyToken, { type: 'text', text: '現在は画像の受付フェーズではありません。' });
        return;
      }
      // 保存
      let url = null;
      try {
        url = await saveImageToSupabase(userId, msg.id, q.id);
      } catch (e) {
        console.error('save image error', e);
      }
      if (q.kind === 'image') {
        state.photos[q.id] = url;
        await lineClient.replyMessage(event.replyToken, { type: 'text', text: '受け取りました。' });
        state.idx++;
        await askNext(userId);
      } else {
        // 複数可
        state.cracks.push(url);
        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '受け取りました。続けて送信できます。完了する場合は「完了」と送ってください。',
          quickReply: quickForImage('images')
        });
      }
      return;
    }
  }
}

/* ============= LIFF 連絡先受け取り ============= */
/**
 * LIFF 側から POST:
 * { uid, name, tel, zip, address, address2 }
 * - uid はカードのURLに付与（?uid=xxx）
 * - ここでシート追加＆メール通知
 */
app.post('/liff/submit', async (req, res) => {
  try {
    const { uid, name, tel, zip, address, address2 } = req.body || {};
    if (!uid || !name || !tel || !zip || !address) {
      return res.status(400).json({ ok: false, error: 'missing fields' });
    }
    const state = getState(uid);
    const data = state?.data || {};
    const photos = state?.photos || {};
    const cracks = state?.cracks || [];

    // スプレッドシート追記
    if (sheets && GSHEET_SPREADSHEET_ID) {
      const values = [[
        name, tel, zip, address, address2 || '',
        data.floors || '', data.layout || '', data.age || '', data.paintedBefore || '', data.lastPaint || '',
        data.scope || '', data.wallType || '', data.roofType || '', data.leak || '', data.gap || '',
        photos.elevation || '', photos.plan || '', photos.section || '',
        photos.front || '', photos.right || '', photos.left || '', photos.back || '', photos.garage || '',
        cracks.filter(Boolean).join(','),
        uid,
        calcEstimate(data),
        new Date().toISOString()
      ]];
      await sheets.spreadsheets.values.append({
        spreadsheetId: GSHEET_SPREADSHEET_ID,
        range: `${GSHEET_SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values }
      });
    }

    // メール（Apps Script）— フォーム送信内容＋URL 群
    if (EMAIL_WEBAPP_URL && EMAIL_TO) {
      const payload = {
        to: EMAIL_TO,
        subject: 'LINE見積りの依頼',
        name, tel, zip, address, address2,
        data,
        photos,
        cracks
      };
      await axios.post(EMAIL_WEBAPP_URL, payload, { timeout: 15000 });
    }

    // 完了メッセージ（質問中の通知はオフ。ここだけ返信）
    await lineClient.pushMessage(uid, {
      type: 'text',
      text: '見積もりのご依頼を受け付けました。1〜3営業日以内にLINEでお見積書をお送りします。'
    });

    // セッション破棄
    resetState(uid);

    res.json({ ok: true });
  } catch (e) {
    console.error('/liff/submit error', e);
    res.status(500).json({ ok: false });
  }
});

/* ============= サーバ起動 ============= */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
