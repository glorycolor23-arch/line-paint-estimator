// routes/selftest.js
import { Router } from "express";

const router = Router();

// 動作確認用: https://<host>/__selftest
router.get("/__selftest", (_req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    envpresent: {
      PORT: !!process.env.PORT,
      LIFF_ID: !!process.env.LIFF_ID,
      LIFF_URL: !!process.env.LIFF_URL,
      LINE_CHANNEL_ACCESS_TOKEN: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
      LINE_CHANNEL_SECRET: !!process.env.LINE_CHANNEL_SECRET,
      LINE_LOGIN_CHANNEL_ID: !!process.env.LINE_LOGIN_CHANNEL_ID,
      LINE_LOGIN_REDIRECT_URI: !!process.env.LINE_LOGIN_REDIRECT_URI,
    },
  });
});

export default router;
