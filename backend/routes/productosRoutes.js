const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const {
  autenticarUsuario,
  requerirRol,
  requerirPasswordActualizado
} = require('../middleware/auth');
const { emitirEventoInventario } = require('../services/inventarioEvents');
const { sincronizarZonasLegadas } = require('../services/zonasService');

function numeroSeguro(valor, fallback = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : fallback;
}

const selectZonas = {
  zonas: {
    select: {
      zona: { select: { id: true, nombre: true, activo: true } }
    },
    orderBy: { createdAt: 'asc' }
  }
};

const selectProductoEmpleado = {
  id: true,
  codigo: true,
  nombre: true,
  precio: true,
  seccion: true,
  categoria: true,
  createdAt: true,
  updatedAt: true,
  ...selectZonas
};

const includeProductoAdmin = { ...selectZonas };

router.use(autenticarUsuario, requerirPasswordActualizado);

router.get('/', async (req, res) => {
  try {
    await sincronizarZonasLegadas();
    const opciones = { orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }] };
    if (req.usuario.rol !== 'ADMIN') opciones.select = selectProductoEmpleado;
    else opciones.include = includeProductoAdmin;

    const productos = await prisma.producto.findMany(opciones);
    res.json(productos);
  } catch (error) {
    console.error('Error al obtener productos:', error);
    res.status(500).json({ error: 'Error al obtener los productos de la base de datos' });
  }
});

router.post('/', requerirRol('ADMIN'), async (req, res) => {
  try {
    const { codigo, nombre, precio, stock, seccion, categoria } = req.body;
    const codigoLimpio = String(codigo || '').trim();
    const nombreLimpio = String(nombre || '').trim();

    if (!codigoLimpio || codigoLimpio.length > 80 || !nombreLimpio || nombreLimpio.length > 200) {
      return res.status(400).json({ error: 'Código y nombre válidos son obligatorios' });
    }

    const producto = await prisma.producto.create({
      data: {
        codigo: codigoLimpio,
        nombre: nombreLimpio,
        precio: numeroSeguro(precio, 0),
        stock: Math.trunc(numeroSeguro(stock, 0)),
        // seccion se conserva únicamente como compatibilidad con versiones anteriores.
        seccion: seccion ? String(seccion).trim().slice(0, 120) : null,
        categoria: categoria ? String(categoria).trim().slice(0, 120) : 'General'
      },
      include: includeProductoAdmin
    });

    emitirEventoInventario('catalogo_actualizado');
    res.status(201).json(producto);
  } catch (error) {
    if (error && error.code === 'P2002') return res.status(409).json({ error: 'Ya existe un producto con ese código' });
    console.error('Error al crear producto:', error);
    res.status(500).json({ error: 'Error al registrar el producto' });
  }
});

router.get('/:codigo', async (req, res) => {
  try {
    await sincronizarZonasLegadas();
    const codigo = String(req.params.codigo || '').trim();
    if (!codigo || codigo.length > 80) return res.status(400).json({ error: 'Código inválido' });

    const opciones = { where: { codigo } };
    if (req.usuario.rol !== 'ADMIN') opciones.select = selectProductoEmpleado;
    else opciones.include = includeProductoAdmin;

    const producto = await prisma.producto.findUnique(opciones);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado en la base de datos' });
    res.json(producto);
  } catch (error) {
    console.error('Error al buscar producto:', error);
    res.status(500).json({ error: 'Error al buscar el producto' });
  }
});

router.patch('/:codigo', requerirRol('ADMIN'), async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').trim();
    const data = {};
    if (!codigo || codigo.length > 80) return res.status(400).json({ error: 'Código inválido' });

    if (Object.prototype.hasOwnProperty.call(req.body, 'nombre')) {
      const nombre = String(req.body.nombre || '').trim();
      if (!nombre || nombre.length > 200) return res.status(400).json({ error: 'Nombre inválido' });
      data.nombre = nombre;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'precio')) data.precio = numeroSeguro(req.body.precio, 0);
    if (Object.prototype.hasOwnProperty.call(req.body, 'stock')) data.stock = Math.trunc(numeroSeguro(req.body.stock, 0));
    if (Object.prototype.hasOwnProperty.call(req.body, 'seccion')) data.seccion = req.body.seccion ? String(req.body.seccion).trim().slice(0, 120) : null;
    if (Object.prototype.hasOwnProperty.call(req.body, 'categoria')) data.categoria = req.body.categoria ? String(req.body.categoria).trim().slice(0, 120) : null;

    const producto = await prisma.producto.update({ where: { codigo }, data, include: includeProductoAdmin });
    emitirEventoInventario('catalogo_actualizado');
    res.json(producto);
  } catch (error) {
    if (error && error.code === 'P2025') return res.status(404).json({ error: 'Producto no encontrado' });
    console.error('Error al actualizar producto:', error);
    res.status(500).json({ error: 'Error al actualizar el producto' });
  }
});

module.exports = router;
