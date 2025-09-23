import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { client } from './lib/lineClient.js';
import { saveLink, savePending, getEstimate } from './lib/store.js';

const router = Router();
const TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) throw new Error('LINE Login error: ' + error);
    const leadId = state;

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.LINE_LOGIN_REDIRECT_URI,
      client_id: process.env.LINE_LOGIN_CHANNEL_ID,
      client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
    });
    const tokenRes = await axios.post(TOKEN_URL, params);
    const { id_token } = tokenRes.data || {};
    if (!id_token) throw new Error('No id_token');
    const decoded = jwt.decode(id_token);
    const userId = decoded?.sub;
    if (!userId) throw new Error('No userId');

    if (leadId) saveLink(userId, leadId);

    try {
      const est = getEstimate(leadId);
      if (est) {
        await client.pushMessage(userId, { type: 'text', text: est.text });
        const url = `${process.env.LIFF_URL}?lead=${encodeURIComponent(leadId)}`;
        await client.pushMessage(userId, {
          type: 'template',
          altText: '詳細見積もりを見る',
          template: { type: 'buttons', text: 'さらに詳しい見積もりを見る', actions: [{ type: 'uri', label: '開く', uri: url }] }
        });
      } else {
        await client.pushMessage(userId, { type: 'text', text: 'ログインありがとうございます。概算計算中です。少々お待ちください。' });
      }
    } catch (e) {
      if (leadId) savePending(userId, leadId);
    }

    res.status(200).send('ログインが完了しました。LINEトークをご確認ください。');
  } catch (e) {
    console.error(e);
    res.status(400).send('ログイン処理でエラーが発生しました。');
  }
});

export default router;
