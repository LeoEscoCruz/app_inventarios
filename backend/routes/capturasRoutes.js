const express = require('express');
const router = express.Router();
const prisma = require('../config/db');

const DEFAULT_USER_EMAIL = process.env.DEFAULT_INVENTORY_USER_EMAIL || 'empleado@laflordemexico.local';

async function obtenerContextoInventario() {
  const usuario = await prisma.usuario.upsert({
    where: { email: DEFAULT_USER_EMAIL },
    update: {},
    create: {
      nombre: 'Empleado Inventario',
      email: DEFAULT_USER_EMAIL,
      password: 'inventario-local',
      rol: 'EMPLEADO'
    }
  });

  let sesion = await prisma.sesionInventario.findFirst({
    where: { estado: 'ACTIVA' },
    orderBy: { fechaInicio: 'desc' }
  });

  if (!sesion) {
    const fecha = new Intl.DateTimeFormat('es-MX', {
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Monterrey'
    }).format(new Date());

    sesion = await prisma.sesionInventario.create({
      data: { nombre: `Inventario General ${fecha}` }
    });
  }

  return { usuario, sesion };
}

const includeCaptura = {
  producto: true,
  usuario: { select: { id: true, nombre: true, email: true, rol: true } },
  sesion: true
};

// OBTENER CAPTURAS PARA EL DASHBOARD
router.get('/', async (req, res) => {
  try {
    const capturas = await prisma.captura.findMany({
      include: includeCaptura,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: capturas });
  } catch (error) {
    console.error('Error al obtener capturas:', error);
    res.status(500).json({ success: false, message: 'Error al obtener las capturas' });
  }
});

// REGISTRAR CONTEO FÍSICO DEL EMPLEADO
router.post('/', async (req, res) => {
  try {
    const codigo = String(req.body.codigo || '').trim();
    const cantidadFisica = Number(req.body.cantidad);
    const zona = req.body.zona ? String(req.body.zona).trim() : null;

    if (!codigo || !Number.isInteger(cantidadFisica) || cantidadFisica < 0) {
      return res.status(400).json({
        success: false,
        message: 'Código y cantidad física válida son obligatorios'
      });
    }

    const producto = await prisma.producto.findUnique({ where: { codigo } });
    if (!producto) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    }

    const { usuario, sesion } = await obtenerContextoInventario();
    const stockSicar = Number.isInteger(producto.stock) ? producto.stock : 0;

    const captura = await prisma.captura.create({
      data: {
        productoId: producto.id,
        usuarioId: usuario.id,
        sesionId: sesion.id,
        cantidadFisica,
        stockSicar,
        diferencia: cantidadFisica - stockSicar,
        estado: 'PENDIENTE',
        seccionCapturada: zona || producto.seccion || 'General'
      },
      include: includeCaptura
    });

    res.status(201).json({ success: true, data: captura });
  } catch (error) {
    console.error('Error al registrar captura:', error);
    res.status(500).json({ success: false, message: 'Error al registrar la captura' });
  }
});

// ACTUALIZAR STOCK SICAR / ESTADO DESDE EL ADMINISTRADOR
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const capturaActual = await prisma.captura.findUnique({ where: { id } });

    if (!capturaActual) {
      return res.status(404).json({ success: false, message: 'Captura no encontrada' });
    }

    const data = {};

    if (req.body.stockSicar !== undefined && req.body.stockSicar !== null && req.body.stockSicar !== '') {
      const stockSicar = Number(req.body.stockSicar);
      if (!Number.isInteger(stockSicar)) {
        return res.status(400).json({ success: false, message: 'Stock SICAR inválido' });
      }
      data.stockSicar = stockSicar;
      data.diferencia = capturaActual.cantidadFisica - stockSicar;
    }

    if (req.body.estado) {
      const estado = String(req.body.estado).trim().toUpperCase();
      if (!['PENDIENTE', 'COMPLETADO'].includes(estado)) {
        return res.status(400).json({ success: false, message: 'Estado inválido' });
      }
      data.estado = estado;
    }

    const captura = await prisma.captura.update({
      where: { id },
      data,
      include: includeCaptura
    });

    res.json({ success: true, data: captura });
  } catch (error) {
    console.error('Error al actualizar captura:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar la captura' });
  }
});

module.exports = router;
