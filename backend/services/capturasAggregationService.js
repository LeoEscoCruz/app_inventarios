const VENTANA_COORDINADA_MINUTOS = 15;

function fechaMs(valor) {
  const ms = new Date(valor || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function agruparCapturasPorProducto(capturas = []) {
  const grupos = new Map();

  for (const captura of capturas) {
    const clave = `${captura.sesionId || captura.sesion?.id || ''}:${captura.productoId || captura.producto?.id || ''}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(captura);
  }

  return [...grupos.values()].map(lineas => {
    lineas.sort((a, b) => fechaMs(a.createdAt) - fechaMs(b.createdAt));
    const base = lineas[0];
    const totalFisico = lineas.reduce((suma, linea) => suma + Number(linea.cantidadFisica || 0), 0);
    const conSicar = [...lineas]
      .filter(linea => linea.stockSicar !== null && linea.stockSicar !== undefined)
      .sort((a, b) => fechaMs(b.updatedAt) - fechaMs(a.updatedAt))[0] || null;
    const stockSicar = conSicar ? Number(conSicar.stockSicar) : null;
    const completado = stockSicar !== null && lineas.every(linea => linea.estado === 'COMPLETADO');

    const ubicacionesHabituales = (base.producto?.zonas || [])
      .map(rel => rel.zona)
      .filter(zona => zona?.activo !== false)
      .map(zona => ({ id: zona.id, nombre: zona.nombre }));

    const zonasContadasIds = new Set(lineas.map(linea => linea.zonaId).filter(Boolean));
    const zonasContadasNombres = new Set(lineas.map(linea => String(linea.seccionCapturada || linea.zona?.nombre || '').trim()).filter(Boolean));
    const pendientes = ubicacionesHabituales.filter(zona => !zonasContadasIds.has(zona.id));
    const habitualesIds = new Set(ubicacionesHabituales.map(z => z.id));
    const noHabituales = lineas
      .filter(linea => linea.zonaId && !habitualesIds.has(linea.zonaId))
      .map(linea => ({ id: linea.zonaId, nombre: linea.seccionCapturada || linea.zona?.nombre || 'Ubicación' }));

    const participantesMap = new Map();
    for (const linea of lineas) {
      const u = linea.usuario;
      if (!u?.id) continue;
      if (!participantesMap.has(u.id)) {
        participantesMap.set(u.id, {
          id: u.id,
          nombre: u.nombre || u.username || 'Usuario',
          username: u.username || null,
          rol: u.rol || null,
          conteos: 0
        });
      }
      participantesMap.get(u.id).conteos += 1;
    }
    const participantesConteo = [...participantesMap.values()];

    const tiempos = lineas.map(linea => fechaMs(linea.createdAt)).filter(Boolean);
    const inicioMs = tiempos.length ? Math.min(...tiempos) : 0;
    const finMs = tiempos.length ? Math.max(...tiempos) : 0;
    const minutosEntreConteos = tiempos.length > 1 ? Math.round((finMs - inicioMs) / 60000) : 0;

    const desgloseUbicaciones = lineas.map(linea => ({
      id: linea.id,
      zonaId: linea.zonaId || null,
      zonaNombre: linea.seccionCapturada || linea.zona?.nombre || 'Sin ubicación',
      cantidadFisica: Number(linea.cantidadFisica || 0),
      createdAt: linea.createdAt,
      updatedAt: linea.updatedAt,
      usuario: linea.usuario || null,
      ubicacionHabitual: Boolean(linea.zonaId && habitualesIds.has(linea.zonaId))
    }));

    const nombres = [...zonasContadasNombres];
    return {
      ...base,
      id: base.id,
      cantidadFisica: totalFisico,
      stockSicar,
      diferencia: completado ? totalFisico - stockSicar : null,
      estado: completado ? 'COMPLETADO' : 'PENDIENTE',
      seccionCapturada: nombres.length === 1 ? nombres[0] : nombres.length ? nombres.join(' · ') : 'Sin ubicación',
      createdAt: inicioMs ? new Date(inicioMs) : base.createdAt,
      updatedAt: new Date(Math.max(...lineas.map(linea => fechaMs(linea.updatedAt) || fechaMs(linea.createdAt)))),
      usuario: participantesConteo.length === 1
        ? base.usuario
        : { id: 'multiple', nombre: `${participantesConteo.length} participantes`, username: null, rol: null },
      participantesConteo,
      desgloseUbicaciones,
      ubicacionesHabituales,
      conteoCoordinado: {
        requerido: ubicacionesHabituales.length > 1,
        completo: pendientes.length === 0,
        pendientes,
        noHabituales,
        ventanaMinutos: VENTANA_COORDINADA_MINUTOS,
        minutosEntreConteos,
        desfasado: lineas.length > 1 && minutosEntreConteos > VENTANA_COORDINADA_MINUTOS
      }
    };
  }).sort((a, b) => fechaMs(b.createdAt) - fechaMs(a.createdAt));
}

module.exports = { agruparCapturasPorProducto, VENTANA_COORDINADA_MINUTOS };
