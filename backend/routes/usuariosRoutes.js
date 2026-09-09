const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const {
  normalizarUsername,
  validarUsername,
  hashPassword,
  generarPasswordTemporal,
  usuarioSeguro
} = require('../utils/security');
const {
  autenticarUsuario,
  requerirRol,
  requerirPasswordActualizado
} = require('../middleware/auth');

router.use(autenticarUsuario, requerirPasswordActualizado, requerirRol('ADMIN'));

router.get('/', async (_req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      select: {
        id: true,
        nombre: true,
        username: true,
        email: true,
        rol: true,
        activo: true,
        debeCambiarPassword: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true
      }
    });
    res.json({ success: true, data: usuarios });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ success: false, message: 'Error al obtener los usuarios' });
  }
});

router.post('/', async (req, res) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    const username = normalizarUsername(req.body.username);
    const email = req.body.email ? normalizarUsername(req.body.email) : null;
    const rol = String(req.body.rol || 'EMPLEADO').trim().toUpperCase();

    if (nombre.length < 2 || nombre.length > 100) {
      return res.status(400).json({ success: false, message: 'Nombre inválido' });
    }
    if (!validarUsername(username)) {
      return res.status(400).json({
        success: false,
        message: 'El usuario debe tener 3-40 caracteres y usar solo letras, números, punto, guion o guion bajo'
      });
    }
    if (!['ADMIN', 'EMPLEADO'].includes(rol)) {
      return res.status(400).json({ success: false, message: 'Rol inválido' });
    }

    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = await hashPassword(passwordTemporal);

    const creado = await prisma.usuario.create({
      data: {
        nombre,
        username,
        email,
        password: null,
        passwordHash,
        rol,
        activo: true,
        debeCambiarPassword: true
      }
    });

    res.status(201).json({
      success: true,
      data: usuarioSeguro(creado),
      temporaryPassword: passwordTemporal,
      message: 'Usuario creado. La contraseña temporal solo se muestra en esta respuesta.'
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'El nombre de usuario o correo ya está registrado' });
    }
    console.error('Error al crear usuario:', error);
    res.status(500).json({ success: false, message: 'No fue posible crear el usuario' });
  }
});

router.patch('/:id/estado', async (req, res) => {
  try {
    const activo = req.body.activo;
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ success: false, message: 'El campo activo debe ser booleano' });
    }
    if (req.params.id === req.usuario.id && !activo) {
      return res.status(400).json({ success: false, message: 'No puedes desactivar tu propia cuenta' });
    }

    const actualizado = await prisma.usuario.update({
      where: { id: req.params.id },
      data: { activo }
    });

    if (!activo) {
      await prisma.sesionAuth.updateMany({
        where: { usuarioId: actualizado.id, revocadaAt: null },
        data: { revocadaAt: new Date() }
      });
    }

    res.json({ success: true, data: usuarioSeguro(actualizado) });
  } catch (error) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    console.error('Error al cambiar estado de usuario:', error);
    res.status(500).json({ success: false, message: 'No fue posible actualizar el usuario' });
  }
});

router.post('/:id/reset-password', async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.params.id } });
    if (!usuario) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = await hashPassword(passwordTemporal);
    const ahora = new Date();

    await prisma.$transaction([
      prisma.usuario.update({
        where: { id: usuario.id },
        data: {
          passwordHash,
          password: null,
          debeCambiarPassword: true,
          passwordChangedAt: ahora
        }
      }),
      prisma.sesionAuth.updateMany({
        where: { usuarioId: usuario.id, revocadaAt: null },
        data: { revocadaAt: ahora }
      })
    ]);

    res.json({
      success: true,
      temporaryPassword: passwordTemporal,
      message: 'Contraseña restablecida. La contraseña temporal solo se muestra en esta respuesta.'
    });
  } catch (error) {
    console.error('Error al restablecer contraseña:', error);
    res.status(500).json({ success: false, message: 'No fue posible restablecer la contraseña' });
  }
});

module.exports = router;
