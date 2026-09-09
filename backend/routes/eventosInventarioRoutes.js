const express = require('express');
const router = express.Router();
const {
  autenticarUsuario,
  requerirPasswordActualizado
} = require('../middleware/auth');
const { registrarCliente } = require('../services/inventarioEvents');

router.use(autenticarUsuario, requerirPasswordActualizado);

// Canal SSE autenticado para avisar a los navegadores cuando cambia el inventario.
// El evento NO transporta cantidades, stock ni diferencias: solo indica que el
// cliente debe volver a consultar la API que corresponda a su rol.
router.get('/inventario', (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const remover = registrarCliente(res);

  res.write(`data: ${JSON.stringify({
    tipo: 'conexion',
    timestamp: new Date().toISOString()
  })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (_) {}
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    remover();
  });
});

module.exports = router;
