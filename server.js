/**
 * LINE 外壁塗装・概算見積もりボット（チャットON／ZipCloud住所自動入力／Sheetsは完了時のみ）
 * - 質問9個（ボタンPostback）→ 概算
 * - 結果は「reply 1通（集計中…）」→「push で本送信」に分割して安定化
 * - 「具体的な見積もり」ボタン → 名前 → 郵便番号 → 住所自動入力 → 続き住所（完了）
 * - Googleスプレッドシートは「完了時のみ1行追記」：途中離脱／やり直しは未連携
 */

import 'dotenv/config';
import express from 'express';
import * as line from '@line/bot-sdk';
import axios from 'axios';
import qs from 'qs';
import { google } from 'googleapis';

// ========== 環境 ==========
const lineConfig = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};
if (!lineConfig.channelSecret || !lineConfig.channelAccessToken) {
  console.error('[ERROR] CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN が未設定です');
  process.exit(1);
}
const RICH_MENU_ID_MAIN = process.env.RICH_MENU_ID_MAIN || null;

// Google Sheets（任意）
const SHEET_ID = process.env.GSHEET_SPREADSHEET_ID || '';
const SHEET_NAME = process.env.GSHEET_SHEET_NAME || 'Entries';
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const SA_PRIVATE_KEY_RAW = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
const SA_PRIVATE_KEY = SA_PRIVATE_KEY_RAW.replace(/\\n/g, '\n'); // \n を改行に
const useSheets = SHEET_ID && SA_EMAIL && SA_PRIVATE_KEY;

let sheets = null;
if (useSheets) {
  const jwt = new google.auth.JWT(
    SA_EMAIL,
    null,
    SA_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  sheets = google.sheets({ version: 'v4', auth: jwt });
}

const client = new line.Client(lineConfig);
const app = express();

const PORT = process.env.PORT || 10000;
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
app.listen(PORT, () => console.log(`LINE bot listening on ${PORT}`));

// ========== 簡易セッション（メモリ） ==========
// 本番で再起動耐性を付けたい場合はDBへ置き換え推奨
// userId -> { step, answers, mode, detail: {stage,name,postal,address1,address2,logged} }
const sessions = new Map();
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: 1,
      answers: {},
      mode: 'estimate',
      detail: null, // {stage:'name'|'zip'|'addr2'|'done', name, postal, address1, address2, logged:boolean}
    });
  }
  return sessions.get(userId);
}
function resetSession(userId) {
  sessions.set(userId, { step: 1, answers: {}, mode: 'estimate', detail: null });
}

// ========== UI素材 ==========
const ICONS = {
  floor: 'https://cdn-icons-png.flaticon.com/512/8911/8911331.png',
  layout: 'https://cdn-icons-png.flaticon.com/512/9193/9193091.png',
  paint: 'https://cdn-icons-png.flaticon.com/512/992/992703.png',
  yes: 'https://cdn-icons-png.flaticon.com/512/5610/5610944.png',
  no: 'https://cdn-icons-png.flaticon.com/512/5610/5610944.png',
  years: 'https://cdn-icons-png.flaticon.com/512/1827/1827370.png',
  wall: 'https://cdn-icons-png.flaticon.com/512/2992/2992653.png',
  roof: 'https://cdn-icons-png.flaticon.com/512/2933/2933922.png',
  leak: 'https://cdn-icons-png.flaticon.com/512/415/415734.png',
  distance: 'https://cdn-icons-png.flaticon.com/512/535/535285.png',
};

const quickReply = (items) => ({ items });
const actionItem = (label, data, imageUrl, displayText) => ({
  type: 'action',
  imageUrl,
  action: { type: 'postback', label, data, displayText: displayText || label },
});
const replyText = (replyToken, text) => client.replyMessage(replyToken, { type: 'text', text });

