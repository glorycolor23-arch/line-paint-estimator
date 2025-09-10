const { Client, middleware } = require('@line/bot-sdk');
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const ftp = require('basic-ftp');
const app = express();
const PORT = process.env.PORT || 10000;

// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'dummy_token',
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'dummy_secret',
};

// 環境変数チェック
const requiredEnvVars = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  // 他の必要な環境変数
];

// 環境変数の検証
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`警告: 環境変数 ${envVar} が設定されていません。`);
  }
}

// LINEクライアントの初期化
const client = new Client(config);

// ミドルウェアの設定
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静的ファイル配信の設定（新システム用）
app.use(express.static('public'));

// LIFFアプリ用の静的ファイル配信
app.use('/liff', express.static('liff'));

// ファイルアップロード設定
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB制限
});

// ===== FTP画像アップロード機能 =====

// FTPサーバーにファイルをアップロードする関数
async function uploadToFtp(localFilePath, remoteFileName) {
  const client = new ftp.Client();
  client.ftp.verbose = false; // デバッグ出力を無効化
  
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      secure: process.env.FTP_SECURE === 'true' // FTPSを使用する場合はtrue
    });
    
    console.log('[INFO] FTPサーバーに接続しました');
    
    // リモートディレクトリが存在することを確認
    try {
      await client.ensureDir(process.env.FTP_PATH);
    } catch (err) {
      console.log('[WARN] ディレクトリの作成に失敗しました:', err.message);
      // ディレクトリが存在しない場合は作成を試みる
      try {
        await client.makeDir(process.env.FTP_PATH);
      } catch (createErr) {
        console.log('[WARN] ディレクトリの作成もできませんでした:', createErr.message);
      }
    }
    
    // ファイルをアップロード
    await client.uploadFrom(localFilePath, process.env.FTP_PATH + remoteFileName);
    console.log(`[INFO] ファイルをアップロードしました: ${remoteFileName}`);
    
    // 画像のURLを返す
    return `${process.env.FTP_URL}${remoteFileName}`;
  } catch(err) {
    console.error('[ERROR] FTPアップロードエラー:', err);
    throw err;
  } finally {
    client.close();
  }
}

