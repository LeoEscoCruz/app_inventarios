const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const {
  autenticarUsuario,
  requerirRol,
  requerirPasswordActualizado
} = require('../middleware/auth');

const { obtenerSesionInventarioActiva } = require('../services/inventarioSessionService');
const { emitirEventoInventario } = require('../services/inventarioEvents');

const includeCapturaAdmin = {
  producto: true,
  usuario: { select: { id: true, nombre: true, username: true, email: true, rol: true } },
  sesion: true
};

const selectCapturaEmpleado = {
  id: true,
  cantidadFisica: true,
  estado: true,
  seccionCapturada: true,
  createdAt: true,
  updatedAt: true,
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
  sesion: { select: { id: true, nombre: true, estado: true, fechaInicio: true } }
};

router.use(autenticarUsuario, requerirPasswordActualizado);

// PROGRESO COMPARTIDO DEL INVENTARIO ACTIVO
// Todos los empleados ven qué productos ya fueron contados por el equipo,
// pero NO reciben cantidades físicas, stock del POS ni diferencias.
router.get('/progreso', async (_req, res) => {
  try {
    const sesion = await obtenerSesionInventarioActiva();
    if (!sesion) {
      return res.json({ success: true, sesion: null, data: [] });
    }

    const registros = await prisma.captura.findMany({
      where: { sesionId: sesion.id },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        seccionCapturada: true,
        producto: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            precio: true,
            seccion: true,
            categoria: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Para la lista operativa basta con conocer la captura más reciente de cada producto.
    const vistos = new Set();
    const progreso = registros.filter(registro => {
      const productoId = registro.producto?.id;
      if (!productoId || vistos.has(productoId)) return false;
      vistos.add(productoId);
      return true;
    });

    res.json({
      success: true,
      sesion: { id: sesion.id, nombre: sesion.nombre, fechaInicio: sesion.fechaInicio },
      data: progreso
    });
  } catch (error) {
    console.error('Error al obtener progreso compartido:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el progreso del inventario' });
  }
});

// CAPTURAS PROPIAS DEL USUARIO - ÚTIL PARA MARCAR PRODUCTOS YA CONTADOS SIN EXPONER TODA LA AUDITORÍA
router.get('/mias', async (req, res) => {
  try {
    const sesion = await prisma.sesionInventario.findFirst({
      where: { estado: 'ACTIVA' },
      orderBy: { fechaInicio: 'desc' }
    });

    if (!sesion) return res.json({ success: true, data: [] });

    const capturas = await prisma.captura.findMany({
      where: { usuarioId: req.usuario.id, sesionId: sesion.id },
      select: selectCapturaEmpleado,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: capturas });
  } catch (error) {
    console.error('Error al obtener capturas propias:', error);
    res.status(500).json({ success: false, message: 'Error al obtener tus capturas' });
  }
});

// RECEPCIÓN EN VIVO - SOLO ADMIN
router.get('/', requerirRol('ADMIN'), async (_req, res) => {
  try {
    const sesion = await obtenerSesionInventarioActiva();
    if (!sesion) {
      return res.json({ success: true, sesion: null, data: [] });
    }

    const capturas = await prisma.captura.findMany({
      where: { sesionId: sesion.id },
      include: includeCapturaAdmin,
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      sesion: { id: sesion.id, nombre: sesion.nombre, fechaInicio: sesion.fechaInicio },
      data: capturas
    });
  } catch (error) {
    console.error('Error al obtener capturas:', error);
    res.status(500).json({ success: false, message: 'Error al obtener las capturas' });
  }
});

// REGISTRAR CONTEO FÍSICO: EL usuarioId SALE DE LA SESIÓN, NO DEL FRONTEND
router.post('/', async (req, res) => {
  try {
    const codigo = String(req.body.codigo || '').trim();
    const cantidadFisica = Number(req.body.cantidad);
    const zona = req.body.zona ? String(req.body.zona).trim().slice(0, 120) : null;

    if (!codigo || codigo.length > 80 || !Number.isInteger(cantidadFisica) || cantidadFisica < 0) {
      return res.status(400).json({
        success: false,
        message: 'Código y cantidad física válida son obligatorios'
      });
    }

    const producto = await prisma.producto.findUnique({ where: { codigo } });
    if (!producto) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    }

    const sesion = await obtenerSesionInventarioActiva();
    if (!sesion) {
      return res.status(409).json({
        success: false,
        code: 'NO_ACTIVE_INVENTORY',
        message: 'No hay un inventario activo. Un administrador debe iniciar uno antes de registrar conteos.'
      });
    }

    const capturaExistente = await prisma.captura.findFirst({
      where: { productoId: producto.id, sesionId: sesion.id },
      select: { id: true, createdAt: true }
    });

    if (capturaExistente) {
      return res.status(409).json({
        success: false,
        code: 'PRODUCT_ALREADY_COUNTED',
        message: 'Este producto ya fue contado en el inventario activo'
      });
    }

    const respuestaCaptura = req.usuario.rol === 'ADMIN'
      ? { include: includeCapturaAdmin }
      : { select: selectCapturaEmpleado };

    const captura = await prisma.captura.create({
      data: {
        productoId: producto.id,
        usuarioId: req.usuario.id,
        sesionId: sesion.id,
        cantidadFisica,
        stockSicar: null,
        diferencia: null,
        estado: 'PENDIENTE',
        seccionCapturada: zona || producto.seccion || 'General'
      },
      ...respuestaCaptura
    });

    emitirEventoInventario('captura_creada', { sesionId: sesion.id });
    res.status(201).json({ success: true, data: captura });
  } catch (error) {
    console.error('Error al registrar captura:', error);
    res.status(500).json({ success: false, message: 'Error al registrar la captura' });
  }
});

