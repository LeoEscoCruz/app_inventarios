const prisma = require('../config/db');
const { hashTokenSesion, usuarioSeguro } = require('../utils/security');

function extraerBearerToken(req) {
  const authorization = String(req.headers.authorization || '');
  const [tipo, token] = authorization.split(' ');
  if (tipo !== 'Bearer' || !token) return null;
  return token.trim();
}

async function autenticarUsuario(req, res, next) {
  try {
    const token = extraerBearerToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_REQUIRED',
        message: 'Debes iniciar sesión para continuar'
      });
    }

    const tokenHash = hashTokenSesion(token);
    const sesion = await prisma.sesionAuth.findUnique({
      where: { tokenHash },
      include: { usuario: true }
    });

    if (!sesion || sesion.revocadaAt || sesion.expiresAt <= new Date()) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_INVALID',
        message: 'La sesión no es válida o ha expirado'
      });
    }

    if (!sesion.usuario.activo) {
      return res.status(403).json({
        success: false,
        code: 'USER_DISABLED',
        message: 'La cuenta se encuentra deshabilitada'
      });
    }

    req.usuario = sesion.usuario;
    req.usuarioSeguro = usuarioSeguro(sesion.usuario);
    req.authSession = sesion;
    req.authTokenHash = tokenHash;
    next();
  } catch (error) {
    console.error('Error al autenticar usuario:', error);
    res.status(500).json({ success: false, message: 'No fue posible validar la sesión' });
  }
}

function requerirRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario || !rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'No tienes permisos para realizar esta acción'
      });
    }
    next();
  };
}

function requerirPasswordActualizado(req, res, next) {
  if (req.usuario?.debeCambiarPassword) {
    return res.status(403).json({
      success: false,
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'Debes cambiar tu contraseña temporal antes de continuar'
    });
  }
  next();
}

module.exports = {
  autenticarUsuario,
  requerirRol,
  requerirPasswordActualizado
};
