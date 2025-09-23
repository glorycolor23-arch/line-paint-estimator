
# Backend add-on (keeps your Step 1 & 2 front-end untouched)

- Put the `backend/` folder in your repo root.
- **Do not modify** your existing `index.html`, `styles.css`, or front `app.js`.
- Edit your existing `server.js` (or the file where you create `const app = express()`) and add:

```js
// 1) BEFORE bodyParser, register backend routes
import { registerBackendRoutes } from './backend/registerRoutes.js';
registerBackendRoutes(app);

// 2) THEN apply bodyParser, cookieParser, etc (existing order keeps working)
// NOTE: Webhook must be registered before bodyParser.
```

## Endpoints provided

- POST `/api/estimate` — save ① answers & compute estimate, returns `{leadId}`
- GET  `/auth/line/callback` — LINE Login callback (state=leadId link & push)
- POST `/line/webhook` — follow event -> push estimate & LIFF button
- POST `/api/details` — LIFF answers -> email + Google Sheets append + push ack
