const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const intentos = new Map();

function limpiarExpirados(ahora) {
  for (const [key, value] of intentos.entries()) {
    if (ahora - value.inicio >= WINDOW_MS) intentos.delete(key);
  }
}

function loginRateLimit(req, res, next) {
  const ahora = Date.now();
  if (intentos.size > 1000) limpiarExpirados(ahora);

  const identificador = String(req.body?.usuario || req.body?.username || '').trim().toLowerCase();
  const key = `${req.ip}|${identificador}`;
  const actual = intentos.get(key);

  if (!actual || ahora - actual.inicio >= WINDOW_MS) {
    intentos.set(key, { inicio: ahora, cantidad: 1 });
    return next();
  }

  if (actual.cantidad >= MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((WINDOW_MS - (ahora - actual.inicio)) / 1000);
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      success: false,
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde.'
    });
  }

  actual.cantidad += 1;
  intentos.set(key, actual);
  next();
}

function limpiarIntentosLogin(req) {
  const identificador = String(req.body?.usuario || req.body?.username || '').trim().toLowerCase();
  intentos.delete(`${req.ip}|${identificador}`);
}

module.exports = { loginRateLimit, limpiarIntentosLogin };
