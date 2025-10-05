// middleware/request-logger.js
export function requestLogger(req, _res, next) {
  const t0 = Date.now();
  const { method, url } = req;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[REQ] ${method} ${url} from ${ip}`);
  _res.on('finish', () => {
    console.log(`[RES] ${method} ${url} -> ${_res.statusCode} (${Date.now()-t0}ms)`);
  });
  next();
}
