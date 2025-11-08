// lib/sheets.js
import { google } from "googleapis";
import { CONFIG } from "../config.js";

/**
 * シート設定がなければスキップ（no-op）
 * 一時的に常にfalseを返してSheets連携を無効化
 */
function canAppend() {
  console.log('[SHEETS] Google Sheets integration is temporarily disabled');
  return false;
  
  // 元のコード（Sheets連携を有効化する場合はこちらを使用）
  // return Boolean(
  //   CONFIG.GOOGLE_SHEETS_ID &&
  //   CONFIG.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  //   CONFIG.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  // );
}

function getAuth() {
  return new google.auth.JWT({
    email: CONFIG.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: CONFIG.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export async function appendToSheet(rowValues) {
  if (!canAppend()) {
    console.log("[SHEETS] skipped (disabled or missing config). values:", rowValues);
    return { ok: true, skipped: true };
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
      range: "Sheet1!A:Z",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rowValues] },
    });

    return { ok: true };
  } catch (e) {
    console.error('[SHEETS] Error appending to sheet (non-fatal):', e.message);
    return { ok: false, error: e.message };
  }
}

