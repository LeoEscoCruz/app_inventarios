const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { autenticarUsuario, requerirRol, requerirPasswordActualizado } = require('../middleware/auth');
const { obtenerSesionInventarioActiva } = require('../services/inventarioSessionService');
const { emitirEventoInventario } = require('../services/inventarioEvents');
const { agruparCapturasPorProducto } = require('../services/capturasAggregationService');
const { sincronizarZonasLegadas } = require('../services/zonasService');

const includeCapturaAdmin = {
  producto: {
    include: {
      zonas: { include: { zona: { select: { id: true, nombre: true, activo: true } } } }
    }
  },
  usuario: { select: { id: true, nombre: true, username: true, email: true, rol: true } },
  sesion: true,
  zona: { select: { id: true, nombre: true } }
};

const selectCapturaEmpleado = {
  id: true,
  cantidadFisica: true,
  estado: true,
  seccionCapturada: true,
  zonaId: true,
  zona: { select: { id: true, nombre: true } },
  createdAt: true,
  updatedAt: true,
  producto: {
    select: {
      id: true, codigo: true, nombre: true, precio: true, seccion: true, categoria: true,
      zonas: { select: { zona: { select: { id: true, nombre: true, activo: true } } } }
    }
  },
  sesion: { select: { id: true, nombre: true, estado: true, fechaInicio: true } }
};

router.use(autenticarUsuario, requerirPasswordActualizado);

