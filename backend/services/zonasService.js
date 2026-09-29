const prisma = require('../config/db');

// La migración de zonas legadas solo necesita ejecutarse una vez por proceso.
// Antes se consultaba la BD en cada GET/POST de productos, zonas y capturas, lo que
// agregaba latencia innecesaria (especialmente con Supabase remoto).
let sincronizacionCompleta = false;
let sincronizacionEnCurso = null;

async function ejecutarSincronizacionZonasLegadas() {
  const [relaciones, totalZonas] = await Promise.all([
    prisma.productoZona.count(),
    prisma.zona.count()
  ]);

  if (relaciones === 0 && totalZonas === 0) {
    const productos = await prisma.producto.findMany({
      where: { seccion: { not: null } },
      select: { id: true, seccion: true }
    });

    const porNombre = new Map();
    for (const producto of productos) {
      const nombre = String(producto.seccion || '').trim();
      if (!nombre) continue;
      if (!porNombre.has(nombre)) porNombre.set(nombre, []);
      porNombre.get(nombre).push(producto.id);
    }

    for (const [nombre, productoIds] of porNombre.entries()) {
      const zona = await prisma.zona.upsert({
        where: { nombre },
        update: { activo: true },
        create: { nombre }
      });
      await prisma.productoZona.createMany({
        data: productoIds.map(productoId => ({ productoId, zonaId: zona.id })),
        skipDuplicates: true
      });
    }
  }

  // Vincula capturas antiguas con la nueva entidad Zona usando el snapshot textual.
  // Se conserva seccionCapturada para que renombrar/eliminar una zona nunca cambie el historial.
  const pendientes = await prisma.captura.count({ where: { zonaId: null, seccionCapturada: { not: null } } });
  if (pendientes > 0) {
    const zonas = await prisma.zona.findMany({ select: { id: true, nombre: true } });
    for (const zona of zonas) {
      try {
        await prisma.captura.updateMany({
          where: { zonaId: null, seccionCapturada: zona.nombre },
          data: { zonaId: zona.id }
        });
      } catch (error) {
        // Si existiera un dato histórico atípico que chocara con la nueva restricción
        // de unicidad, se deja como legado (zonaId NULL) en vez de perder información.
        if (error?.code !== 'P2002') throw error;
      }
    }
  }
}

async function sincronizarZonasLegadas() {
  if (sincronizacionCompleta) return;
  if (sincronizacionEnCurso) return sincronizacionEnCurso;

  sincronizacionEnCurso = ejecutarSincronizacionZonasLegadas()
    .then(() => { sincronizacionCompleta = true; })
    .finally(() => { sincronizacionEnCurso = null; });

  return sincronizacionEnCurso;
}

module.exports = { sincronizarZonasLegadas };
