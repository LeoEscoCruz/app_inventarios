const express = require('express');
const cors = require('cors');
const path = require('path');

const productosRoutes = require('./routes/productosRoutes');
const capturasRoutes = require('./routes/capturasRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del Frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Rutas API REST
app.use('/api/productos', productosRoutes);
app.use('/api/capturas', capturasRoutes);

// Ruta Principal
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
    console.log(`📱 Acceso en Red Local: http://localhost:${PORT}`);
    
});