// 複数の画像をアップロードする関数
async function uploadMultipleImages(files) {
  const uploadPromises = [];
  const uploadedUrls = {};
  
  for (const fieldName in files) {
    const file = files[fieldName][0]; // multerは配列で返すため
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}_${path.basename(file.originalname)}`;
    
    uploadPromises.push(
      uploadToFtp(file.path, fileName)
        .then(url => {
          uploadedUrls[fieldName] = url;
          // アップロード後に一時ファイルを削除
          cleanupTempFile(file.path);
        })
        .catch(err => {
          console.error(`[ERROR] ${fieldName}のアップロードに失敗:`, err);
          uploadedUrls[fieldName] = null;
          // エラーでも一時ファイルは削除
          cleanupTempFile(file.path);
        })
    );
  }
  
  await Promise.all(uploadPromises);
  return uploadedUrls;
}

// 一時ファイルを削除する関数
function cleanupTempFile(filePath) {
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error(`[ERROR] 一時ファイルの削除に失敗: ${filePath}`, err);
    } else {
      console.log(`[INFO] 一時ファイルを削除しました: ${filePath}`);
    }
  });
}

// FTP設定のチェック
if (process.env.FTP_HOST && process.env.FTP_USER && process.env.FTP_PASS) {
  console.log('[INFO] FTP設定完了');
} else {
  console.warn('[WARN] FTP環境変数が未設定です。画像アップロード機能は無効化されます。');
}

// ===== セッション管理（新システム用） =====
const sessions = {};

// セッションIDの生成関数
function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// 概算見積もり計算関数
function calculateEstimate(formData) {
  // 基本情報の取得
  const floors = formData.floors;
  const layout = formData.layout;
  const buildingAge = formData.buildingAge;
  const paintHistory = formData.paintHistory;
  const paintAge = formData.paintAge;
  const workType = formData.workType;
  const wallMaterial = formData.wallMaterial;
  const roofMaterial = formData.roofMaterial;
  const leakage = formData.leakage;
  const neighborDistance = formData.neighborDistance;
  const paintGrade = formData.paintGrade;
  
  // 面積の計算（仮の計算式）
  let area = 0;
  
  // 階数による基本面積
  if (floors === '1階建て') {
    area = 120; // 1階建ての基本面積（m²）
  } else if (floors === '2階建て') {
    area = 180; // 2階建ての基本面積（m²）
  } else if (floors === '3階建て') {
    area = 240; // 3階建ての基本面積（m²）
  }
  
  // 間取りによる調整
  if (layout.includes('1')) {
    area *= 0.8; // 1Kなどの小さい間取り
  } else if (layout.includes('2')) {
    area *= 0.9; // 2Kなどの間取り
  } else if (layout.includes('3')) {
    area *= 1.0; // 3Kなどの間取り
  } else if (layout.includes('4')) {
    area *= 1.1; // 4Kなどの大きい間取り
  }
  
  // 単価の設定
  let unitPrice = 0;
  if (paintGrade === 'コストが安い塗料') {
    unitPrice = 2500; // 1m²あたり2,500円
  } else if (paintGrade === '一般的な塗料') {
    unitPrice = 3500; // 1m²あたり3,500円
  } else if (paintGrade === '耐久性が高い塗料') {
    unitPrice = 4500; // 1m²あたり4,500円
  } else if (paintGrade === '遮熱性が高い塗料') {
    unitPrice = 5000; // 1m²あたり5,000円
  }
  
  // 工事内容による調整
  let wallCost = 0;
  let roofCost = 0;
  
  if (workType === '外壁塗装のみ' || workType === '外壁・屋根塗装') {
    wallCost = area * unitPrice;
  }
  
  if (workType === '屋根塗装のみ' || workType === '外壁・屋根塗装') {
    // 屋根面積は外壁面積の約40%と仮定
    const roofArea = area * 0.4;
    roofCost = roofArea * unitPrice * 0.8; // 屋根は単価が少し安い
  }
  
  // 築年数による調整係数
  let ageFactor = 1.0;
  if (buildingAge === '新築') {
    ageFactor = 0.9; // 新築は比較的簡単
  } else if (buildingAge === '〜50年') {
    ageFactor = 1.2; // 古い建物は追加作業が必要
  }
  
  // 雨漏りによる追加コスト
  let leakageCost = 0;
  if (leakage === '雨の日に水滴が落ちる') {
    leakageCost = 100000; // 雨漏り修理の追加費用
  } else if (leakage === '天井にシミがある') {
    leakageCost = 50000; // 軽度の雨漏り修理
  }
  
  // 隣家との距離による作業難易度調整
  let distanceFactor = 1.0;
  if (neighborDistance === '30cm以下') {
    distanceFactor = 1.2; // 非常に狭い
  } else if (neighborDistance === '50cm以下') {
    distanceFactor = 1.1; // 狭い
  } else if (neighborDistance === '70cm以下') {
    distanceFactor = 1.05; // やや狭い
  }
  
  // 総コストの計算
  const baseCost = (wallCost + roofCost) * ageFactor * distanceFactor;
  const totalCost = Math.round((baseCost + leakageCost) / 10000) * 10000; // 1万円単位に丸める
  
  // 内訳の計算
  const details = {
    wallCost: Math.round(wallCost),
    roofCost: Math.round(roofCost),
    leakageCost: leakageCost,
    ageFactor: ageFactor,
    distanceFactor: distanceFactor,
    area: Math.round(area)
  };
  
  return {
    totalCost: totalCost,
    details: details
  };
}

// ===== 新システム用APIエンドポイント =====

// セッション作成API
app.post('/api/create-session', (req, res) => {
  const sessionId = generateSessionId();
  sessions[sessionId] = { createdAt: new Date() };
  res.json({ success: true, sessionId });
});

// フォームデータ保存API
app.post('/api/save-form-data', (req, res) => {
  const { sessionId, formData } = req.body;
  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({ success: false, message: 'セッションが無効です' });
  }
  
  sessions[sessionId].formData = formData;
  
  // 概算見積もり計算
  const estimateResult = calculateEstimate(formData);
  sessions[sessionId].estimateResult = estimateResult;
  
  res.json({ success: true, estimateResult });
});

// セッションデータ取得API
app.get('/api/get-session-data/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({ success: false, message: 'セッションが無効です' });
  }
  
  res.json({ 
    success: true, 
    data: sessions[sessionId].formData,
    estimateResult: sessions[sessionId].estimateResult
  });
});

// LINE連携API
app.post('/api/link-session-to-line', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({ success: false, message: 'セッションが無効です' });
  }
  
  // セッションにLINE連携フラグを設定
  sessions[sessionId].lineLinked = true;
  
  res.json({ success: true });
});

// 詳細見積もり依頼API
app.post('/api/submit-detail-request', upload.fields([
  { name: 'photoFront', maxCount: 1 },
  { name: 'photoBack', maxCount: 1 },
  { name: 'photoLeft', maxCount: 1 },
  { name: 'photoRight', maxCount: 1 },
  { name: 'photoRoof', maxCount: 1 },
  { name: 'photoDamage', maxCount: 1 }
]), async (req, res) => {
  try {
    const { customerData } = req.body;
    const parsedCustomerData = JSON.parse(customerData);
    const sessionId = parsedCustomerData.sessionId || req.body.sessionId;
    
    // ファイルのアップロード処理
    const uploadedFiles = req.files;
    let photoUrls = {};
    
    // FTPサーバーに画像をアップロード
    if (uploadedFiles && Object.keys(uploadedFiles).length > 0) {
      try {
        console.log('[INFO] 写真のアップロードを開始します');
        photoUrls = await uploadMultipleImages(uploadedFiles);
        console.log('[INFO] 写真のアップロードに成功しました:', photoUrls);
      } catch (err) {
        console.error('[ERROR] 写真のアップロードに失敗しました:', err);
        // FTPアップロードに失敗した場合はローカルパスを使用
        for (const [fieldName, files] of Object.entries(uploadedFiles)) {
          if (files && files.length > 0) {
            photoUrls[fieldName] = `/uploads/${path.basename(files[0].path)}`;
          }
        }
      }
    }
    
    // セッションデータの取得
    const sessionData = sessionId && sessions[sessionId] ? sessions[sessionId] : null;
    
    // Google Sheetsにデータを保存
    try {
      const sheetsData = {
        timestamp: new Date().toISOString(),
        name: parsedCustomerData.name,
        phone: parsedCustomerData.phone,
        email: parsedCustomerData.email || '',
        address: parsedCustomerData.address,
        sessionId: sessionId,
        photoUrls: JSON.stringify(photoUrls),
        formData: sessionData ? JSON.stringify(sessionData.formData) : '',
        estimateResult: sessionData ? JSON.stringify(sessionData.estimateResult) : ''
      };
      
      console.log('[INFO] Google Sheetsにデータを保存します');
      
      // Google Sheets API設定
      if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
        const auth = new google.auth.GoogleAuth({
          credentials: {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
          },
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        
        const sheets = google.sheets({ version: 'v4', auth });
        
        // スプレッドシートに行を追加
        const values = [
          [
            sheetsData.timestamp,
            sheetsData.name,
            sheetsData.phone,
            sheetsData.email,
            sheetsData.address,
            sheetsData.sessionId,
            sheetsData.photoUrls,
            sheetsData.formData,
            sheetsData.estimateResult
          ]
        ];
        
        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env.GSHEET_SPREADSHEET_ID,
          range: `${process.env.GSHEET_SHEET_NAME || 'Sheet1'}!A:I`,
          valueInputOption: 'RAW',
          resource: { values },
        });
        
        console.log('[INFO] Google Sheetsへの保存に成功しました');
      } else {
        console.warn('[WARN] Google Sheets環境変数が未設定です');
      }
      
    } catch (sheetsError) {
      console.error('[ERROR] Google Sheetsへの保存に失敗:', sheetsError);
    }
    
    // LINE通知を送信
    if (parsedCustomerData.lineId) {
      try {
        await client.pushMessage(parsedCustomerData.lineId, {
          type: 'text',
          text: `詳細見積もり依頼を受け付けました。\n\nお名前: ${parsedCustomerData.name}\n電話番号: ${parsedCustomerData.phone}\n住所: ${parsedCustomerData.address}\n\n担当者より2営業日以内にご連絡いたします。`
        });
        console.log('[INFO] LINE通知を送信しました');
      } catch (lineError) {
        console.error('[ERROR] LINE通知の送信に失敗:', lineError);
      }
    }
    
    // メール送信
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.EMAIL_TO) {
      try {
        const transporter = nodemailer.createTransporter({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
          }
        });
        
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: process.env.EMAIL_TO,
          subject: '【外壁塗装見積もり】新しい詳細見積もり依頼',
          html: `
            <h2>新しい詳細見積もり依頼が届きました</h2>
            <h3>お客様情報</h3>
            <ul>
              <li><strong>お名前:</strong> ${parsedCustomerData.name}</li>
              <li><strong>電話番号:</strong> ${parsedCustomerData.phone}</li>
              <li><strong>メールアドレス:</strong> ${parsedCustomerData.email || '未入力'}</li>
              <li><strong>住所:</strong> ${parsedCustomerData.address}</li>
              <li><strong>セッションID:</strong> ${sessionId}</li>
            </ul>
            
            <h3>アップロードされた写真</h3>
            <ul>
              ${Object.entries(photoUrls).map(([key, url]) => 
                `<li><strong>${key}:</strong> <a href="${url}" target="_blank">${url}</a></li>`
              ).join('')}
            </ul>
            
            <h3>フォームデータ</h3>
            <pre>${sessionData ? JSON.stringify(sessionData.formData, null, 2) : '未取得'}</pre>
            
            <h3>概算見積もり結果</h3>
            <pre>${sessionData ? JSON.stringify(sessionData.estimateResult, null, 2) : '未取得'}</pre>
            
            <p><strong>対応期限:</strong> 2営業日以内</p>
          `
        };
        
        await transporter.sendMail(mailOptions);
        console.log('[INFO] メール送信に成功しました');
      } catch (emailError) {
        console.error('[ERROR] メール送信に失敗:', emailError);
      }
    } else {
      console.warn('[WARN] メール設定が未完了です');
    }
    
    res.json({ 
      success: true, 
      message: '詳細見積もり依頼を受け付けました',
      photoUrls: photoUrls
    });
  } catch (error) {
    console.error('[ERROR] 詳細見積もり依頼エラー:', error);
    res.status(500).json({ success: false, message: 'サーバーエラーが発生しました' });
  }
});

// ===== 既存のLINE Webhook =====

// LINE Webhook
app.post('/webhook', middleware(config), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(async (event) => {
      // 友達登録イベント
      if (event.type === 'follow') {
        const userId = event.source.userId;
        
        // ウェルカムメッセージを送信
        await client.pushMessage(userId, {
          type: 'text',
          text: `友達登録ありがとうございます！外壁塗装の概算見積もりを確認できます。`
        });
        
        // 新システムとの連携（必要に応じて）
        // ...
      }
      
      // メッセージイベント
      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        const messageText = event.message.text;
        
        // メッセージに応じた処理
        if (messageText.includes('見積もり') || messageText.includes('相談')) {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `外壁塗装の見積もりをご希望ですね。以下のURLから質問に答えて、概算見積もりを確認できます。\n\nhttps://your-domain.com/`
          });
        } else {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `メッセージありがとうございます。外壁塗装に関するご質問があればお気軽にどうぞ。`
          });
        }
      }
    }));
    
    res.status(200).end();
  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).end();
  }
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

