const prisma = require('../config/db');

function formatearFechaSesion(fecha = new Date()) {
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Monterrey'
  }).format(fecha);
}

async function obtenerSesionInventarioActiva({ crearSiNoExiste = true } = {}) {
  let sesion = await prisma.sesionInventario.findFirst({
    where: { estado: 'ACTIVA' },
    orderBy: { fechaInicio: 'desc' }
  });

  if (!sesion && crearSiNoExiste) {
    sesion = await prisma.sesionInventario.create({
      data: {
        nombre: `Inventario ${formatearFechaSesion()}`,
        estado: 'ACTIVA'
      }
    });
  }

  return sesion;
}

async function iniciarNuevaSesionInventario(nombreSolicitado = '') {
  const ahora = new Date();
  const nombre = String(nombreSolicitado || '').trim().slice(0, 120)
    || `Inventario ${formatearFechaSesion(ahora)}`;

  return prisma.$transaction(async tx => {
    await tx.sesionInventario.updateMany({
      where: { estado: 'ACTIVA' },
      data: { estado: 'CERRADA', fechaFin: ahora }
    });

    return tx.sesionInventario.create({
      data: {
        nombre,
        estado: 'ACTIVA',
        fechaInicio: ahora
      }
    });
  });
}

module.exports = {
  obtenerSesionInventarioActiva,
  iniciarNuevaSesionInventario
};
