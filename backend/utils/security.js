const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 128;
const MIN_PASSWORD_LENGTH = 10;

function normalizarUsername(valor) {
  return String(valor || '').trim().toLowerCase();
}

function validarUsername(username) {
  const value = normalizarUsername(username);
  if (value.length < 3 || value.length > 40) return false;
  return /^[a-z0-9._-]+$/.test(value);
}

function validarPassword(password) {
  return typeof password === 'string'
    && password.length >= MIN_PASSWORD_LENGTH
    && password.length <= MAX_PASSWORD_LENGTH;
}

async function hashPassword(password) {
  if (!validarPassword(password)) {
    throw new Error(`La contraseña debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres`);
  }

  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  });

  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    Buffer.from(derivedKey).toString('base64url')
  ].join('$');
}

async function verificarPassword(password, encodedHash) {
  try {
    if (typeof password !== 'string' || !encodedHash) return false;

    const [alg, n, r, p, saltEncoded, hashEncoded] = String(encodedHash).split('$');
    if (alg !== 'scrypt' || !saltEncoded || !hashEncoded) return false;

    const salt = Buffer.from(saltEncoded, 'base64url');
    const expected = Buffer.from(hashEncoded, 'base64url');
    const actual = Buffer.from(await scryptAsync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024
    }));

    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

function crearTokenSesion() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashTokenSesion(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function generarPasswordTemporal() {
  // 24 caracteres aprox.; se muestra una sola vez al administrador.
  return crypto.randomBytes(18).toString('base64url');
}

function usuarioSeguro(usuario) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    username: usuario.username,
    email: usuario.email,
    rol: usuario.rol,
    activo: usuario.activo,
    debeCambiarPassword: usuario.debeCambiarPassword,
    lastLoginAt: usuario.lastLoginAt,
    createdAt: usuario.createdAt
  };
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  normalizarUsername,
  validarUsername,
  validarPassword,
  hashPassword,
  verificarPassword,
  crearTokenSesion,
  hashTokenSesion,
  generarPasswordTemporal,
  usuarioSeguro
};
