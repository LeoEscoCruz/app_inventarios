const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { autenticarUsuario, requerirRol, requerirPasswordActualizado } = require('../middleware/auth');
const { emitirEventoInventario } = require('../services/inventarioEvents');
const { sincronizarZonasLegadas } = require('../services/zonasService');

router.use(autenticarUsuario, requerirPasswordActualizado);

router.get('/', async (_req, res) => {
  try {
    await sincronizarZonasLegadas();
    const zonas = await prisma.zona.findMany({
      where: { activo: true },
      include: { _count: { select: { productos: true } } },
      orderBy: { nombre: 'asc' }
    });
    res.json({ success: true, data: zonas });
  } catch (error) {
    console.error('Error al obtener ubicaciones:', error);
    res.status(500).json({ success: false, message: 'Error al obtener las ubicaciones' });
  }
});

router.post('/', requerirRol('ADMIN'), async (req, res) => {
  try {
    const nombre = String(req.body?.nombre || '').trim().slice(0, 120);
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre de la ubicación es obligatorio' });

    const existente = await prisma.zona.findFirst({
      where: { nombre: { equals: nombre, mode: 'insensitive' } }
    });
    if (existente?.activo) return res.status(409).json({ success: false, message: 'Ya existe una ubicación con ese nombre' });

    const zona = existente
      ? await prisma.zona.update({ where: { id: existente.id }, data: { activo: true } })
      : await prisma.zona.create({ data: { nombre } });
    emitirEventoInventario('catalogo_actualizado');
    res.status(201).json({ success: true, data: zona });
  } catch (error) {
    console.error('Error al crear ubicación:', error);
    res.status(500).json({ success: false, message: 'Error al crear la ubicación' });
  }
});

router.patch('/:id', requerirRol('ADMIN'), async (req, res) => {
  try {
    const nombre = String(req.body?.nombre || '').trim().slice(0, 120);
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre de la ubicación es obligatorio' });

    const duplicada = await prisma.zona.findFirst({
      where: { id: { not: req.params.id }, nombre: { equals: nombre, mode: 'insensitive' } }
    });
    if (duplicada) return res.status(409).json({ success: false, message: 'Ya existe una ubicación con ese nombre' });

    const zona = await prisma.zona.update({ where: { id: req.params.id }, data: { nombre } });
    emitirEventoInventario('catalogo_actualizado');
    res.json({ success: true, data: zona });
  } catch (error) {
    if (error?.code === 'P2025') return res.status(404).json({ success: false, message: 'Ubicación no encontrada' });
    console.error('Error al renombrar ubicación:', error);
    res.status(500).json({ success: false, message: 'Error al renombrar la ubicación' });
  }
});

router.delete('/:id', requerirRol('ADMIN'), async (req, res) => {
  try {
    const zona = await prisma.zona.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { productos: true } } }
    });
    if (!zona) return res.status(404).json({ success: false, message: 'Ubicación no encontrada' });

    await prisma.$transaction([
      prisma.productoZona.deleteMany({ where: { zonaId: zona.id } }),
      prisma.zona.update({ where: { id: zona.id }, data: { activo: false } })
    ]);
    emitirEventoInventario('catalogo_actualizado');
    res.json({
      success: true,
      message: zona._count.productos
        ? `Ubicación eliminada. ${zona._count.productos} productos quedaron sin esta asignación.`
        : 'Ubicación eliminada correctamente'
    });
  } catch (error) {
    console.error('Error al eliminar ubicación:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar la ubicación' });
  }
});

router.post('/:id/productos', requerirRol('ADMIN'), async (req, res) => {
  try {
    const codigo = String(req.body?.codigo || '').trim();
    if (!codigo) return res.status(400).json({ success: false, message: 'Código de producto obligatorio' });

    const [zona, producto] = await Promise.all([
      prisma.zona.findUnique({ where: { id: req.params.id } }),
      prisma.producto.findUnique({ where: { codigo } })
    ]);
    if (!zona) return res.status(404).json({ success: false, message: 'Ubicación no encontrada' });
    if (!producto) return res.status(404).json({ success: false, message: 'Producto no encontrado' });

    await prisma.productoZona.upsert({
      where: { productoId_zonaId: { productoId: producto.id, zonaId: zona.id } },
      update: {},
      create: { productoId: producto.id, zonaId: zona.id }
    });

    emitirEventoInventario('catalogo_actualizado');
    res.json({ success: true, message: `${producto.nombre} asignado a ${zona.nombre}` });
  } catch (error) {
    console.error('Error al asignar producto a ubicación:', error);
    res.status(500).json({ success: false, message: 'Error al asignar el producto a la ubicación' });
  }
});

router.delete('/:id/productos/:productoId', requerirRol('ADMIN'), async (req, res) => {
  try {
    await prisma.productoZona.delete({
      where: { productoId_zonaId: { productoId: req.params.productoId, zonaId: req.params.id } }
    });
    emitirEventoInventario('catalogo_actualizado');
    res.json({ success: true, message: 'Producto retirado de la ubicación' });
  } catch (error) {
    if (error?.code === 'P2025') return res.status(404).json({ success: false, message: 'La asignación ya no existe' });
    console.error('Error al retirar producto de ubicación:', error);
    res.status(500).json({ success: false, message: 'Error al retirar el producto de la ubicación' });
  }
});

module.exports = router;