// Progreso compartido: expone producto + ubicación ya recorrida, nunca cantidades ni SICAR.
router.get('/progreso', async (_req, res) => {
  try {
    const sesion = await obtenerSesionInventarioActiva();
    if (!sesion) return res.json({ success: true, sesion: null, data: [] });

    const registros = await prisma.captura.findMany({
      where: { sesionId: sesion.id },
      select: {
        id: true, createdAt: true, updatedAt: true, seccionCapturada: true, zonaId: true,
        zona: { select: { id: true, nombre: true } },
        producto: {
          select: {
            id: true, codigo: true, nombre: true, precio: true, seccion: true, categoria: true,
            zonas: { select: { zona: { select: { id: true, nombre: true, activo: true } } } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      sesion: { id: sesion.id, nombre: sesion.nombre, fechaInicio: sesion.fechaInicio },
      data: registros
    });
  } catch (error) {
    console.error('Error al obtener progreso compartido:', error);
    res.status(500).json({ success: false, message: 'Error al obtener el progreso del inventario' });
  }
});

router.get('/mias', async (req, res) => {
  try {
    const sesion = await obtenerSesionInventarioActiva();
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

// Recepción en vivo: una fila por producto. cantidadFisica es la suma de todas sus ubicaciones.
router.get('/', requerirRol('ADMIN'), async (_req, res) => {
  try {
    await sincronizarZonasLegadas();
    const sesion = await obtenerSesionInventarioActiva();
    if (!sesion) return res.json({ success: true, sesion: null, data: [] });

    const lineas = await prisma.captura.findMany({
      where: { sesionId: sesion.id },
      include: includeCapturaAdmin,
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      sesion: { id: sesion.id, nombre: sesion.nombre, fechaInicio: sesion.fechaInicio },
      data: agruparCapturasPorProducto(lineas)
    });
  } catch (error) {
    console.error('Error al obtener capturas:', error);
    res.status(500).json({ success: false, message: 'Error al obtener las capturas' });
  }
});

// Cada combinación producto + ubicación se cuenta una sola vez por sesión.
router.post('/', async (req, res) => {
  try {
    const codigo = String(req.body.codigo || '').trim();
    const cantidadFisica = Number(req.body.cantidad);
    const zonaId = String(req.body.zonaId || '').trim();

    if (!codigo || codigo.length > 80 || !Number.isInteger(cantidadFisica) || cantidadFisica < 0) {
      return res.status(400).json({ success: false, message: 'Código y cantidad física válida son obligatorios' });
    }
    if (!zonaId) {
      return res.status(400).json({ success: false, code: 'LOCATION_REQUIRED', message: 'Selecciona la ubicación que estás contando' });
    }

    await sincronizarZonasLegadas();
    const [producto, zona, sesion] = await Promise.all([
      prisma.producto.findUnique({
        where: { codigo },
        include: { zonas: { include: { zona: { select: { id: true, nombre: true, activo: true } } } } }
      }),
      prisma.zona.findUnique({ where: { id: zonaId } }),
      obtenerSesionInventarioActiva()
    ]);

    if (!producto) return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    if (!zona || zona.activo === false) return res.status(404).json({ success: false, message: 'Ubicación no encontrada o inactiva' });
    if (!sesion) {
      return res.status(409).json({
        success: false,
        code: 'NO_ACTIVE_INVENTORY',
        message: 'No hay un inventario activo. Un administrador debe iniciar uno antes de registrar conteos.'
      });
    }

    const ubicacionHabitual = producto.zonas.some(rel => rel.zonaId === zona.id || rel.zona?.id === zona.id);

    const captura = await prisma.$transaction(async tx => {
      // Si el producto ya había sido validado y aparece una nueva ubicación, la validación
      // deja de ser vigente porque cambió el total físico consolidado.
      await tx.captura.updateMany({
        where: { sesionId: sesion.id, productoId: producto.id, estado: 'COMPLETADO' },
        data: { estado: 'PENDIENTE', stockSicar: null, diferencia: null }
      });

      return tx.captura.create({
        data: {
          productoId: producto.id,
          usuarioId: req.usuario.id,
          sesionId: sesion.id,
          cantidadFisica,
          stockSicar: null,
          diferencia: null,
          estado: 'PENDIENTE',
          zonaId: zona.id,
          seccionCapturada: zona.nombre
        },
        ...(req.usuario.rol === 'ADMIN' ? { include: includeCapturaAdmin } : { select: selectCapturaEmpleado })
      });
    });

    emitirEventoInventario('captura_creada', { sesionId: sesion.id });
    res.status(201).json({ success: true, data: captura, ubicacionHabitual });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        success: false,
        code: 'PRODUCT_LOCATION_ALREADY_COUNTED',
        message: 'Este producto ya fue contado en esta ubicación durante el inventario activo'
      });
    }
    console.error('Error al registrar captura:', error);
    res.status(500).json({ success: false, message: 'Error al registrar la captura' });
  }
});

// Permite corregir un conteo de ubicación equivocado sin borrar el producto ni el historial cerrado.
router.delete('/:id', requerirRol('ADMIN'), async (req, res) => {
  try {
    const linea = await prisma.captura.findUnique({
      where: { id: req.params.id },
      include: { sesion: { select: { id: true, estado: true } } }
    });
    if (!linea) return res.status(404).json({ success: false, message: 'Conteo de ubicación no encontrado' });
    if (linea.sesion?.estado !== 'ACTIVA') {
      return res.status(409).json({ success: false, code: 'INVENTORY_CLOSED', message: 'No se puede modificar un inventario finalizado' });
    }

    await prisma.$transaction([
      prisma.captura.delete({ where: { id: linea.id } }),
      prisma.captura.updateMany({
        where: { sesionId: linea.sesionId, productoId: linea.productoId, id: { not: linea.id } },
        data: { estado: 'PENDIENTE', stockSicar: null, diferencia: null }
      })
    ]);
    emitirEventoInventario('captura_actualizada', { sesionId: linea.sesionId });
    res.json({ success: true, message: 'Conteo retirado. La ubicación queda disponible para volver a contarse.' });
  } catch (error) {
    console.error('Error al retirar conteo de ubicación:', error);
    res.status(500).json({ success: false, message: 'Error al retirar el conteo' });
  }
});

// La validación se aplica al total consolidado del producto, no a una ubicación aislada.
router.put('/:id', requerirRol('ADMIN'), async (req, res) => {
  try {
    const capturaActual = await prisma.captura.findUnique({
      where: { id: req.params.id },
      include: { sesion: { select: { id: true, estado: true } } }
    });
    if (!capturaActual) return res.status(404).json({ success: false, message: 'Captura no encontrada' });
    if (capturaActual.sesion?.estado !== 'ACTIVA') {
      return res.status(409).json({ success: false, code: 'INVENTORY_CLOSED', message: 'Este inventario ya fue finalizado y su información es de solo lectura' });
    }

    const lineas = await prisma.captura.findMany({
      where: { sesionId: capturaActual.sesionId, productoId: capturaActual.productoId },
      include: includeCapturaAdmin,
      orderBy: { createdAt: 'asc' }
    });
    const consolidada = agruparCapturasPorProducto(lineas)[0];
    if (!consolidada) return res.status(404).json({ success: false, message: 'Conteo no encontrado' });

    const estadoSolicitado = req.body.estado ? String(req.body.estado).trim().toUpperCase() : null;
    if (estadoSolicitado && !['PENDIENTE', 'COMPLETADO'].includes(estadoSolicitado)) {
      return res.status(400).json({ success: false, message: 'Estado inválido' });
    }

    if (estadoSolicitado === 'COMPLETADO' && consolidada.conteoCoordinado?.pendientes?.length && req.body.forzarUbicaciones !== true) {
      return res.status(409).json({
        success: false,
        code: 'LOCATIONS_PENDING',
        pendientes: consolidada.conteoCoordinado.pendientes,
        message: `Falta contar este producto en ${consolidada.conteoCoordinado.pendientes.length} ubicación(es) habitual(es)`
      });
    }

    if (estadoSolicitado === 'COMPLETADO' && consolidada.conteoCoordinado?.desfasado && req.body.forzarUbicaciones !== true) {
      return res.status(409).json({
        success: false,
        code: 'COUNT_WINDOW_EXCEEDED',
        minutos: consolidada.conteoCoordinado.minutosEntreConteos,
        ventanaMinutos: consolidada.conteoCoordinado.ventanaMinutos,
        message: 'Los conteos de las distintas ubicaciones quedaron demasiado separados en el tiempo'
      });
    }

    let stockSicar = consolidada.stockSicar;
    if (req.body.stockSicar !== undefined && req.body.stockSicar !== null && req.body.stockSicar !== '') {
      stockSicar = Number(req.body.stockSicar);
      if (!Number.isInteger(stockSicar) || stockSicar < 0) {
        return res.status(400).json({ success: false, message: 'Existencia del POS inválida' });
      }
    }

    if (estadoSolicitado === 'COMPLETADO' && stockSicar === null) {
      return res.status(400).json({ success: false, message: 'Debes registrar la existencia vigente del POS antes de completar la captura' });
    }

    const data = {};
    if (stockSicar !== null) {
      data.stockSicar = stockSicar;
      data.diferencia = consolidada.cantidadFisica - stockSicar;
    }
    if (estadoSolicitado) data.estado = estadoSolicitado;

    await prisma.captura.updateMany({
      where: { sesionId: capturaActual.sesionId, productoId: capturaActual.productoId },
      data
    });

    const actualizadas = await prisma.captura.findMany({
      where: { sesionId: capturaActual.sesionId, productoId: capturaActual.productoId },
      include: includeCapturaAdmin,
      orderBy: { createdAt: 'asc' }
    });
    const resultado = agruparCapturasPorProducto(actualizadas)[0];

    emitirEventoInventario('captura_actualizada', { sesionId: capturaActual.sesionId });
    res.json({ success: true, data: resultado });
  } catch (error) {
    console.error('Error al actualizar captura:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar la captura' });
  }
});

module.exports = router;
