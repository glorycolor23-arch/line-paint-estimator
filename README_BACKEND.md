# Backend add-on (Step 1&2 untouched)

1) Place the `backend/` folder at your repo root.
2) In your Express entry (where `const app = express()` exists), BEFORE bodyParser:
   ```js
   import { registerBackendRoutes } from './backend/registerRoutes.js';
   registerBackendRoutes(app);
   ```
3) Keep your front-end files as-is. Endpoints enabled:
   - POST /api/estimate
   - GET  /auth/line/callback
   - POST /line/webhook
   - POST /api/details
