/**
 * 外壁塗装 見積ボット（画像ボタン / 写真アップ可・保存なし / 完了時のみSheets連携 / 完了時のみ管理者通知）
 * - 設問は画像+テキストのFlexカード（タップでpostback）
 * - Q10は写真アップ（保存はせず、受領メッセージのみ。トーク履歴に残る）
 * - 概算表示 → 「詳しい見積もりを依頼する」ボタン → お名前 → 郵便番号 → 住所の続き
 * - スプレッドシートへは「概算が出た時」に1行追記（連絡先が後で入ったら同じ行を更新）
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import axios from 'axios';
import qs from 'qs';
import { google } from 'googleapis';

// ===== LINE 設定 =====
const lineConfig = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!lineConfig.channelSecret || !lineConfig.channelAccessToken) {
  console.error('[ERROR] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です');
  process.exit(1);
}
const client = new line.Client(lineConfig);

// ===== 管理者通知（任意）=====
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '';
async function notifyAdmin(text) {
  if (!ADMIN_USER_ID) return; // 未設定なら送らない
  try {
    await client.pushMessage(ADMIN_USER_ID, { type: 'text', text });
  } catch (e) {
    console.error('notifyAdmin error:', e?.response?.data || e.message);
  }
}

// ===== Google Sheets =====
const SHEET_ID   = process.env.GSHEET_SPREADSHEET_ID || '';
const SHEET_NAME = process.env.GSHEET_SHEET_NAME || 'Entries';
const SA_EMAIL   = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
let SA_KEY       = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
SA_KEY = SA_KEY.replace(/\\n/g, '\n'); // 1行貼付けでもOKに

function getSheetsClient() {
  if (!SHEET_ID || !SHEET_NAME || !SA_EMAIL || !SA_KEY) return null;
  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/**
 * シート列定義（A〜S）
 * A:Timestamp  B:Status  C:SessionCode  D:UserId
 * E:Name  F:Postal  G:Address1  H:Address2
 * I:Q1  J:Q2  K:Q3  L:Q4  M:Q5  N:Q6  O:Q7  P:Q8  Q:Q9
 * R:PhotosCount  S:Estimate
 */
