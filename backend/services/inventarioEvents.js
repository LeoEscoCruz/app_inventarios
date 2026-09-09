const clientes = new Set();

function registrarCliente(res) {
  clientes.add(res);
  return () => clientes.delete(res);
}

function emitirEventoInventario(tipo, payload = {}) {
  const mensaje = `data: ${JSON.stringify({ tipo, ...payload, timestamp: new Date().toISOString() })}\n\n`;

  for (const res of [...clientes]) {
    try {
      res.write(mensaje);
    } catch (_) {
      clientes.delete(res);
    }
  }
}

function totalClientesInventario() {
  return clientes.size;
}

module.exports = {
  registrarCliente,
  emitirEventoInventario,
  totalClientesInventario
};
