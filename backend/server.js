const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const usuariosRoutes = require('./routes/usuariosRoutes');
const productosRoutes = require('./routes/productosRoutes');
const capturasRoutes = require('./routes/capturasRoutes');
const sesionesInventarioRoutes = require('./routes/sesionesInventarioRoutes');
const eventosInventarioRoutes = require('./routes/eventosInventarioRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1); // Render trabaja detrás de proxy; permite obtener IP correctamente.

function obtenerOrigenesPermitidos() {
  const configurados = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

  const defaults = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    // Ajusta ALLOWED_ORIGINS en Render si tu dominio de Vercel es diferente.
    'https://app-inventarios.vercel.app'
  ];

  return new Set([...defaults, ...configurados]);
}

const origenesPermitidos = obtenerOrigenesPermitidos();

app.use(cors({
  origin(origin, callback) {
    // Sin Origin: curl/Postman o peticiones same-origin servidas por Express.
    if (!origin || origenesPermitidos.has(origin)) return callback(null, true);
    return callback(new Error('Origen CORS no permitido'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

// Cabeceras básicas sin imponer todavía CSP, ya que el frontend actual usa recursos CDN.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Servir archivos estáticos del Frontend cuando se ejecute todo desde Express en local.
app.use(express.static(path.join(__dirname, '../frontend')));

// API pública únicamente para autenticación. Las demás rutas exigen sesión.
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/capturas', capturasRoutes);
app.use('/api/sesiones', sesionesInventarioRoutes);
app.use('/api/eventos', eventosInventarioRoutes);

app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: 'Ruta API no encontrada' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Errores de CORS y otros errores no controlados.
app.use((error, _req, res, _next) => {
  if (error?.message === 'Origen CORS no permitido') {
    return res.status(403).json({ success: false, message: 'Origen no autorizado' });
  }
  console.error('Error no controlado:', error);
  res.status(500).json({ success: false, message: 'Error interno del servidor' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`Orígenes CORS permitidos: ${Array.from(origenesPermitidos).join(', ')}`);
});
