
import { app } from './app.js';

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));