async function appendEstimateRow(session, userId, estimate) {
  const sheets = getSheetsClient();
  if (!sheets || session.appended) return null;

  const a = session.answers;
  const row = [
    new Date(new Date().getTime() + 9 * 3600 * 1000).toISOString().replace('T', ' ').replace('Z', ''), // JST擬似
    'estimate_completed',
    session.code,
    userId,
    '', '', '', '', // Name/Postal/Address1/Address2 は空で入れておく（後で更新）
    a.q1 || '', a.q2 || '', a.q3 || '', a.q4 || '', a.q5 || '',
    a.q6 || '', a.q7 || '', a.q8 || '', a.q9 || '',
    session.photosCount || 0,
    estimate || 0,
  ];

  try {
    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:S`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
    const updatedRange = res.data?.updates?.updatedRange || ''; // 例: 'Entries!A42:S42'
    const m = updatedRange.match(/![A-Z]+(\d+):[A-Z]+\1$/);
    const rowIndex = m ? Number(m[1]) : null;
    session.sheetRow = rowIndex;   // 後で更新用に保持
    session.appended = true;       // 二重書き込み防止
    console.log('Sheets append ok:', updatedRange);
    return rowIndex;
  } catch (e) {
    console.error('Sheets append error:', e?.response?.data || e.message);
    return null;
  }
}

async function updateContactToRow(session) {
  const sheets = getSheetsClient();
  if (!sheets || !session.sheetRow) return;

  const r = session.sheetRow;
  const name   = session.contact.name || '';
  const postal = session.contact.zip || '';
  const addr1  = session.contact.addr1 || '';
  const addr2  = session.contact.addr2 || '';

  try {
    // 連絡先の更新（E:H）
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!E${r}:H${r}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[name, postal, addr1, addr2]] },
    });
    // ステータス更新（B）
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!B${r}:B${r}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['contact_completed']] },
    });
    console.log('Sheets contact update ok: row', r);
  } catch (e) {
    console.error('Sheets contact update error:', e?.response?.data || e.message);
  }
}

// ===== セッション（簡易メモリ）=====
const sessions = new Map();
const FLOW = {
  NONE: 'none',
  NAME: 'name',
  ZIP: 'zip',
  ADDR2: 'addr2',
};
function newCode() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
}
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      code: newCode(),           // シート行の識別にも使う
      step: 1,
      answers: {},
      // 写真関連
      expectingPhoto: false,
      photoIndex: 0,
      photosCount: 0,
      // 連絡先
      flow: FLOW.NONE,
      contact: { name: '', zip: '', addr1: '', addr2: '' },
      // Sheets
      appended: false,
      sheetRow: null,
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, {
    code: newCode(),
    step: 1,
    answers: {},
    expectingPhoto: false,
    photoIndex: 0,
    photosCount: 0,
    flow: FLOW.NONE,
    contact: { name: '', zip: '', addr1: '', addr2: '' },
    appended: false,
    sheetRow: null,
  });
}

// ===== 画像URL（差し替えOK）=====
const PH = (t) => `https://placehold.co/800x800/png?text=${encodeURIComponent(t)}`;

// ===== 写真ステップ =====
const PHOTO_STEPS = [
  { key: 'floor_plan', label: '平面図（任意）' },
  { key: 'elevation',  label: '立面図（任意）' },
  { key: 'section',    label: '断面図（任意）' },
  { key: 'around',     label: '周囲の写真（任意）' },
  { key: 'front',      label: '外観写真：正面' },
  { key: 'right',      label: '外観写真：右側' },
  { key: 'left',       label: '外観写真：左側' },
  { key: 'back',       label: '外観写真：後ろ側' },
  { key: 'damage',     label: '損傷箇所（任意）' },
];

// ===== Webサーバ =====
const app = express();
app.get('/health', (_, res) => res.status(200).send('healthy'));
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).send('Error');
  }
});
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LINE bot listening on ${PORT}`));

// ===== ユーティリティ =====
const replyText = (rt, text) => client.replyMessage(rt, { type: 'text', text });
const pushText  = (uid, text) => client.pushMessage(uid, { type: 'text', text });

function buildOptionsFlex(qNum, question, options) {
  // options: [{label, value, imageUrl}]
  const bubbles = options.map(opt => ({
    type: 'bubble',
    hero: {
      type: 'image',
      url: opt.imageUrl,
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'cover',
      action: {
        type: 'postback',
        label: opt.label,
        data: qs.stringify({ q: qNum, v: opt.value }),
        displayText: opt.label,
      },
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text: opt.label, weight: 'bold', size: 'sm', wrap: true, align: 'center' }],
      spacing: 'sm',
      paddingAll: '12px',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          action: { type: 'postback', label: '選択する', data: qs.stringify({ q: qNum, v: opt.value }), displayText: opt.label }
        }
      ]
    }
  }));
  return { type: 'flex', altText: question, contents: { type: 'carousel', contents: bubbles.slice(0, 10) } };
}
const makeOptions = (labels, map={}) => labels.map(l => ({ label: l, value: l, imageUrl: map[l] || PH(l) }));
async function sendImageOptions(rt, qNum, question, labels, map) {
  const flex = buildOptionsFlex(qNum, question, makeOptions(labels, map));
  return client.replyMessage(rt, [{ type: 'text', text: question }, flex ]);
}

// 郵便番号→住所（zipcloud）
async function lookupZip(zip7) {
  try {
    const r = await axios.get('https://zipcloud.ibsnet.co.jp/api/search', { params: { zipcode: zip7 } });
    const z = r.data?.results?.[0];
    if (!z) return '';
    return `${z.address1}${z.address2}${z.address3}`;
  } catch (e) {
    console.error('lookupZip error:', e?.response?.data || e.message);
    return '';
  }
}

// ===== イベント処理 =====
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  // 友だち追加
  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(event.replyToken,
      '友だち追加ありがとうございます！\n外壁・屋根塗装の【かんたん概算見積り】をご案内します。\nはじめますか？「見積もり」または「スタート」を送ってください。'
    );
  }

  // テキスト
  if (event.type === 'message' && event.message.type === 'text') {
    const text = (event.message.text || '').trim();
    const s = getSession(userId);

    // 連絡先フロー中
    if (s.flow !== FLOW.NONE) {
      if (s.flow === FLOW.NAME) {
        s.contact.name = text;
        s.flow = FLOW.ZIP;
        return replyText(event.replyToken, 'ありがとうございます。郵便番号（例：123-4567）を入力してください。');
      }
      if (s.flow === FLOW.ZIP) {
        const zip = text.replace(/[^\d]/g, '');
        if (!/^\d{7}$/.test(zip)) return replyText(event.replyToken, '郵便番号は7桁で入力してください。（例：1234567）');
        s.contact.zip = zip;
        const addr1 = await lookupZip(zip);
        if (!addr1) return replyText(event.replyToken, '住所が見つかりませんでした。もう一度郵便番号を入力してください。');
        s.contact.addr1 = addr1;
        s.flow = FLOW.ADDR2;
        return replyText(event.replyToken, `住所を自動入力しました：\n【${addr1}】\n\n続きの番地・建物名・部屋番号を入力してください。`);
      }
      if (s.flow === FLOW.ADDR2) {
        s.contact.addr2 = text;
        s.flow = FLOW.NONE;

        await replyText(event.replyToken,
          `受付しました！\n\nお名前：${s.contact.name}\n住所：${s.contact.addr1}${s.contact.addr2}\n\n担当より1営業日以内にご連絡します。`
        );

        // シートに連絡先追記（同じ行を更新）
        await updateContactToRow(s);
        await notifyAdmin(`詳細受領（${userId}）\n氏名:${s.contact.name}\n住所:${s.contact.addr1}${s.contact.addr2}`);
        return;
      }
    }

    // 共通コマンド
    if (/^(見積もり|スタート|start)$/i.test(text)) {
      resetSession(userId);
      return askQ1(event.replyToken, userId);
    }
    if (/^(最初から|リセット)$/i.test(text)) {
      resetSession(userId);
      return replyText(event.replyToken, 'リセットしました。「見積もり」と送ってください。');
    }

    // 写真待ち中のテキスト
    if (s.expectingPhoto) {
      if (/^(スキップ|skip)$/i.test(text)) return askNextPhoto(event.replyToken, userId, true);
      if (/^(完了|おわり|終了)$/i.test(text)) {
        s.photoIndex = PHOTO_STEPS.length;
        return finishAndEstimate(event.replyToken, userId);
      }
      return replyText(event.replyToken, '画像を送信してください。スキップは「スキップ」と送ってください。');
    }

    // それ以外は案内
    return replyText(event.replyToken, '「見積もり」または「スタート」と送ってください。');
  }

  // 画像（保存しない）
  if (event.type === 'message' && event.message.type === 'image') {
    const s = getSession(userId);
    if (!s.expectingPhoto) {
      return replyText(event.replyToken, 'ありがとうございます。現在質問中です。続きのボタンをタップしてください。');
    }
    const current = PHOTO_STEPS[s.photoIndex] || { label: '写真' };
    s.photosCount += 1;

    await client.replyMessage(event.replyToken, { type: 'text', text: `受け取りました：${current.label}` });
    return askNextPhoto(null, userId, false); // pushで次へ
  }

  // Postback（画像ボタン含む）
  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data || '');
    const s = getSession(userId);

    // 詳細見積もりの開始
    if (data.action === 'handoff') {
      s.flow = FLOW.NAME;
      return replyText(event.replyToken, '詳しい見積もりのご依頼ですね。まずお名前をご入力ください。');
    }

    const q = Number(data.q);
    const v = data.v;
    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    s.answers[`q${q}`] = v;

    // Q4：ない/わからない → Q5スキップ
    if (q === 4 && (v === 'ない' || v === 'わからない')) {
      s.answers['q5'] = '該当なし';
      s.step = 6;
      return askQ6(event.replyToken);
    }

    s.step = q + 1;
    switch (s.step) {
      case 2:  return askQ2(event.replyToken);
      case 3:  return askQ3(event.replyToken);
      case 4:  return askQ4(event.replyToken);
      case 5:  return askQ5(event.replyToken);
      case 6:  return askQ6(event.replyToken);
      case 7:  return askQ7(event.replyToken);
      case 8:  return askQ8(event.replyToken);
      case 9:  return askQ9(event.replyToken);
      case 10: return askQ10_Begin(event.replyToken, userId);
      default: return finishAndEstimate(event.replyToken, userId);
    }
  }
}

// ===== 設問送信（画像つきボタン）=====
async function askQ1(rt, userId) {
  const s = getSession(userId); s.step = 1;
  const labels = ['1階建て','2階建て','3階建て'];
  return sendImageOptions(rt, 1, '1/10 住宅の階数を選んでください', labels, {
    '1階建て': PH('1F'), '2階建て': PH('2F'), '3階建て': PH('3F'),
  });
}
async function askQ2(rt) {
  const labels = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  const imgs = Object.fromEntries(labels.map(l => [l, PH(l)]));
  return sendImageOptions(rt, 2, '2/10 住宅の間取りを選んでください', labels, imgs);
}
async function askQ3(rt) {
  const labels = ['外壁塗装','屋根塗装','外壁塗装＋屋根塗装'];
  return sendImageOptions(rt, 3, '3/10 希望する工事内容を選んでください', labels, {
    '外壁塗装': PH('壁'), '屋根塗装': PH('屋根'), '外壁塗装＋屋根塗装': PH('壁+屋根')
  });
}
async function askQ4(rt) {
  const labels = ['ある','ない','わからない'];
  return sendImageOptions(rt, 4, '4/10 これまで外壁塗装をしたことはありますか？', labels, {
    'ある': PH('YES'), 'ない': PH('NO'), 'わからない': PH('？')
  });
}
async function askQ5(rt) {
  const labels = ['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  const imgs = Object.fromEntries(labels.map(l => [l, PH(l)]));
  return sendImageOptions(rt, 5, '5/10 前回の外壁塗装からどのくらい経っていますか？', labels, imgs);
}
async function askQ6(rt) {
  const labels = ['モルタル','サイディング','タイル','ALC'];
  return sendImageOptions(rt, 6, '6/10 外壁の種類を選んでください', labels, {
    'モルタル': PH('モルタル'), 'サイディング': PH('サイディング'),
    'タイル': PH('タイル'), 'ALC': PH('ALC')
  });
}
async function askQ7(rt) {
  const labels = ['瓦','スレート','ガルバリウム','トタン'];
  return sendImageOptions(rt, 7, '7/10 屋根の種類を選んでください', labels, {
    '瓦': PH('瓦'), 'スレート': PH('スレート'), 'ガルバリウム': PH('ガルバ'),
    'トタン': PH('トタン')
  });
}
async function askQ8(rt) {
  const labels = ['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'];
  return sendImageOptions(rt, 8, '8/10 雨漏りの状況を選んでください', labels, {
    '雨の日に水滴が落ちる': PH('滴'), '天井にシミがある': PH('天井シミ'), '雨漏りはない': PH('なし')
  });
}
async function askQ9(rt) {
  const labels = ['30cm以下','50cm以下','70cm以下','70cm以上'];
  return sendImageOptions(rt, 9, '9/10 周辺との最短距離を選んでください（足場設置の目安）', labels, {
    '30cm以下': PH('≤30cm'), '50cm以下': PH('≤50cm'),
    '70cm以下': PH('≤70cm'), '70cm以上': PH('≥70cm')
  });
}

// ===== 写真Q10 =====
async function askQ10_Begin(rt, userId) {
  const s = getSession(userId);
  s.expectingPhoto = true;
  s.photoIndex = 0;
  return askNextPhoto(rt, userId, false, true);
}
async function askNextPhoto(rtOrNull, userId, skipped=false, first=false) {
  const s = getSession(userId);
  if (!s.expectingPhoto) s.expectingPhoto = true;

  if (!first && skipped) {
    if (rtOrNull) await replyText(rtOrNull, 'スキップしました。');
    else await pushText(userId, 'スキップしました。');
  }
  if (!first) s.photoIndex += 1;

  if (s.photoIndex >= PHOTO_STEPS.length) {
    s.expectingPhoto = false;
    if (rtOrNull) return finishAndEstimate(rtOrNull, userId);
    return finishAndEstimatePush(userId);
  }

  const current = PHOTO_STEPS[s.photoIndex];
  const msg = {
    type: 'text',
    text: `10/10 写真アップロード\n「${current.label}」を送ってください。`,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'camera', label: 'カメラを起動' } },
        { type: 'action', action: { type: 'cameraRoll', label: 'アルバムから選択' } },
        { type: 'action', action: { type: 'message', label: 'スキップ', text: 'スキップ' } },
        { type: 'action', action: { type: 'message', label: '完了', text: '完了' } },
      ],
    },
  };
  if (rtOrNull) return client.replyMessage(rtOrNull, msg);
  return client.pushMessage(userId, msg);
}

// ===== 概算計算・完了 =====
function estimateCost(a) {
  const base = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装＋屋根塗装': 900000 };
  const floors = { '1階建て': 1.0, '2階建て': 1.2, '3階建て': 1.4 };
  const layout = { '1DK':0.9,'1LDK':0.95,'2DK':1.0,'2LDK':1.05,'3DK':1.1,'3LDK':1.15,'4DK':1.2,'4LDK':1.25,'5DK':1.3,'5LDK':1.35 };
  const wall = { 'モルタル':1.05,'サイディング':1.0,'タイル':1.15,'ALC':1.1 };
  const roof = { '瓦':1.1,'スレート':1.0,'ガルバリウム':1.05,'トタン':0.95 };
  const leak = { '雨の日に水滴が落ちる':1.15,'天井にシミがある':1.1,'雨漏りはない':1.0 };
  const dist = { '30cm以下':1.2,'50cm以下':1.15,'70cm以下':1.1,'70cm以上':1.0 };
  const years = { '1〜5年':0.95,'5〜10年':1.0,'10〜15年':1.05,'15〜20年':1.1,'20〜30年':1.15,'30〜40年':1.2,'40年以上':1.25,'0年（新築）':0.9 };

  let cost = base[a.q3] ?? 600000;
  cost *= floors[a.q1] ?? 1.0;
  cost *= layout[a.q2] ?? 1.0;
  cost *= wall[a.q6] ?? 1.0;
  cost *= leak[a.q8] ?? 1.0;
  cost *= dist[a.q9] ?? 1.0;
  if (a.q3 === '屋根塗装' || a.q3 === '外壁塗装＋屋根塗装') cost *= roof[a.q7] ?? 1.0;
  if (a.q4 === 'ある') cost *= years[a.q5] ?? 1.0;

  return Math.round(cost / 1000) * 1000;
}
const yen = (n) => n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

function handoffFlex() {
  return {
    type: 'flex',
    altText: '詳しい見積もりを依頼する',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', contents: [
          { type: 'text', text: 'より詳しい見積もりをご希望の方へ', weight: 'bold', size: 'md' },
          { type: 'text', text: 'ボタンを押して、お名前とご住所をお知らせください。1営業日以内にご連絡します。', wrap: true, size: 'sm' },
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'button', style: 'primary',
            action: { type: 'postback', label: '詳しい見積もりを依頼する', data: qs.stringify({ action: 'handoff' }), displayText: '詳しい見積もりを依頼する' }
          }
        ]
      }
    }
  };
}

async function finishAndEstimate(rt, userId) {
  const s = getSession(userId);
  s.expectingPhoto = false;
  s.step = 11;

  const a = s.answers;
  const estimate = estimateCost(a);

  const summary =
    '【回答の確認】\n' +
    `・階数: ${a.q1 || '-'}\n・間取り: ${a.q2 || '-'}\n・工事内容: ${a.q3 || '-'}\n` +
    `・過去の外壁塗装: ${a.q4 || '-'}\n・前回からの年数: ${a.q5 || '該当なし'}\n` +
    `・外壁種類: ${a.q6 || '-'}\n・屋根種類: ${a.q7 || '-'}\n` +
    `・雨漏り: ${a.q8 || '-'}\n・最短距離: ${a.q9 || '-'}\n` +
    `・受領写真枚数: ${s.photosCount}枚`;

  const msgs = [
    { type: 'text', text: summary },
    { type: 'text', text: `概算金額：${yen(estimate)}\n\n※表示金額は概算の目安です。実際の建物形状・劣化状況・足場条件・使用塗料により変動します。` },
    handoffFlex(),
  ];
  await client.replyMessage(rt, msgs);

  // 完了時のみ：Sheetsへ追記 / 管理者へ通知
  await appendEstimateRow(s, userId, estimate);
  await notifyAdmin(`新しい概算（完了）\nユーザー:${userId}\n概算:${yen(estimate)}\n写真枚数:${s.photosCount}`);
}

async function finishAndEstimatePush(userId) {
  const s = getSession(userId);
  s.expectingPhoto = false;
  s.step = 11;

  const a = s.answers;
  const estimate = estimateCost(a);

  const summary =
    '【回答の確認】\n' +
    `・階数: ${a.q1 || '-'}\n・間取り: ${a.q2 || '-'}\n・工事内容: ${a.q3 || '-'}\n` +
    `・過去の外壁塗装: ${a.q4 || '-'}\n・前回からの年数: ${a.q5 || '該当なし'}\n` +
    `・外壁種類: ${a.q6 || '-'}\n・屋根種類: ${a.q7 || '-'}\n` +
    `・雨漏り: ${a.q8 || '-'}\n・最短距離: ${a.q9 || '-'}\n` +
    `・受領写真枚数: ${s.photosCount}枚`;

  await pushText(userId, summary);
  await pushText(userId, `概算金額：${yen(estimate)}\n\n※表示金額は概算の目安です。実際の建物形状・劣化状況・足場条件・使用塗料により変動します。`);
  await client.pushMessage(userId, handoffFlex());

  await appendEstimateRow(s, userId, estimate);
  await notifyAdmin(`新しい概算（完了）\nユーザー:${userId}\n概算:${yen(estimate)}\n写真枚数:${s.photosCount}`);
}
