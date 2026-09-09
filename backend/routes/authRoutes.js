const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const {
  normalizarUsername,
  validarPassword,
  hashPassword,
  verificarPassword,
  crearTokenSesion,
  hashTokenSesion,
  usuarioSeguro
} = require('../utils/security');
const { autenticarUsuario } = require('../middleware/auth');
const { loginRateLimit, limpiarIntentosLogin } = require('../middleware/loginRateLimit');

function horasSesion() {
  const valor = Number(process.env.SESSION_TTL_HOURS || 8);
  return Number.isFinite(valor) && valor >= 1 && valor <= 72 ? valor : 8;
}

// LOGIN: devuelve un token opaco. El token completo nunca se guarda en la BD.
router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const identificador = normalizarUsername(req.body.usuario || req.body.username || req.body.email);
    const password = req.body.password;

    if (!identificador || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'Usuario y contraseña son obligatorios' });
    }

    const usuario = await prisma.usuario.findFirst({
      where: {
        OR: [
          { username: identificador },
          { email: identificador }
        ]
      }
    });

    // Respuesta deliberadamente genérica para no revelar si una cuenta existe.
    if (!usuario || !usuario.activo || !usuario.passwordHash) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    const passwordValido = await verificarPassword(password, usuario.passwordHash);
    if (!passwordValido) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    limpiarIntentosLogin(req);

    const ahora = new Date();
    const expiresAt = new Date(ahora.getTime() + horasSesion() * 60 * 60 * 1000);
    const token = crearTokenSesion();
    const tokenHash = hashTokenSesion(token);

    // Limpieza ligera de sesiones antiguas del mismo usuario.
    await prisma.sesionAuth.deleteMany({
      where: {
        usuarioId: usuario.id,
        OR: [
          { expiresAt: { lt: ahora } },
          { revocadaAt: { not: null } }
        ]
      }
    });

    await prisma.$transaction([
      prisma.sesionAuth.create({
        data: {
          tokenHash,
          usuarioId: usuario.id,
          expiresAt,
          userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null
        }
      }),
      prisma.usuario.update({
        where: { id: usuario.id },
        data: { lastLoginAt: ahora }
      })
    ]);

    const usuarioActualizado = { ...usuario, lastLoginAt: ahora };
    res.json({
      success: true,
      token,
      expiresAt,
      user: usuarioSeguro(usuarioActualizado)
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ success: false, message: 'No fue posible iniciar sesión' });
  }
});

router.get('/me', autenticarUsuario, async (req, res) => {
  res.json({ success: true, user: req.usuarioSeguro, expiresAt: req.authSession.expiresAt });
});

router.post('/logout', autenticarUsuario, async (req, res) => {
  try {
    await prisma.sesionAuth.update({
      where: { id: req.authSession.id },
      data: { revocadaAt: new Date() }
    });
    res.json({ success: true, message: 'Sesión cerrada correctamente' });
  } catch (error) {
    console.error('Error al cerrar sesión:', error);
    res.status(500).json({ success: false, message: 'No fue posible cerrar la sesión' });
  }
});

router.post('/change-password', autenticarUsuario, async (req, res) => {
  try {
    const currentPassword = req.body.currentPassword;
    const newPassword = req.body.newPassword;

    if (!validarPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe tener entre 10 y 128 caracteres'
      });
    }

    if (newPassword === currentPassword) {
      return res.status(400).json({ success: false, message: 'La nueva contraseña debe ser diferente' });
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario?.passwordHash || !(await verificarPassword(currentPassword, usuario.passwordHash))) {
      return res.status(401).json({ success: false, message: 'La contraseña actual es incorrecta' });
    }

    const passwordHash = await hashPassword(newPassword);
    const ahora = new Date();

    await prisma.$transaction([
      prisma.usuario.update({
        where: { id: usuario.id },
        data: {
          passwordHash,
          password: null,
          debeCambiarPassword: false,
          passwordChangedAt: ahora
        }
      }),
      prisma.sesionAuth.updateMany({
        where: {
          usuarioId: usuario.id,
          id: { not: req.authSession.id },
          revocadaAt: null
        },
        data: { revocadaAt: ahora }
      })
    ]);

    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({ success: false, message: 'No fue posible cambiar la contraseña' });
  }
});

module.exports = router;
