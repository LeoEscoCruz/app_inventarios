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

function claveDiaMonterrey(fecha) {
  const partes = new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Monterrey'
  }).formatToParts(fecha);

  const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

async function obtenerSesionInventarioActiva() {
  return prisma.sesionInventario.findFirst({
    where: { estado: 'ACTIVA' },
    orderBy: { fechaInicio: 'desc' }
  });
}

function construirResumenCapturas(capturas = []) {
  const resumen = {
    totalCapturas: capturas.length,
    pendientes: 0,
    validadas: 0,
    sinDiferencia: 0,
    conDiferencia: 0,
    productosFaltantes: 0,
    productosSobrantes: 0,
    unidadesFaltantes: 0,
    unidadesSobrantes: 0,
    balanceUnidades: 0,
    participantes: []
  };

  const participantes = new Map();

  for (const captura of capturas) {
    const completada = captura.estado === 'COMPLETADO';
    if (completada) resumen.validadas += 1;
    else resumen.pendientes += 1;

    if (completada && Number.isInteger(captura.diferencia)) {
      const diferencia = captura.diferencia;
      resumen.balanceUnidades += diferencia;

      if (diferencia === 0) resumen.sinDiferencia += 1;
      if (diferencia < 0) {
        resumen.conDiferencia += 1;
        resumen.productosFaltantes += 1;
        resumen.unidadesFaltantes += Math.abs(diferencia);
      }
      if (diferencia > 0) {
        resumen.conDiferencia += 1;
        resumen.productosSobrantes += 1;
        resumen.unidadesSobrantes += diferencia;
      }
    }

    const usuario = captura.usuario;
    if (usuario?.id) {
      if (!participantes.has(usuario.id)) {
        participantes.set(usuario.id, {
          id: usuario.id,
          nombre: usuario.nombre || usuario.username || 'Usuario',
          username: usuario.username || null,
          rol: usuario.rol || null,
          conteos: 0
        });
      }
      participantes.get(usuario.id).conteos += 1;
    }
  }

  resumen.participantes = [...participantes.values()]
    .sort((a, b) => b.conteos - a.conteos || a.nombre.localeCompare(b.nombre, 'es'));

  return resumen;
}

async function obtenerResumenSesion(sesionId) {
  const capturas = await prisma.captura.findMany({
    where: { sesionId },
    select: {
      estado: true,
      diferencia: true,
      usuario: {
        select: { id: true, nombre: true, username: true, rol: true }
      }
    }
  });

  return construirResumenCapturas(capturas);
}

async function iniciarNuevaSesionInventario(nombreSolicitado = '') {
  const activa = await obtenerSesionInventarioActiva();
  if (activa) {
    const error = new Error('Ya existe un inventario activo');
    error.code = 'INVENTORY_ALREADY_ACTIVE';
    error.status = 409;
    throw error;
  }

  const ahora = new Date();
  const nombre = String(nombreSolicitado || '').trim().slice(0, 120)
    || `Inventario ${formatearFechaSesion(ahora)}`;

  return prisma.sesionInventario.create({
    data: {
      nombre,
      estado: 'ACTIVA',
      fechaInicio: ahora
    }
  });
}

async function finalizarSesionInventarioActiva({ forzar = false } = {}) {
  const sesion = await obtenerSesionInventarioActiva();
  if (!sesion) {
    const error = new Error('No hay un inventario activo para finalizar');
    error.code = 'NO_ACTIVE_INVENTORY';
    error.status = 409;
    throw error;
  }

  const [totalCapturas, pendientes] = await Promise.all([
    prisma.captura.count({ where: { sesionId: sesion.id } }),
    prisma.captura.count({ where: { sesionId: sesion.id, estado: 'PENDIENTE' } })
  ]);

  if (totalCapturas === 0 && !forzar) {
    const error = new Error('El inventario no tiene conteos registrados');
    error.code = 'INVENTORY_EMPTY';
    error.status = 409;
    throw error;
  }

  if (pendientes > 0 && !forzar) {
    const error = new Error(`Quedan ${pendientes} conteos pendientes de validar`);
    error.code = 'INVENTORY_HAS_PENDING';
    error.status = 409;
    error.pendientes = pendientes;
    throw error;
  }

  const cerrada = await prisma.sesionInventario.update({
    where: { id: sesion.id },
    data: {
      estado: 'CERRADA',
      fechaFin: new Date()
    }
  });

  const resumen = await obtenerResumenSesion(cerrada.id);
  return { ...cerrada, resumen };
}

function construirResumenPorDia(capturas = []) {
  const dias = new Map();

  for (const captura of capturas) {
    const clave = claveDiaMonterrey(new Date(captura.createdAt));
    if (!dias.has(clave)) {
      dias.set(clave, {
        fecha: clave,
        totalCapturas: 0,
        pendientes: 0,
        validadas: 0,
        sinDiferencia: 0,
        conDiferencia: 0,
        unidadesFaltantes: 0,
        unidadesSobrantes: 0,
        balanceUnidades: 0
      });
    }

    const dia = dias.get(clave);
    dia.totalCapturas += 1;

    if (captura.estado === 'COMPLETADO') {
      dia.validadas += 1;
      const diferencia = Number.isInteger(captura.diferencia) ? captura.diferencia : null;
      if (diferencia !== null) {
        dia.balanceUnidades += diferencia;
        if (diferencia === 0) dia.sinDiferencia += 1;
        if (diferencia < 0) {
          dia.conDiferencia += 1;
          dia.unidadesFaltantes += Math.abs(diferencia);
        }
        if (diferencia > 0) {
          dia.conDiferencia += 1;
          dia.unidadesSobrantes += diferencia;
        }
      }
    } else {
      dia.pendientes += 1;
    }
  }

  return [...dias.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

module.exports = {
  obtenerSesionInventarioActiva,
  obtenerResumenSesion,
  construirResumenCapturas,
  construirResumenPorDia,
  iniciarNuevaSesionInventario,
  finalizarSesionInventarioActiva
};
