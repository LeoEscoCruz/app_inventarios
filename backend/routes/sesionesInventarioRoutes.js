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
  iniciarNuevaSesionInventario
} = require('../services/inventarioSessionService');
const { emitirEventoInventario } = require('../services/inventarioEvents');

router.use(autenticarUsuario, requerirPasswordActualizado);

// La sesión activa es visible para todos los usuarios autenticados.
// No contiene existencias ni diferencias, únicamente identifica el inventario actual.
router.get('/activa', async (_req, res) => {
  try {
    const sesion = await obtenerSesionInventarioActiva();

    const totalCapturas = await prisma.captura.count({
      where: { sesionId: sesion.id }
    });

    res.json({
      success: true,
      data: {
        id: sesion.id,
        nombre: sesion.nombre,
        estado: sesion.estado,
        fechaInicio: sesion.fechaInicio,
        totalCapturas
      }
    });
  } catch (error) {
    console.error('Error al obtener la sesión de inventario activa:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el inventario activo' });
  }
});

// Solo un administrador puede cerrar el inventario actual e iniciar uno nuevo.
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
    res.status(500).json({ success: false, message: 'Error al iniciar el nuevo inventario' });
  }
});

module.exports = router;
