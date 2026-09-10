const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const {
  autenticarUsuario,
  requerirRol,
  requerirPasswordActualizado
} = require('../middleware/auth');
const {
  obtenerSesionInventarioActiva,
  obtenerResumenSesion,
  construirResumenPorDia,
  iniciarNuevaSesionInventario,
  finalizarSesionInventarioActiva
} = require('../services/inventarioSessionService');
const { emitirEventoInventario } = require('../services/inventarioEvents');

router.use(autenticarUsuario, requerirPasswordActualizado);

const includeCapturaHistoricaAdmin = {
  producto: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      precio: true,
      seccion: true,
      categoria: true
    }
  },
  usuario: {
    select: {
      id: true,
      nombre: true,
      username: true,
      email: true,
      rol: true
    }
  }
};

// SESIÓN ACTIVA
// Puede devolver data: null después de finalizar un inventario y antes de iniciar el siguiente.
router.get('/activa', async (_req, res) => {
  try {
    const sesion = await obtenerSesionInventarioActiva();
    if (!sesion) {
      return res.json({ success: true, data: null });
    }

    const resumen = await obtenerResumenSesion(sesion.id);

    res.json({
      success: true,
      data: {
        id: sesion.id,
        nombre: sesion.nombre,
        estado: sesion.estado,
        fechaInicio: sesion.fechaInicio,
        fechaFin: sesion.fechaFin,
        resumen
      }
    });
  } catch (error) {
    console.error('Error al obtener la sesión de inventario activa:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el inventario activo' });
  }
});

// INICIAR INVENTARIO - SOLO ADMIN
// Ya no cierra automáticamente el inventario anterior. Primero debe finalizarse.
router.post('/nueva', requerirRol('ADMIN'), async (req, res) => {
  try {
    const sesion = await iniciarNuevaSesionInventario(req.body?.nombre);
    emitirEventoInventario('sesion_nueva', { sesionId: sesion.id });

    res.status(201).json({
      success: true,
      message: 'Nuevo inventario iniciado correctamente',
      data: sesion
    });
  } catch (error) {
    console.error('Error al iniciar una nueva sesión de inventario:', error);
    res.status(error.status || 500).json({
      success: false,
      code: error.code || null,
      message: error.message || 'Error al iniciar el nuevo inventario'
    });
  }
});

// FINALIZAR INVENTARIO - SOLO ADMIN
// Si existen conteos pendientes de validar, exige confirmación explícita desde el frontend.
router.post('/activa/finalizar', requerirRol('ADMIN'), async (req, res) => {
  try {
    const forzar = req.body?.forzar === true;
    const sesion = await finalizarSesionInventarioActiva({ forzar });

    emitirEventoInventario('sesion_finalizada', { sesionId: sesion.id });

    res.json({
      success: true,
      message: 'Inventario finalizado correctamente',
      data: sesion
    });
  } catch (error) {
    console.error('Error al finalizar el inventario:', error);
    res.status(error.status || 500).json({
      success: false,
      code: error.code || null,
      pendientes: error.pendientes || 0,
      message: error.message || 'Error al finalizar el inventario'
    });
  }
});

// HISTORIAL DE INVENTARIOS FINALIZADOS - SOLO ADMIN
router.get('/historial', requerirRol('ADMIN'), async (_req, res) => {
  try {
    const sesiones = await prisma.sesionInventario.findMany({
      where: { estado: 'CERRADA' },
      orderBy: [{ fechaFin: 'desc' }, { fechaInicio: 'desc' }]
    });

    const data = await Promise.all(sesiones.map(async sesion => ({
      ...sesion,
      resumen: await obtenerResumenSesion(sesion.id)
    })));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error al obtener historial de inventarios:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el historial de inventarios' });
  }
});

// DETALLE HISTÓRICO DE UNA SESIÓN - SOLO ADMIN, SOLO LECTURA
router.get('/:id', requerirRol('ADMIN'), async (req, res) => {
  try {
    const sesion = await prisma.sesionInventario.findUnique({
      where: { id: req.params.id }
    });

    if (!sesion) {
      return res.status(404).json({ success: false, message: 'Inventario no encontrado' });
    }

    const capturas = await prisma.captura.findMany({
      where: { sesionId: sesion.id },
      include: includeCapturaHistoricaAdmin,
      orderBy: { createdAt: 'asc' }
    });

    const resumen = await obtenerResumenSesion(sesion.id);
    const dias = construirResumenPorDia(capturas);

    res.json({
      success: true,
      data: {
        sesion,
        resumen,
        dias,
        capturas
      }
    });
  } catch (error) {
    console.error('Error al obtener detalle del inventario:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el detalle del inventario' });
  }
});

module.exports = router;
