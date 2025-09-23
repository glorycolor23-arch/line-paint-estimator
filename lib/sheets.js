import { google } from 'googleapis';
import { CONFIG } from '../config.js';

function getAuth() {
  return new google.auth.JWT({
    email: CONFIG.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: CONFIG.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

export async function appendToSheet(rowValues) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  // A:日時 / B:leadId / C:LINE userId / D:見積もり希望内容 / E:築年数 / F:階数 / G:外壁材
  // H:概算金額 / I:氏名 / J:電話 / K:郵便 / L〜 附属情報（ファイル受領メモ等）
  const range = 'Sheet1!A:Z';
  const values = [rowValues];

  await sheets.spreadsheets.values.append({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });
}