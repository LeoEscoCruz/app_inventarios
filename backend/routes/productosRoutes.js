const express = require('express');
const router = express.Router();

// Catálogo temporal de prueba (simulando los datos importados de SICAR)
let productos = [
    { codigo: '7501055377206', nombre: 'Lechita Vainilla 180ml', depto: 'Lácteos', stockSicar: 15 },
    { codigo: '7501055377213', nombre: 'Lechita Capuccino 180ml', depto: 'Lácteos', stockSicar: 8 },
    { codigo: '7501055305339', nombre: 'CC Light 600ml 12PK', depto: 'Refrescos', stockSicar: 5 }
];

// GET: Buscar producto por código de barras
router.get('/:codigo', (req, res) => {
    const { codigo } = req.params;
    const producto = productos.find(p => p.codigo === codigo);

    if (producto) {
        return res.json({ success: true, data: producto });
    }
    return res.status(404).json({ success: false, message: 'Producto no encontrado en catálogo de SICAR' });
});

module.exports = router;