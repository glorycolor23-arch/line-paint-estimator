
import { google } from 'googleapis';
function jwt(){
  const email = process.env.GOOGLE_SERVICE_ACCOUNT || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if(!email || !key) return null;
  key = key.replace(/\n/g,'\n'); // keep as-is; environment may already provide real newlines
  return new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
}
export async function appendSheet(values){
  try{
    const auth = jwt(); if(!auth) return {ok:false, reason:'NO_GSA'};
    const sheets = google.sheets({version:'v4', auth});
    const res = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: 'A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values:[values] }
    });
    return { ok:true, res };
  }catch(e){ console.error(e); return { ok:false, reason:e.message }; }
}