// ========== 質問（9問／写真なし） ==========
async function askQ1(replyToken, userId) {
  const s = getSession(userId); s.step = 1;
  const items = [
    actionItem('1階建て', qs.stringify({ q: 1, v: '1階建て' }), ICONS.floor),
    actionItem('2階建て', qs.stringify({ q: 1, v: '2階建て' }), ICONS.floor),
    actionItem('3階建て', qs.stringify({ q: 1, v: '3階建て' }), ICONS.floor),
  ];
  return client.replyMessage(replyToken, { type: 'text', text: '1/9 住宅の階数を選んでください', quickReply: quickReply(items) });
}
async function askQ2(replyToken) {
  const layouts = ['1DK','1LDK','2DK','2LDK','3DK','3LDK','4DK','4LDK','5DK','5LDK'];
  const items = layouts.map(l => actionItem(l, qs.stringify({ q: 2, v: l }), ICONS.layout));
  return client.replyMessage(replyToken, { type: 'text', text: '2/9 住宅の間取りを選んでください', quickReply: quickReply(items) });
}
async function askQ3(replyToken) {
  const items = [
    actionItem('外壁塗装', qs.stringify({ q: 3, v: '外壁塗装' }), ICONS.paint),
    actionItem('屋根塗装', qs.stringify({ q: 3, v: '屋根塗装' }), ICONS.paint),
    actionItem('外壁＋屋根', qs.stringify({ q: 3, v: '外壁塗装＋屋根塗装' }), ICONS.paint, '外壁塗装＋屋根塗装'),
  ];
  return client.replyMessage(replyToken, { type: 'text', text: '3/9 希望する工事内容を選んでください', quickReply: quickReply(items) });
}
async function askQ4(replyToken) {
  const items = [
    actionItem('ある', qs.stringify({ q: 4, v: 'ある' }), ICONS.yes),
    actionItem('ない', qs.stringify({ q: 4, v: 'ない' }), ICONS.no),
    actionItem('わからない', qs.stringify({ q: 4, v: 'わからない' }), ICONS.no),
  ];
  return client.replyMessage(replyToken, { type: 'text', text: '4/9 これまで外壁塗装をしたことはありますか？', quickReply: quickReply(items) });
}
async function askQ5(replyToken) {
  const years = ['1〜5年','5〜10年','10〜15年','15〜20年','20〜30年','30〜40年','40年以上','0年（新築）'];
  const items = years.map(y => actionItem(y, qs.stringify({ q: 5, v: y }), ICONS.years));
  return client.replyMessage(replyToken, { type: 'text', text: '5/9 前回の外壁塗装からどのくらい経っていますか？', quickReply: quickReply(items) });
}
async function askQ6(replyToken) {
  const items = ['モルタル','サイディング','タイル','ALC'].map(v => actionItem(v, qs.stringify({ q: 6, v }), ICONS.wall));
  return client.replyMessage(replyToken, { type: 'text', text: '6/9 外壁の種類を選んでください', quickReply: quickReply(items) });
}
async function askQ7(replyToken) {
  const items = ['瓦','スレート','ガルバリウム','トタン'].map(v => actionItem(v, qs.stringify({ q: 7, v }), ICONS.roof));
  return client.replyMessage(replyToken, { type: 'text', text: '7/9 屋根の種類を選んでください', quickReply: quickReply(items) });
}
async function askQ8(replyToken) {
  const items = ['雨の日に水滴が落ちる','天井にシミがある','雨漏りはない'].map(v => actionItem(v, qs.stringify({ q: 8, v }), ICONS.leak));
  return client.replyMessage(replyToken, { type: 'text', text: '8/9 雨漏りの状況を選んでください', quickReply: quickReply(items) });
}
async function askQ9(replyToken) {
  const items = ['30cm以下','50cm以下','70cm以下','70cm以上'].map(v => actionItem(v, qs.stringify({ q: 9, v }), ICONS.distance));
  return client.replyMessage(replyToken, { type: 'text', text: '9/9 周辺との最短距離を選んでください（足場設置の目安）', quickReply: quickReply(items) });
}

// ========== 概算ロジック ==========
function estimateCost(a) {
  const base = { '外壁塗装': 700000, '屋根塗装': 300000, '外壁塗装＋屋根塗装': 900000 };
  const floors = { '1階建て': 1.0, '2階建て': 1.2, '3階建て': 1.4 };
  const layout = {
    '1DK': 0.9, '1LDK': 0.95, '2DK': 1.0, '2LDK': 1.05,
    '3DK': 1.1, '3LDK': 1.15, '4DK': 1.2, '4LDK': 1.25,
    '5DK': 1.3, '5LDK': 1.35,
  };
  const wall = { 'モルタル': 1.05, 'サイディング': 1.0, 'タイル': 1.15, 'ALC': 1.1 };
  const roof = { '瓦': 1.1, 'スレート': 1.0, 'ガルバリウム': 1.05, 'トタン': 0.95 };
  const leak = { '雨の日に水滴が落ちる': 1.15, '天井にシミがある': 1.1, '雨漏りはない': 1.0 };
  const dist = { '30cm以下': 1.2, '50cm以下': 1.15, '70cm以下': 1.1, '70cm以上': 1.0 };

  let cost = base[a.q3] || 600000;
  cost *= floors[a.q1] || 1.0;
  cost *= layout[a.q2] || 1.0;
  cost *= wall[a.q6] || 1.0;
  cost *= leak[a.q8] || 1.0;
  cost *= dist[a.q9] || 1.0;
  if (a.q3 === '屋根塗装' || a.q3 === '外壁塗装＋屋根塗装') cost *= roof[a.q7] || 1.0;

  return Math.round(cost / 1000) * 1000;
}
const yen = (n) => n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