// VALIDACIÓN DE EXISTENCIA DEL POS / ESTADO - SOLO ADMIN
router.put('/:id', requerirRol('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const capturaActual = await prisma.captura.findUnique({
      where: { id },
      include: { sesion: { select: { id: true, estado: true } } }
    });

    if (!capturaActual) {
      return res.status(404).json({ success: false, message: 'Captura no encontrada' });
    }

    if (capturaActual.sesion?.estado !== 'ACTIVA') {
      return res.status(409).json({
        success: false,
        code: 'INVENTORY_CLOSED',
        message: 'Este inventario ya fue finalizado y su información es de solo lectura'
      });
    }

    const data = {};

    if (req.body.stockSicar !== undefined && req.body.stockSicar !== null && req.body.stockSicar !== '') {
      const stockSicar = Number(req.body.stockSicar);
      if (!Number.isInteger(stockSicar) || stockSicar < 0) {
        return res.status(400).json({ success: false, message: 'Existencia del POS inválida' });
      }
      data.stockSicar = stockSicar;
      data.diferencia = capturaActual.cantidadFisica - stockSicar;
    }

    if (req.body.estado) {
      const estado = String(req.body.estado).trim().toUpperCase();
      if (!['PENDIENTE', 'COMPLETADO'].includes(estado)) {
        return res.status(400).json({ success: false, message: 'Estado inválido' });
      }
      if (estado === 'COMPLETADO' && data.stockSicar === undefined && capturaActual.stockSicar === null) {
        return res.status(400).json({
          success: false,
          message: 'Debes registrar la existencia vigente del POS antes de completar la captura'
        });
      }
      data.estado = estado;
    }

    const captura = await prisma.captura.update({
      where: { id },
      data,
      include: includeCapturaAdmin
    });

    emitirEventoInventario('captura_actualizada', { sesionId: captura.sesionId });
    res.json({ success: true, data: captura });
  } catch (error) {
    console.error('Error al actualizar captura:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar la captura' });
  }
});

module.exports = router;
