const express = require('express');
const router = express.Router();

let capturas = [];

// GET: Obtener todas las capturas registradas (Dashboard)
router.get('/', (req, res) => {
    res.json({ success: true, data: capturas });
});

// POST: Registrar nueva captura desde el escáner del empleado
router.post('/', (req, res) => {
    const { codigo, producto, cantidad, zona } = req.body;

    if (!codigo || cantidad === undefined) {
        return res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
    }

    const nuevaCaptura = {
        id: Date.now(),
        fechahora: new Date().toLocaleString(),
        codigo,
        producto: producto || 'Producto no identificado',
        fisico: parseInt(cantidad),
        zona: zona || 'General',
        sicar: null,
        diferencia: null,
        estado: 'pendiente'
    };

    capturas.unshift(nuevaCaptura);
    res.status(201).json({ success: true, data: nuevaCaptura });
});

// PUT: Actualizar stock de SICAR y calcular la diferencia en el admin
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { stockSicar, estado } = req.body;

    const captura = capturas.find(c => c.id === parseInt(id));

    if (!captura) {
        return res.status(404).json({ success: false, message: 'Captura no encontrada' });
    }

    if (stockSicar !== undefined) {
        captura.sicar = parseInt(stockSicar);
        captura.diferencia = captura.fisico - captura.sicar;
    }

    if (estado) {
        captura.estado = estado;
    }

    res.json({ success: true, data: captura });
});

module.exports = router;