// ========== 詳細入力UI ==========
function detailEntryFlex() {
  return {
    type: 'flex',
    altText: '具体的な見積もりをご希望の方はこちら',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '具体的な見積もりが欲しい方はこちら', weight: 'bold', wrap: true },
          { type: 'text', text: 'お名前とご住所の入力で、担当よりご案内します。', wrap: true, size: 'sm', color: '#666' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'button', style: 'primary', action: { type: 'postback', label: '入力をはじめる', data: 'detail=1' } },
        ],
      },
    },
  };
}

async function startDetailFlow(userId, replyToken) {
  const s = getSession(userId);
  s.mode = 'detail';
  s.detail = { stage: 'name', name: '', postal: '', address1: '', address2: '', logged: false };

  // リッチメニュー一時非表示（任意）
  try { await client.unlinkRichMenuFromUser(userId); } catch(_) {}

  return replyText(replyToken,
    '【お見積りに必要な情報】\nお名前をご入力ください。\n（例：山田 太郎）'
  );
}

async function handleDetailText(userId, replyToken, text) {
  const s = getSession(userId);
  if (!s.detail) s.detail = { stage: 'name', name: '', postal: '', address1: '', address2: '', logged: false };

  // 1) お名前
  if (s.detail.stage === 'name') {
    const name = text.replace(/\s+/g, ' ').trim();
    if (!name || name.length < 2) return replyText(replyToken, 'お名前をフルネームでご入力ください。');
    s.detail.name = name;
    s.detail.stage = 'zip';
    return replyText(replyToken, 'ありがとうございます。\n次に「郵便番号（7桁）」を入力してください。\n（例：1234567 もしくは 123-4567）');
  }

  // 2) 郵便番号→住所自動入力
  if (s.detail.stage === 'zip') {
    const zip = (text || '').replace(/[^\d]/g, '');
    if (!/^\d{7}$/.test(zip)) return replyText(replyToken, '郵便番号は7桁の数字で入力してください。（例：1234567）');
    s.detail.postal = zip;

    try {
      const r = await axios.get('https://zipcloud.ibsnet.co.jp/api/search', { params: { zipcode: zip } });
      const rs = r.data;
      if (rs && rs.results && rs.results.length > 0) {
        const x = rs.results[0];
        const address1 = `${x.address1 || ''}${x.address2 || ''}${x.address3 || ''}`;
        s.detail.address1 = address1;
        s.detail.stage = 'addr2';
        return replyText(replyToken,
          `住所を自動入力しました：\n【${address1}】\n\n続きの番地・建物名・部屋番号を入力してください。\n（例：1-2-3 サンプルマンション101号）`
        );
      } else {
        return replyText(replyToken, '住所が見つかりませんでした。郵便番号をもう一度ご入力ください。');
      }
    } catch (e) {
      console.error('ZipCloud error:', e?.response?.data || e?.message || e);
      return replyText(replyToken, '住所検索に失敗しました。通信環境をご確認のうえ、もう一度お試しください。');
    }
  }

  // 3) 住所の続き → 完了
  if (s.detail.stage === 'addr2') {
    const addr2 = text.trim();
    if (!addr2) return replyText(replyToken, '番地・建物名・部屋番号をご入力ください。');
    s.detail.address2 = addr2;
    s.detail.stage = 'done';

    const fullAddress = `${s.detail.address1}${s.detail.address2 ? ' ' + s.detail.address2 : ''}`;
    const done = [
      '【入力内容】',
      `・お名前：${s.detail.name}`,
      `・郵便番号：${s.detail.postal}`,
      `・ご住所：${fullAddress}`,
      '',
      'ありがとうございました！担当者より順次ご案内いたします。',
      '最初からやり直す場合は「リセット」と送ってください。',
    ].join('\n');

    // リッチメニュー復帰（任意）
    if (RICH_MENU_ID_MAIN) {
      try { await client.linkRichMenuToUser(userId, RICH_MENU_ID_MAIN); } catch(_) {}
    }

    // ---- ここでだけ Sheets に書く（重複防止フラグ付き） ----
    if (useSheets && !s.detail.logged) {
      try {
        await appendToSheet(userId, s);
        s.detail.logged = true;
      } catch (e) {
        console.error('appendToSheet error:', e?.response?.data || e?.message || e);
      }
    }

    return replyText(replyToken, done);
  }
}

