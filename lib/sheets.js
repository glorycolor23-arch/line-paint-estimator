// lib/sheets.js
import { google } from "googleapis";
import { CONFIG } from "../config.js";

function getAuth() {
  return new google.auth.JWT({
    email: CONFIG.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: CONFIG.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export async function appendToSheet(row) {
  if (!CONFIG.GOOGLE_SHEETS_ID) return;
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: CONFIG.GOOGLE_SHEETS_ID,
    range: "Sheet1!A:Z",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}
