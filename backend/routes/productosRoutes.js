const express = require('express');
const router = express.Router();
const prisma = require('../config/db');

function numeroSeguro(valor, fallback = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : fallback;
}

// OBTENER TODOS LOS PRODUCTOS
router.get('/', async (req, res) => {
  try {
    const productos = await prisma.producto.findMany({
      orderBy: [{ seccion: 'asc' }, { categoria: 'asc' }, { nombre: 'asc' }]
    });
    res.json(productos);
  } catch (error) {
    console.error('Error al obtener productos:', error);
    res.status(500).json({ error: 'Error al obtener los productos de la base de datos' });
  }
});

// CREAR PRODUCTO DESDE EL MODAL DEL ADMINISTRADOR
router.post('/', async (req, res) => {
  try {
    const { codigo, nombre, precio, stock, seccion, categoria } = req.body;
    const codigoLimpio = String(codigo || '').trim();
    const nombreLimpio = String(nombre || '').trim();

    if (!codigoLimpio || !nombreLimpio) {
      return res.status(400).json({ error: 'Código y nombre son obligatorios' });
    }

    const producto = await prisma.producto.create({
      data: {
        codigo: codigoLimpio,
        nombre: nombreLimpio,
        precio: numeroSeguro(precio, 0),
        stock: Math.trunc(numeroSeguro(stock, 0)),
        seccion: seccion ? String(seccion).trim() : null,
        categoria: categoria ? String(categoria).trim() : 'General'
      }
    });

    res.status(201).json(producto);
  } catch (error) {
    if (error && error.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe un producto con ese código' });
    }
    console.error('Error al crear producto:', error);
    res.status(500).json({ error: 'Error al registrar el producto' });
  }
});

// BUSCAR UN PRODUCTO POR CÓDIGO DE BARRAS
router.get('/:codigo', async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').trim();
    const producto = await prisma.producto.findUnique({ where: { codigo } });

    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado en la base de datos' });
    }

    res.json(producto);
  } catch (error) {
    console.error('Error al buscar producto:', error);
    res.status(500).json({ error: 'Error al buscar el producto' });
  }
});

// ACTUALIZAR DATOS DE UN PRODUCTO (principalmente el mapeo de zona física)
router.patch('/:codigo', async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').trim();
    const data = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'nombre')) {
      const nombre = String(req.body.nombre || '').trim();
      if (!nombre) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      data.nombre = nombre;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'precio')) {
      data.precio = numeroSeguro(req.body.precio, 0);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'stock')) {
      data.stock = Math.trunc(numeroSeguro(req.body.stock, 0));
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'seccion')) {
      data.seccion = req.body.seccion ? String(req.body.seccion).trim() : null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'categoria')) {
      data.categoria = req.body.categoria ? String(req.body.categoria).trim() : null;
    }

    const producto = await prisma.producto.update({
      where: { codigo },
      data
    });

    res.json(producto);
  } catch (error) {
    if (error && error.code === 'P2025') {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    console.error('Error al actualizar producto:', error);
    res.status(500).json({ error: 'Error al actualizar el producto' });
  }
});

module.exports = router;
