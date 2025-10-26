// lib/sheets.js
import { google } from "googleapis";
import { CONFIG } from "../config.js";

/**
 * シート設定がなければスキップ（no-op）
 */
function canAppend() {
  return Boolean(
    CONFIG.GOOGLE_SHEETS_ID &&
    CONFIG.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    CONFIG.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
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
    console.log("[SHEETS] skipped (missing GSA/Sheet ID). values:", rowValues);
    return { ok: true, skipped: true };
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: "Sheet1!A:Z",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [rowValues] },
  });

  return { ok: true };
}