// ========== 結果は push で送る ==========
async function pushEstimate(userId) {
  const s = getSession(userId);
  const a = s.answers;

  const estimate = estimateCost(a);
  const summary =
    '【回答の確認】\n' +
    `・階数: ${a.q1 || '-'}\n・間取り: ${a.q2 || '-'}\n・工事内容: ${a.q3 || '-'}\n` +
    `・過去の外壁塗装: ${a.q4 || '-'}\n・前回からの年数: ${a.q5 || '該当なし'}\n` +
    `・外壁種類: ${a.q6 || '-'}\n・屋根種類: ${a.q7 || '-'}\n` +
    `・雨漏り: ${a.q8 || '-'}\n・周辺距離: ${a.q9 || '-'}`;

  const disclaimer = '※表示金額は概算の目安です。実際の建物形状・劣化状況・足場条件・使用塗料により変動します。';

  const msgs = [
    { type: 'text', text: summary },
    { type: 'text', text: `概算金額：${yen(estimate)}\n\n${disclaimer}` },
    detailEntryFlex(),
  ];

  try {
    await client.pushMessage(userId, msgs);
  } catch (err) {
    console.error('pushEstimate error:', err?.response?.data || err?.message || err);
    // フォールバック（テキストのみ）
    try {
      await client.pushMessage(userId, [
        { type: 'text', text: summary },
        { type: 'text', text: `概算金額：${yen(estimate)}\n\n${disclaimer}\n\n「具体的な見積もり」を希望する方は「詳細」と送ってください。` },
      ]);
    } catch (e2) {
      console.error('pushEstimate fallback error:', e2?.response?.data || e2?.message || e2);
    }
  }
}

// ========== Sheets: 完了時のみ追記 ==========
async function appendToSheet(userId, s) {
  if (!useSheets || !sheets) return;

  const a = s.answers;
  const estimate = estimateCost(a);
  const when = new Date(); // UTC
  const jst = new Date(when.getTime() + 9 * 60 * 60 * 1000); // JST表示用

  const row = [
    jst.toISOString().replace('T', ' ').replace('Z', ''), // タイムスタンプ(JST擬似)
    userId,
    s.detail?.name || '',
    s.detail?.postal || '',
    s.detail?.address1 || '',
    s.detail?.address2 || '',
    a.q1 || '',
    a.q2 || '',
    a.q3 || '',
    a.q4 || '',
    a.q5 || '',
    a.q6 || '',
    a.q7 || '',
    a.q8 || '',
    a.q9 || '',
    estimate,
    JSON.stringify(a),
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

// ========== イベント処理 ==========
async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === 'follow') {
    resetSession(userId);
    return replyText(
      event.replyToken,
      '友だち追加ありがとうございます！\n外壁・屋根塗装の【かんたん概算見積り】をご案内します。\nはじめますか？「見積もり」または「スタート」を送ってください。'
    );
  }

  if (event.type === 'message') {
    const s = getSession(userId);
    const msg = event.message;

    // 画像は未使用
    if (msg.type === 'image') {
      return replyText(event.replyToken, '画像のアップロードは不要です。ボタンまたはテキスト入力で進めてください。');
    }

    if (msg.type === 'text') {
      const t = (msg.text || '').trim();

      // 共通コマンド
      if (/^(見積もり|スタート|start)$/i.test(t)) {
        resetSession(userId);
        return askQ1(event.replyToken, userId);
      }
      if (/^(最初から|リセット)$/i.test(t)) {
        resetSession(userId);
        return replyText(event.replyToken, 'リセットしました。「見積もり」と送ってください。');
      }

      // 詳細入力フロー中のテキスト
      if (s.mode === 'detail' && s.detail && s.detail.stage) {
        return handleDetailText(userId, event.replyToken, t);
      }

      // 「詳細」と送ったらフロー開始（ボタン押下の代替）
      if (/^(詳細|入力|見積もり希望)$/i.test(t)) {
        return startDetailFlow(userId, event.replyToken);
      }

      // それ以外の自由テキストは無視（＝有人チャットで対応）
      return;
    }

    return;
  }

  if (event.type === 'postback') {
    const data = qs.parse(event.postback.data || '');

    // 詳細入力開始
    if (data.detail === '1') {
      return startDetailFlow(userId, event.replyToken);
    }

    // 質問回答
    const q = Number(data.q);
    const v = data.v;
    if (!q || typeof v === 'undefined') {
      return replyText(event.replyToken, '入力を受け取れませんでした。もう一度お試しください。');
    }

    const s = getSession(userId);
    s.answers[`q${q}`] = v;

    // Q4：ない／わからない → Q5スキップ
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
      case 10:
        // 重要：まず軽い1通だけreply → 結果はpushで安全に
        await replyText(event.replyToken, '集計中です…');
        await pushEstimate(userId);
        return;
      default:
        await replyText(event.replyToken, '集計中です…');
        await pushEstimate(userId);
        return;
    }
  }
}
