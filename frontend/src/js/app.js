let zonas = [];
let productosDia = [];
let capturas = [];
let filtroActual = 'todos';
let refrescandoCapturas = false;
let codigoEmpleadoPreview = '';
let codigoProductoMultiubicacionActivo = '';
let appEventosInicializados = false;
let intervaloRecepcion = null;
let sesionInventarioActiva = null;
let eventosInventarioAbortController = null;
let eventosInventarioReconectarTimer = null;
let sincronizacionTiempoRealTimer = null;
const sincronizacionTiempoRealPendiente = { capturas: false, productos: false, sesion: false };
let usuariosAdmin = [];
let cargandoUsuariosAdmin = false;
let passwordTemporalActual = '';
let historialInventariosAdmin = [];
let detalleInventarioAdmin = null;
let cargandoHistorialAdmin = false;
let filtrosHistorialAdmin = { desde: '', hasta: '' };
let filtrosDetalleHistorialAdmin = { desde: '', hasta: '', departamento: '', zona: '' };
let filtroMapeoAdmin = '';
const borradoresSicar = new Map();

function normalizarZona(z) {
    return {
        id: z.id,
        nombre: z.nombre || 'Ubicación',
        totalProductos: Number(z?._count?.productos || z.totalProductos || 0)
    };
}

function extraerUbicacionesProducto(p) {
    const relaciones = Array.isArray(p?.zonas) ? p.zonas : [];
    const ubicaciones = relaciones
        .map(rel => rel?.zona || rel)
        .filter(z => z?.id && z?.nombre && z?.activo !== false)
        .map(z => ({ id: z.id, nombre: z.nombre }));
    return ubicaciones;
}

function normalizarProducto(p) {
    const ubicaciones = extraerUbicacionesProducto(p);
    return {
        id: p.id,
        codigo: String(p.codigo || '').trim(),
        nombre: p.nombre || 'Producto sin nombre',
        precio: Number(p.precio || 0),
        stock: Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0,
        depto: p.categoria || 'General',
        zona: ubicaciones[0]?.nombre || p.seccion || '',
        ubicaciones,
        contado: false
    };
}

function normalizarCaptura(c) {
    const desglose = Array.isArray(c.desgloseUbicaciones) ? c.desgloseUbicaciones : [];
    return {
        id: c.id,
        fechahora: c.createdAt || c.fechahora,
        codigo: c.producto?.codigo || c.codigo || '',
        productoId: c.producto?.id || c.productoId || '',
        producto: c.producto?.nombre || c.productoNombre || c.producto || 'Producto no identificado',
        fisico: Number(c.cantidadFisica ?? c.fisico ?? 0),
        sicar: c.stockSicar ?? c.sicar ?? null,
        diferencia: c.diferencia ?? null,
        estado: String(c.estado || 'PENDIENTE').toLowerCase(),
        zonaId: c.zonaId || c.zona?.id || null,
        zona: c.zona?.nombre || c.seccionCapturada || c.zona || c.producto?.seccion || 'Sin ubicación',
        usuarioNombre: c.usuario?.nombre || c.usuarioNombre || c.usuario?.username || 'Sin identificar',
        usuarioUsername: c.usuario?.username || c.usuarioUsername || '',
        participantesConteo: Array.isArray(c.participantesConteo) ? c.participantesConteo : [],
        desgloseUbicaciones: desglose,
        ubicacionesHabituales: Array.isArray(c.ubicacionesHabituales) ? c.ubicacionesHabituales : [],
        conteoCoordinado: c.conteoCoordinado || null
    };
}

async function cargarZonasDesdeBD({ silencioso = false } = {}) {
    try {
        const respuesta = await apiObtenerZonas();
        zonas = Array.isArray(respuesta?.data) ? respuesta.data.map(normalizarZona) : [];
        renderizarSelectorUbicacionEmpleado();
        renderizarMapeoAdmin();
        return true;
    } catch (error) {
        console.error('Error al cargar ubicaciones:', error);
        if (!silencioso) mostrarToast(`No se pudieron cargar las ubicaciones: ${error.message}`, 'error');
        return false;
    }
}

function sincronizarProductosContados() {
    const paresContados = new Set();
    capturas.forEach(c => {
        if (Array.isArray(c.desgloseUbicaciones) && c.desgloseUbicaciones.length) {
            c.desgloseUbicaciones.forEach(d => {
                if (c.codigo && d.zonaId) paresContados.add(`${c.codigo}:${d.zonaId}`);
            });
        } else if (c.codigo && c.zonaId) {
            paresContados.add(`${c.codigo}:${c.zonaId}`);
        }
    });

    productosDia.forEach(p => {
        p.conteosPorZona = new Set((p.ubicaciones || []).filter(z => paresContados.has(`${p.codigo}:${z.id}`)).map(z => z.id));
        p.contado = p.ubicaciones.length > 0 && p.ubicaciones.every(z => paresContados.has(`${p.codigo}:${z.id}`));
    });
}

function productoContadoEnZona(producto, zonaId) {
    return Boolean(producto?.codigo && zonaId && capturas.some(c => {
        if (c.codigo !== producto.codigo) return false;
        if (Array.isArray(c.desgloseUbicaciones) && c.desgloseUbicaciones.length) {
            return c.desgloseUbicaciones.some(d => d.zonaId === zonaId);
        }
        return c.zonaId === zonaId;
    }));
}

async function cargarProductosDesdeBD() {
    try {
        const data = await apiObtenerProductos();
        productosDia = Array.isArray(data) ? data.map(normalizarProducto) : [];
        sincronizarProductosContados();
        renderizarListaEmpleado();
        renderizarMapeoAdmin();
        return true;
    } catch (error) {
        console.error('Error al cargar productos:', error);
        mostrarToast(`No se pudieron cargar los productos: ${error.message}`, 'error');
        return false;
    }
}

function hayEdicionSicarActiva() {
    const activo = document.activeElement;
    return Boolean(activo && activo.tagName === 'INPUT' && String(activo.id || '').startsWith('sicar-'));
}

async function cargarCapturasDesdeBD({ silencioso = false } = {}) {
    if (refrescandoCapturas) return;
    refrescandoCapturas = true;
    try {
        const respuesta = usuarioActualEsAdmin()
            ? await apiObtenerCapturas()
            : await apiObtenerProgresoInventario();
        capturas = Array.isArray(respuesta?.data) ? respuesta.data.map(normalizarCaptura) : [];
        if (respuesta && Object.prototype.hasOwnProperty.call(respuesta, 'sesion')) {
            sesionInventarioActiva = respuesta.sesion || null;
            actualizarIndicadoresSesion();
        }
        sincronizarProductosContados();
        if (usuarioActualEsAdmin()) {
            // Si el administrador está escribiendo una existencia de SICAR, agregamos solo
            // las filas nuevas sin reconstruir su input. Así las capturas aparecen en vivo
            // sin quitarle el foco ni borrar lo que está escribiendo.
            if (hayEdicionSicarActiva()) insertarCapturasNuevasEnTabla();
            else renderizarTabla();
        }
        renderizarListaEmpleado();
        renderizarTareasCoordinadas();
    } catch (error) {
        console.error('Error al cargar capturas:', error);
        if (!silencioso) mostrarToast(`No se pudieron cargar las capturas: ${error.message}`, 'error');
    } finally {
        refrescandoCapturas = false;
    }
}

async function cargarSesionInventarioActiva() {
    try {
        const respuesta = await apiObtenerSesionActiva();
        sesionInventarioActiva = respuesta?.data || null;
        actualizarIndicadoresSesion();
        return sesionInventarioActiva;
    } catch (error) {
        console.error('Error al cargar el inventario activo:', error);
        return null;
    }
}

function actualizarIndicadoresSesion() {
    const haySesion = Boolean(sesionInventarioActiva?.id);
    const nombre = haySesion ? sesionInventarioActiva.nombre : 'Sin inventario activo';
    const fecha = haySesion && sesionInventarioActiva?.fechaInicio
        ? formatearFecha(sesionInventarioActiva.fechaInicio)
        : '--';

    const labelOperativo = document.getElementById('sesion-operativa-label');
    const labelAdmin = document.getElementById('sesion-admin-label');
    const fechaAdmin = document.getElementById('sesion-admin-fecha');
    const btnFinalizar = document.getElementById('btn-finalizar-inventario');
    const btnIniciar = document.getElementById('btn-iniciar-inventario');
    const btnRegistrar = document.getElementById('btn-registrar-conteo');

    if (labelOperativo) labelOperativo.textContent = nombre;
    if (labelAdmin) labelAdmin.textContent = nombre;
    if (fechaAdmin) {
        fechaAdmin.textContent = haySesion
            ? `Iniciado: ${fecha}`
            : 'Finaliza el inventario anterior o inicia uno nuevo para continuar.';
    }

    btnFinalizar?.classList.toggle('hidden', !haySesion);
    btnIniciar?.classList.toggle('hidden', haySesion);

    if (btnRegistrar) {
        btnRegistrar.disabled = !haySesion;
        btnRegistrar.classList.toggle('opacity-50', !haySesion);
        btnRegistrar.classList.toggle('cursor-not-allowed', !haySesion);
        btnRegistrar.title = haySesion ? '' : 'No hay un inventario activo';
    }
}

async function iniciarNuevoInventario() {
    if (!usuarioActualEsAdmin()) {
        mostrarToast('Solo un administrador puede iniciar un inventario', 'error');
        return;
    }

    if (sesionInventarioActiva?.id) {
        mostrarToast('Primero finaliza el inventario activo', 'error');
        return;
    }

    const confirmado = window.confirm(
        'Se iniciará una nueva sesión de inventario.\n\n' +
        'Todos los productos estarán disponibles nuevamente para conteo.\n\n' +
        '¿Deseas continuar?'
    );
    if (!confirmado) return;

    try {
        const respuesta = await apiIniciarNuevaSesion();
        sesionInventarioActiva = respuesta?.data || null;
        capturas = [];
        borradoresSicar.clear();
        productosDia.forEach(producto => { producto.contado = false; });
        filtroActual = 'todos';
        actualizarIndicadoresSesion();
        await cargarCapturasDesdeBD({ silencioso: true });
        renderizarListaEmpleado();
        renderizarTabla();
        mostrarToast('Nuevo inventario iniciado. Todos los productos están pendientes.');
    } catch (error) {
        console.error(error);
        mostrarToast(`No se pudo iniciar el nuevo inventario: ${error.message}`, 'error');
    }
}

async function finalizarInventario({ forzar = false } = {}) {
    if (!usuarioActualEsAdmin()) {
        mostrarToast('Solo un administrador puede finalizar un inventario', 'error');
        return;
    }

    if (!sesionInventarioActiva?.id) {
        mostrarToast('No hay un inventario activo para finalizar', 'error');
        return;
    }

    if (!forzar) {
        const confirmado = window.confirm(
            `¿Deseas finalizar "${sesionInventarioActiva.nombre}"?\n\n` +
            'Después de cerrarlo sus conteos y validaciones quedarán como historial de solo lectura.'
        );
        if (!confirmado) return;
    }

    try {
        const respuesta = await apiFinalizarSesionInventario(forzar);
        const resumen = respuesta?.data?.resumen || {};

        sesionInventarioActiva = null;
        capturas = [];
        borradoresSicar.clear();
        productosDia.forEach(producto => { producto.contado = false; });
        filtroActual = 'todos';
        actualizarIndicadoresSesion();
        renderizarListaEmpleado();
        renderizarTabla();

        if (usuarioActualEsAdmin()) {
            await cargarHistorialInventarios({ silencioso: true });
        }

        const diferencias = Number(resumen.conDiferencia || 0);
        mostrarToast(`Inventario finalizado: ${resumen.validadas || 0} validados, ${diferencias} con diferencia.`);
    } catch (error) {
        console.error(error);

        if (error?.code === 'INVENTORY_HAS_PENDING' && !forzar) {
            const pendientes = Number(error?.body?.pendientes || 0);
            const confirmarForzado = window.confirm(
                `Quedan ${pendientes} conteos pendientes de validar contra SICAR.\n\n` +
                'Si finalizas ahora, esos registros quedarán pendientes dentro del historial y ya no podrán modificarse.\n\n' +
                '¿Deseas finalizar de todas formas?'
            );
            if (confirmarForzado) await finalizarInventario({ forzar: true });
            return;
        }

        if (error?.code === 'INVENTORY_EMPTY' && !forzar) {
            const confirmarVacio = window.confirm(
                'Este inventario todavía no tiene ningún conteo registrado.\n\n' +
                'Normalmente no deberías cerrarlo vacío. ¿Deseas finalizarlo de todas formas?'
            );
            if (confirmarVacio) await finalizarInventario({ forzar: true });
            return;
        }

        mostrarToast(`No se pudo finalizar el inventario: ${error.message}`, 'error');
    }
}

function formatoFechaSoloDia(fechaISO) {
    if (!fechaISO) return '--';
    const [year, month, day] = String(fechaISO).split('-').map(Number);
    if (!year || !month || !day) return escaparHtml(String(fechaISO));
    return new Date(year, month - 1, day).toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    });
}

function claveFechaMonterrey(fecha) {
    if (!fecha) return '';
    const d = new Date(fecha);
    if (Number.isNaN(d.getTime())) return '';

    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Monterrey',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(d);
    const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
    return `${valores.year}-${valores.month}-${valores.day}`;
}

function formatearBalanceUnidades(valor) {
    const numero = Number(valor || 0);
    return numero > 0 ? `+${numero}` : String(numero);
}

function normalizarTextoFiltro(valor) {
    return String(valor || '').trim().toLocaleLowerCase('es-MX');
}

function actualizarFiltrosHistorial() {
    filtrosHistorialAdmin = {
        desde: document.getElementById('historial-filtro-desde')?.value || '',
        hasta: document.getElementById('historial-filtro-hasta')?.value || ''
    };
    renderizarHistorialInventarios();
}

function limpiarFiltrosHistorial() {
    filtrosHistorialAdmin = { desde: '', hasta: '' };
    const desde = document.getElementById('historial-filtro-desde');
    const hasta = document.getElementById('historial-filtro-hasta');
    if (desde) desde.value = '';
    if (hasta) hasta.value = '';
    renderizarHistorialInventarios();
}

function sesionesHistorialFiltradas() {
    const { desde, hasta } = filtrosHistorialAdmin;
    if (!desde && !hasta) return historialInventariosAdmin;

    return historialInventariosAdmin.filter(sesion => {
        const inicio = claveFechaMonterrey(sesion.fechaInicio);
        const fin = claveFechaMonterrey(sesion.fechaFin || sesion.fechaInicio);
        if (desde && fin && fin < desde) return false;
        if (hasta && inicio && inicio > hasta) return false;
        return true;
    });
}

async function cargarHistorialInventarios({ silencioso = false } = {}) {
    if (!usuarioActualEsAdmin() || cargandoHistorialAdmin) return;
    cargandoHistorialAdmin = true;

    const contenedor = document.getElementById('historial-lista');
    if (!silencioso && contenedor && historialInventariosAdmin.length === 0) {
        contenedor.innerHTML = '<div class="p-8 text-center text-xs text-gray-400"><i class="fa-solid fa-spinner fa-spin me-1"></i> Cargando historial...</div>';
    }

    try {
        const respuesta = await apiObtenerHistorialInventarios();
        historialInventariosAdmin = Array.isArray(respuesta?.data) ? respuesta.data : [];
        renderizarHistorialInventarios();
    } catch (error) {
        console.error('Error al cargar historial:', error);
        if (contenedor) {
            contenedor.innerHTML = `<div class="p-8 text-center text-xs text-red-600">${escaparHtml(error.message || 'No se pudo cargar el historial')}</div>`;
        }
        if (!silencioso) mostrarToast(`No se pudo cargar el historial: ${error.message}`, 'error');
    } finally {
        cargandoHistorialAdmin = false;
    }
}

function renderizarHistorialInventarios() {
    const contenedor = document.getElementById('historial-lista');
    if (!contenedor) return;

    const sesiones = sesionesHistorialFiltradas();
    const contador = document.getElementById('historial-filtro-contador');
    if (contador) {
        contador.textContent = filtrosHistorialAdmin.desde || filtrosHistorialAdmin.hasta
            ? `${sesiones.length} de ${historialInventariosAdmin.length} inventarios`
            : `${historialInventariosAdmin.length} inventarios`;
    }

    if (!historialInventariosAdmin.length) {
        contenedor.innerHTML = `
            <div class="p-10 text-center text-gray-400">
                <i class="fa-solid fa-box-archive text-3xl mb-2"></i>
                <div class="text-sm font-bold text-slate-600">Todavía no hay inventarios finalizados</div>
                <div class="text-xs mt-1">Cuando cierres el inventario actual aparecerá aquí automáticamente.</div>
            </div>`;
        return;
    }

    if (!sesiones.length) {
        contenedor.innerHTML = `
            <div class="bg-white border rounded-xl p-8 text-center text-gray-400">
                <i class="fa-solid fa-filter-circle-xmark text-2xl mb-2"></i>
                <div class="text-sm font-bold text-slate-600">No hay inventarios en ese rango de fechas</div>
                <div class="text-xs mt-1">Cambia las fechas o limpia los filtros para volver a mostrar todo el historial.</div>
            </div>`;
        return;
    }

    contenedor.innerHTML = sesiones.map(sesion => {
        const r = sesion.resumen || {};
        return `
            <article class="bg-white border rounded-xl shadow-sm p-4 hover:border-amber-300 transition">
                <div class="flex flex-wrap justify-between gap-3 items-start">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            <h3 class="font-bold text-slate-900">${escaparHtml(sesion.nombre || 'Inventario')}</h3>
                            <span class="text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-slate-100 text-slate-600">Finalizado</span>
                        </div>
                        <div class="text-[11px] text-gray-400 mt-1">${formatearFecha(sesion.fechaInicio)} → ${formatearFecha(sesion.fechaFin)}</div>
                    </div>
                    <button type="button" onclick="abrirDetalleInventario('${escaparHtml(sesion.id)}')"
                            class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-2 rounded-lg text-xs whitespace-nowrap">
                        <i class="fa-solid fa-eye me-1 text-amber-400"></i> Ver detalle
                    </button>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
                    <div class="bg-slate-50 rounded-lg p-2.5"><div class="text-[9px] uppercase font-bold text-gray-400">Contados</div><div class="font-bold text-slate-900">${r.totalCapturas || 0}</div></div>
                    <div class="bg-emerald-50 rounded-lg p-2.5"><div class="text-[9px] uppercase font-bold text-emerald-600">Validados</div><div class="font-bold text-emerald-700">${r.validadas || 0}</div></div>
                    <div class="bg-amber-50 rounded-lg p-2.5"><div class="text-[9px] uppercase font-bold text-amber-600">Pendientes</div><div class="font-bold text-amber-700">${r.pendientes || 0}</div></div>
                    <div class="bg-red-50 rounded-lg p-2.5"><div class="text-[9px] uppercase font-bold text-red-500">Con diferencia</div><div class="font-bold text-red-600">${r.conDiferencia || 0}</div></div>
                    <div class="bg-indigo-50 rounded-lg p-2.5 col-span-2 md:col-span-1"><div class="text-[9px] uppercase font-bold text-indigo-500">Balance unidades</div><div class="font-bold text-indigo-700">${formatearBalanceUnidades(r.balanceUnidades)}</div></div>
                </div>
            </article>`;
    }).join('');
}

async function abrirDetalleInventario(id) {
    if (!usuarioActualEsAdmin()) return;
    const panel = document.getElementById('historial-detalle');
    const contenido = document.getElementById('historial-detalle-contenido');
    panel?.classList.remove('hidden');
    if (contenido) contenido.innerHTML = '<div class="p-8 text-center text-xs text-gray-400"><i class="fa-solid fa-spinner fa-spin me-1"></i> Cargando detalle...</div>';

    try {
        const respuesta = await apiObtenerDetalleInventario(id);
        detalleInventarioAdmin = respuesta?.data || null;
        filtrosDetalleHistorialAdmin = { desde: '', hasta: '', departamento: '', zona: '' };
        renderizarDetalleInventario();
        panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        console.error(error);
        if (contenido) contenido.innerHTML = `<div class="p-8 text-center text-xs text-red-600">${escaparHtml(error.message || 'No se pudo cargar el detalle')}</div>`;
    }
}

function cerrarDetalleInventario() {
    detalleInventarioAdmin = null;
    filtrosDetalleHistorialAdmin = { desde: '', hasta: '', departamento: '', zona: '' };
    document.getElementById('historial-detalle')?.classList.add('hidden');
}

function valorDepartamentoRegistro(registro) {
    return String(registro?.producto?.categoria || 'General').trim() || 'General';
}

function zonasRegistro(registro) {
    const desglose = Array.isArray(registro?.desgloseUbicaciones) ? registro.desgloseUbicaciones : [];
    const nombres = desglose.map(d => String(d?.zonaNombre || '').trim()).filter(Boolean);
    if (nombres.length) return [...new Set(nombres)];
    return [String(registro?.seccionCapturada || registro?.producto?.seccion || 'General').trim() || 'General'];
}

function valorZonaRegistro(registro) {
    return zonasRegistro(registro).join(' · ');
}

function leerFiltrosDetalleHistorial() {
    filtrosDetalleHistorialAdmin = {
        desde: document.getElementById('detalle-filtro-desde')?.value || '',
        hasta: document.getElementById('detalle-filtro-hasta')?.value || '',
        departamento: document.getElementById('detalle-filtro-departamento')?.value || '',
        zona: document.getElementById('detalle-filtro-zona')?.value || ''
    };
}

function aplicarFiltrosDetalleHistorial() {
    leerFiltrosDetalleHistorial();
    renderizarDetalleInventario();
}

function limpiarFiltrosDetalleHistorial() {
    filtrosDetalleHistorialAdmin = { desde: '', hasta: '', departamento: '', zona: '' };
    renderizarDetalleInventario();
}

function obtenerRegistrosDetalleFiltrados() {
    const registros = Array.isArray(detalleInventarioAdmin?.capturas) ? detalleInventarioAdmin.capturas : [];
    const { desde, hasta, departamento, zona } = filtrosDetalleHistorialAdmin;
    const deptoNormalizado = normalizarTextoFiltro(departamento);
    const zonaNormalizada = normalizarTextoFiltro(zona);

    return registros.filter(registro => {
        const fecha = claveFechaMonterrey(registro.createdAt);
        if (desde && fecha && fecha < desde) return false;
        if (hasta && fecha && fecha > hasta) return false;
        if (deptoNormalizado && normalizarTextoFiltro(valorDepartamentoRegistro(registro)) !== deptoNormalizado) return false;
        if (zonaNormalizada && !zonasRegistro(registro).some(nombre => normalizarTextoFiltro(nombre) === zonaNormalizada)) return false;
        return true;
    });
}

function construirResumenRegistrosFrontend(registros = []) {
    const resumen = {
        totalCapturas: registros.length,
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

    registros.forEach(registro => {
        const completado = registro.estado === 'COMPLETADO';
        if (completado) resumen.validadas += 1;
        else resumen.pendientes += 1;

        if (completado && Number.isInteger(registro.diferencia)) {
            const diferencia = registro.diferencia;
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

        const listaParticipantes = Array.isArray(registro.participantesConteo) && registro.participantesConteo.length
            ? registro.participantesConteo
            : registro.usuario ? [{ ...registro.usuario, conteos: 1 }] : [];
        listaParticipantes.forEach(usuario => {
            const clave = usuario?.id || usuario?.username || usuario?.nombre || 'sin-identificar';
            if (!participantes.has(clave)) participantes.set(clave, { nombre: usuario?.nombre || usuario?.username || 'Sin identificar', conteos: 0 });
            participantes.get(clave).conteos += Number(usuario.conteos || 1);
        });
    });

    resumen.participantes = [...participantes.values()]
        .sort((a, b) => b.conteos - a.conteos || a.nombre.localeCompare(b.nombre, 'es'));
    return resumen;
}

function construirResumenDiasFrontend(registros = []) {
    const dias = new Map();
    registros.forEach(registro => {
        const fecha = claveFechaMonterrey(registro.createdAt);
        if (!fecha) return;
        if (!dias.has(fecha)) dias.set(fecha, { fecha, registros: [] });
        dias.get(fecha).registros.push(registro);
    });

    return [...dias.values()]
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .map(dia => ({ fecha: dia.fecha, ...construirResumenRegistrosFrontend(dia.registros) }));
}

function opcionesSelectHistorial(valores, seleccionado, etiquetaTodos) {
    const unicos = [...new Set(valores.map(v => String(v || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    return [
        `<option value="">${escaparHtml(etiquetaTodos)}</option>`,
        ...unicos.map(valor => `<option value="${escaparHtml(valor)}" ${valor === seleccionado ? 'selected' : ''}>${escaparHtml(valor)}</option>`)
    ].join('');
}

function descripcionFiltrosReporte() {
    const f = filtrosDetalleHistorialAdmin;
    const partes = [];
    if (f.desde) partes.push(`Desde: ${f.desde}`);
    if (f.hasta) partes.push(`Hasta: ${f.hasta}`);
    if (f.departamento) partes.push(`Departamento: ${f.departamento}`);
    if (f.zona) partes.push(`Zona: ${f.zona}`);
    return partes.length ? partes.join(' | ') : 'Sin filtros (inventario completo)';
}

function nombreArchivoSeguro(nombre) {
    return String(nombre || 'inventario')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 70) || 'inventario';
}

function datosDetalleParaReporte(registros) {
    return registros.map(registro => ({
        'Fecha y hora': formatearFecha(registro.createdAt),
        'Código': registro.producto?.codigo || '',
        'Producto': registro.producto?.nombre || '',
        'Departamento': valorDepartamentoRegistro(registro),
        'Zona': valorZonaRegistro(registro),
        'Contado por': Array.isArray(registro.participantesConteo) && registro.participantesConteo.length ? registro.participantesConteo.map(p => p.nombre || p.username).filter(Boolean).join(', ') : (registro.usuario?.nombre || registro.usuario?.username || 'Sin identificar'),
        'Físico': registro.cantidadFisica,
        'SICAR': registro.stockSicar ?? '',
        'Diferencia': registro.diferencia ?? '',
        'Estado': registro.estado === 'COMPLETADO' ? 'Validado' : 'Pendiente'
    }));
}

function exportarInventarioExcel() {
    if (!detalleInventarioAdmin) return;
    if (!window.XLSX) {
        mostrarToast('No se pudo cargar el componente de exportación Excel', 'error');
        return;
    }

    const registros = obtenerRegistrosDetalleFiltrados();
    if (!registros.length) {
        mostrarToast('No hay registros para exportar con los filtros actuales', 'error');
        return;
    }

    const { sesion } = detalleInventarioAdmin;
    const resumen = construirResumenRegistrosFrontend(registros);
    const dias = construirResumenDiasFrontend(registros);
    const wb = XLSX.utils.book_new();

    const resumenRows = [
        ['REPORTE DE AUDITORÍA DE INVENTARIO'],
        ['Inventario', sesion?.nombre || 'Inventario'],
        ['Inicio', formatearFecha(sesion?.fechaInicio)],
        ['Finalización', formatearFecha(sesion?.fechaFin)],
        ['Filtros', descripcionFiltrosReporte()],
        [],
        ['Indicador', 'Resultado'],
        ['Productos contados', resumen.totalCapturas],
        ['Validados', resumen.validadas],
        ['Pendientes', resumen.pendientes],
        ['Sin diferencia', resumen.sinDiferencia],
        ['Con diferencia', resumen.conDiferencia],
        ['Productos faltantes', resumen.productosFaltantes],
        ['Productos sobrantes', resumen.productosSobrantes],
        ['Unidades faltantes', resumen.unidadesFaltantes],
        ['Unidades sobrantes', resumen.unidadesSobrantes],
        ['Balance de unidades', resumen.balanceUnidades]
    ];
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
    wsResumen['!cols'] = [{ wch: 28 }, { wch: 55 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    const detalle = datosDetalleParaReporte(registros);
    const wsDetalle = XLSX.utils.json_to_sheet(detalle);
    wsDetalle['!cols'] = [
        { wch: 20 }, { wch: 18 }, { wch: 42 }, { wch: 24 }, { wch: 24 },
        { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }
    ];
    XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle');

    const desgloseUbicaciones = registros.flatMap(registro => {
        const lineas = Array.isArray(registro.desgloseUbicaciones) && registro.desgloseUbicaciones.length
            ? registro.desgloseUbicaciones
            : [{ zonaNombre: valorZonaRegistro(registro), cantidadFisica: registro.cantidadFisica, createdAt: registro.createdAt, usuario: registro.usuario }];
        return lineas
            .filter(linea => !filtrosDetalleHistorialAdmin.zona || normalizarTextoFiltro(linea.zonaNombre) === normalizarTextoFiltro(filtrosDetalleHistorialAdmin.zona))
            .map(linea => ({
                'Fecha y hora': formatearFecha(linea.createdAt),
                'Código': registro.producto?.codigo || '',
                'Producto': registro.producto?.nombre || '',
                'Departamento': valorDepartamentoRegistro(registro),
                'Ubicación': linea.zonaNombre || 'Sin ubicación',
                'Cantidad en ubicación': Number(linea.cantidadFisica || 0),
                'Contado por': linea.usuario?.nombre || linea.usuario?.username || 'Sin identificar'
            }));
    });
    const wsDesglose = XLSX.utils.json_to_sheet(desgloseUbicaciones.length ? desgloseUbicaciones : [{ 'Resultado': 'Sin desglose disponible' }]);
    wsDesglose['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 42 }, { wch: 24 }, { wch: 28 }, { wch: 20 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, wsDesglose, 'Desglose ubicaciones');

    const actividad = dias.map(dia => ({
        'Fecha': dia.fecha,
        'Contados': dia.totalCapturas,
        'Validados': dia.validadas,
        'Pendientes': dia.pendientes,
        'Con diferencia': dia.conDiferencia,
        'Unidades faltantes': dia.unidadesFaltantes,
        'Unidades sobrantes': dia.unidadesSobrantes,
        'Balance': dia.balanceUnidades
    }));
    const wsActividad = XLSX.utils.json_to_sheet(actividad);
    wsActividad['!cols'] = Array(8).fill({ wch: 18 });
    XLSX.utils.book_append_sheet(wb, wsActividad, 'Actividad diaria');

    const participantes = resumen.participantes.map(p => ({
        'Participante': p.nombre,
        'Conteos': p.conteos
    }));
    const wsParticipantes = XLSX.utils.json_to_sheet(participantes);
    wsParticipantes['!cols'] = [{ wch: 35 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsParticipantes, 'Participantes');

    const diferencias = datosDetalleParaReporte(registros.filter(r => r.estado === 'COMPLETADO' && Number.isInteger(r.diferencia) && r.diferencia !== 0));
    const wsDiferencias = XLSX.utils.json_to_sheet(diferencias.length ? diferencias : [{ 'Resultado': 'Sin diferencias en los filtros seleccionados' }]);
    wsDiferencias['!cols'] = wsDetalle['!cols'];
    XLSX.utils.book_append_sheet(wb, wsDiferencias, 'Diferencias');

    const archivo = `${nombreArchivoSeguro(sesion?.nombre)}_${claveFechaMonterrey(sesion?.fechaFin || new Date())}.xlsx`;
    XLSX.writeFile(wb, archivo);
    mostrarToast('Reporte Excel generado correctamente');
}

function exportarInventarioPdf() {
    if (!detalleInventarioAdmin) return;
    const JsPDF = window.jspdf?.jsPDF;
    if (!JsPDF) {
        mostrarToast('No se pudo cargar el componente de exportación PDF', 'error');
        return;
    }

    const registros = obtenerRegistrosDetalleFiltrados();
    if (!registros.length) {
        mostrarToast('No hay registros para exportar con los filtros actuales', 'error');
        return;
    }

    const { sesion } = detalleInventarioAdmin;
    const resumen = construirResumenRegistrosFrontend(registros);
    const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Reporte de Auditoría de Inventario', 14, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Inventario: ${sesion?.nombre || 'Inventario'}`, 14, 21);
    doc.text(`Periodo: ${formatearFecha(sesion?.fechaInicio)} - ${formatearFecha(sesion?.fechaFin)}`, 14, 26);
    doc.text(`Filtros: ${descripcionFiltrosReporte()}`, 14, 31, { maxWidth: 265 });

    const resumenBody = [
        ['Contados', resumen.totalCapturas, 'Validados', resumen.validadas, 'Pendientes', resumen.pendientes],
        ['Sin diferencia', resumen.sinDiferencia, 'Con diferencia', resumen.conDiferencia, 'Balance', resumen.balanceUnidades],
        ['Unid. faltantes', resumen.unidadesFaltantes, 'Unid. sobrantes', resumen.unidadesSobrantes, 'Participantes', resumen.participantes.length]
    ];

    if (typeof doc.autoTable !== 'function') {
        mostrarToast('No se pudo cargar la tabla para exportación PDF', 'error');
        return;
    }

    doc.autoTable({
        startY: 37,
        body: resumenBody,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
            0: { fontStyle: 'bold' }, 2: { fontStyle: 'bold' }, 4: { fontStyle: 'bold' }
        }
    });

    const body = registros.map(registro => [
        formatearFecha(registro.createdAt),
        registro.producto?.codigo || '',
        registro.producto?.nombre || '',
        valorDepartamentoRegistro(registro),
        valorZonaRegistro(registro),
        registro.usuario?.nombre || registro.usuario?.username || 'Sin identificar',
        String(registro.cantidadFisica),
        registro.stockSicar ?? '--',
        registro.diferencia == null ? '--' : formatearDiferencia(registro.diferencia),
        registro.estado === 'COMPLETADO' ? 'Validado' : 'Pendiente'
    ]);

    doc.autoTable({
        startY: doc.lastAutoTable.finalY + 5,
        head: [['Fecha', 'Código', 'Producto', 'Departamento', 'Zona', 'Contado por', 'Físico', 'SICAR', 'Dif.', 'Estado']],
        body,
        theme: 'striped',
        styles: { fontSize: 6.8, cellPadding: 1.4, overflow: 'linebreak' },
        headStyles: { fontStyle: 'bold' },
        columnStyles: {
            0: { cellWidth: 24 },
            1: { cellWidth: 23 },
            2: { cellWidth: 47 },
            3: { cellWidth: 30 },
            4: { cellWidth: 30 },
            5: { cellWidth: 30 },
            6: { cellWidth: 12, halign: 'center' },
            7: { cellWidth: 12, halign: 'center' },
            8: { cellWidth: 12, halign: 'center' },
            9: { cellWidth: 16 }
        },
        didDrawPage: data => {
            const pagina = doc.internal.getNumberOfPages();
            doc.setFontSize(7);
            doc.setTextColor(120);
            doc.text(`La Flor de México · Página ${pagina}`, 282, 202, { align: 'right' });
            doc.setTextColor(0);
        }
    });

    const archivo = `${nombreArchivoSeguro(sesion?.nombre)}_${claveFechaMonterrey(sesion?.fechaFin || new Date())}.pdf`;
    doc.save(archivo);
    mostrarToast('Reporte PDF generado correctamente');
}

function renderizarDetalleInventario() {
    const contenido = document.getElementById('historial-detalle-contenido');
    if (!contenido || !detalleInventarioAdmin) return;

    const { sesion, capturas: todosRegistros = [] } = detalleInventarioAdmin;
    const registros = obtenerRegistrosDetalleFiltrados();
    const resumen = construirResumenRegistrosFrontend(registros);
    const dias = construirResumenDiasFrontend(registros);
    const participantes = resumen.participantes;

    const departamentos = todosRegistros.map(valorDepartamentoRegistro);
    const zonasDetalle = todosRegistros.flatMap(zonasRegistro);

    const filasDias = dias.length ? dias.map(dia => `
        <tr class="border-b last:border-0">
            <td class="p-3 font-semibold text-slate-800">${formatoFechaSoloDia(dia.fecha)}</td>
            <td class="p-3 text-center">${dia.totalCapturas || 0}</td>
            <td class="p-3 text-center text-emerald-700 font-bold">${dia.validadas || 0}</td>
            <td class="p-3 text-center text-amber-700 font-bold">${dia.pendientes || 0}</td>
            <td class="p-3 text-center text-red-600 font-bold">${dia.conDiferencia || 0}</td>
            <td class="p-3 text-center font-bold">${formatearBalanceUnidades(dia.balanceUnidades)}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="p-6 text-center text-xs text-gray-400">No hay actividad con los filtros seleccionados.</td></tr>';

    const filasDetalle = registros.length ? registros.map(registro => {
        const diferencia = registro.diferencia;
        const usuario = Array.isArray(registro.participantesConteo) && registro.participantesConteo.length ? registro.participantesConteo.map(p => p.nombre || p.username).filter(Boolean).join(', ') : (registro.usuario?.nombre || registro.usuario?.username || 'Sin identificar');
        const codigo = registro.producto?.codigo || '--';
        return `
            <tr class="border-b last:border-0">
                <td class="p-3 text-xs whitespace-nowrap">${formatearFecha(registro.createdAt)}</td>
                <td class="p-3 text-xs">
                    <div class="flex items-center gap-1.5">
                        <span class="font-mono">${escaparHtml(codigo)}</span>
                        <button type="button" data-code="${escaparHtml(codigo)}" onclick="copiarCodigoDesdeBoton(this)"
                                class="text-gray-400 hover:text-amber-600" title="Copiar código">
                            <i class="fa-regular fa-copy"></i>
                        </button>
                    </div>
                </td>
                <td class="p-3 font-semibold">${escaparHtml(registro.producto?.nombre || 'Producto')}</td>
                <td class="p-3">${escaparHtml(valorDepartamentoRegistro(registro))}</td>
                <td class="p-3">${escaparHtml(valorZonaRegistro(registro))}</td>
                <td class="p-3">${escaparHtml(usuario)}</td>
                <td class="p-3 text-center font-bold">${registro.cantidadFisica}</td>
                <td class="p-3 text-center">${registro.stockSicar ?? '--'}</td>
                <td class="p-3 text-center font-bold ${diferencia === 0 ? 'text-emerald-600' : diferencia == null ? 'text-gray-400' : 'text-red-600'}">${formatearDiferencia(diferencia)}</td>
                <td class="p-3"><span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase ${registro.estado === 'COMPLETADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${registro.estado === 'COMPLETADO' ? 'Validado' : 'Pendiente'}</span></td>
            </tr>`;
    }).join('') : '<tr><td colspan="10" class="p-6 text-center text-xs text-gray-400">No hay capturas que coincidan con los filtros seleccionados.</td></tr>';

    const participantesHtml = participantes.length
        ? participantes.map(p => `<span class="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-2 py-1 rounded-full text-[10px] font-semibold"><i class="fa-solid fa-user"></i>${escaparHtml(p.nombre)} · ${p.conteos}</span>`).join(' ')
        : '<span class="text-xs text-gray-400">Sin participantes en los filtros seleccionados.</span>';

    contenido.innerHTML = `
        <div class="flex flex-wrap justify-between gap-3 items-start border-b pb-4">
            <div>
                <div class="text-[10px] uppercase font-bold text-amber-600">Inventario finalizado</div>
                <h3 class="text-lg font-bold text-slate-900">${escaparHtml(sesion?.nombre || 'Inventario')}</h3>
                <div class="text-xs text-gray-400 mt-1">${formatearFecha(sesion?.fechaInicio)} → ${formatearFecha(sesion?.fechaFin)}</div>
            </div>
            <div class="flex items-center gap-2 flex-wrap justify-end">
                <button type="button" onclick="exportarInventarioExcel()"
                        class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-2 rounded-lg text-xs shadow whitespace-nowrap">
                    <i class="fa-solid fa-file-excel me-1"></i> Exportar Excel
                </button>
                <button type="button" onclick="exportarInventarioPdf()"
                        class="bg-red-600 hover:bg-red-500 text-white font-bold px-3 py-2 rounded-lg text-xs shadow whitespace-nowrap">
                    <i class="fa-solid fa-file-pdf me-1"></i> Exportar PDF
                </button>
                <button type="button" onclick="cerrarDetalleInventario()" class="text-gray-400 hover:text-slate-700 px-2" title="Cerrar detalle"><i class="fa-solid fa-xmark text-lg"></i></button>
            </div>
        </div>

        <div class="bg-slate-50 border rounded-xl p-4 space-y-3">
            <div class="flex flex-wrap justify-between gap-2 items-center">
                <div>
                    <div class="text-[10px] uppercase font-bold text-gray-400">Filtros del reporte</div>
                    <div class="text-xs text-slate-600">Fecha de conteo, departamento SICAR y zona física.</div>
                </div>
                <div class="text-[11px] font-bold text-slate-500">${registros.length} de ${todosRegistros.length} registros</div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                <div>
                    <label class="block text-[10px] font-bold text-gray-500 mb-1">Desde</label>
                    <input id="detalle-filtro-desde" type="date" value="${escaparHtml(filtrosDetalleHistorialAdmin.desde)}"
                           onchange="aplicarFiltrosDetalleHistorial()" class="w-full border rounded-lg p-2 text-xs bg-white outline-none focus:ring-2 focus:ring-amber-500">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-500 mb-1">Hasta</label>
                    <input id="detalle-filtro-hasta" type="date" value="${escaparHtml(filtrosDetalleHistorialAdmin.hasta)}"
                           onchange="aplicarFiltrosDetalleHistorial()" class="w-full border rounded-lg p-2 text-xs bg-white outline-none focus:ring-2 focus:ring-amber-500">
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-500 mb-1">Departamento</label>
                    <select id="detalle-filtro-departamento" onchange="aplicarFiltrosDetalleHistorial()"
                            class="w-full border rounded-lg p-2 text-xs bg-white outline-none focus:ring-2 focus:ring-amber-500">
                        ${opcionesSelectHistorial(departamentos, filtrosDetalleHistorialAdmin.departamento, 'Todos los departamentos')}
                    </select>
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-gray-500 mb-1">Zona física</label>
                    <select id="detalle-filtro-zona" onchange="aplicarFiltrosDetalleHistorial()"
                            class="w-full border rounded-lg p-2 text-xs bg-white outline-none focus:ring-2 focus:ring-amber-500">
                        ${opcionesSelectHistorial(zonasDetalle, filtrosDetalleHistorialAdmin.zona, 'Todas las zonas')}
                    </select>
                </div>
                <div class="flex items-end">
                    <button type="button" onclick="limpiarFiltrosDetalleHistorial()"
                            class="w-full border bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg p-2 text-xs">
                        <i class="fa-solid fa-filter-circle-xmark me-1"></i> Limpiar filtros
                    </button>
                </div>
            </div>
            <div class="text-[10px] text-gray-400"><i class="fa-solid fa-circle-info me-1"></i>Las exportaciones Excel y PDF respetan los filtros seleccionados.</div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
            <div class="bg-slate-50 rounded-lg p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Contados</div><div class="text-xl font-bold">${resumen.totalCapturas || 0}</div></div>
            <div class="bg-emerald-50 rounded-lg p-3"><div class="text-[9px] uppercase font-bold text-emerald-600">Validados</div><div class="text-xl font-bold text-emerald-700">${resumen.validadas || 0}</div></div>
            <div class="bg-amber-50 rounded-lg p-3"><div class="text-[9px] uppercase font-bold text-amber-600">Pendientes</div><div class="text-xl font-bold text-amber-700">${resumen.pendientes || 0}</div></div>
            <div class="bg-red-50 rounded-lg p-3"><div class="text-[9px] uppercase font-bold text-red-500">Con diferencia</div><div class="text-xl font-bold text-red-600">${resumen.conDiferencia || 0}</div></div>
            <div class="bg-emerald-50 rounded-lg p-3"><div class="text-[9px] uppercase font-bold text-emerald-600">Sin diferencia</div><div class="text-xl font-bold text-emerald-700">${resumen.sinDiferencia || 0}</div></div>
            <div class="bg-red-50 rounded-lg p-3"><div class="text-[9px] uppercase font-bold text-red-500">Unid. faltantes</div><div class="text-xl font-bold text-red-600">${resumen.unidadesFaltantes || 0}</div></div>
            <div class="bg-indigo-50 rounded-lg p-3"><div class="text-[9px] uppercase font-bold text-indigo-500">Unid. sobrantes</div><div class="text-xl font-bold text-indigo-700">${resumen.unidadesSobrantes || 0}</div></div>
            <div class="bg-slate-900 text-white rounded-lg p-3"><div class="text-[9px] uppercase font-bold text-slate-400">Balance</div><div class="text-xl font-bold">${formatearBalanceUnidades(resumen.balanceUnidades)}</div></div>
        </div>

        <div class="bg-slate-50 border rounded-xl p-3">
            <div class="text-[10px] uppercase font-bold text-gray-400 mb-2">Participantes</div>
            <div class="flex flex-wrap gap-1.5">${participantesHtml}</div>
        </div>

        <div>
            <h4 class="font-bold text-slate-900 text-sm mb-2"><i class="fa-solid fa-calendar-days text-amber-500 me-1"></i> Actividad por día</h4>
            <div class="overflow-x-auto border rounded-xl">
                <table class="w-full text-left min-w-[720px] text-xs">
                    <thead><tr class="bg-slate-50 text-gray-500 uppercase"><th class="p-3">Fecha</th><th class="p-3 text-center">Contados</th><th class="p-3 text-center">Validados</th><th class="p-3 text-center">Pendientes</th><th class="p-3 text-center">Diferencias</th><th class="p-3 text-center">Balance</th></tr></thead>
                    <tbody>${filasDias}</tbody>
                </table>
            </div>
        </div>

        <div>
            <h4 class="font-bold text-slate-900 text-sm mb-2"><i class="fa-solid fa-list-check text-amber-500 me-1"></i> Detalle de productos</h4>
            <div class="overflow-x-auto border rounded-xl max-h-[430px] overflow-y-auto">
                <table class="w-full text-left min-w-[1350px] text-xs">
                    <thead class="sticky top-0 bg-slate-50"><tr class="text-gray-500 uppercase"><th class="p-3">Fecha y hora</th><th class="p-3">Código</th><th class="p-3">Producto</th><th class="p-3">Departamento</th><th class="p-3">Zona</th><th class="p-3">Contado por</th><th class="p-3 text-center">Físico</th><th class="p-3 text-center">SICAR</th><th class="p-3 text-center">Diferencia</th><th class="p-3">Estado</th></tr></thead>
                    <tbody>${filasDetalle}</tbody>
                </table>
            </div>
        </div>`;
}

async function cargarDatosIniciales() {
    await Promise.all([
        cargarZonasDesdeBD({ silencioso: true }),
        cargarProductosDesdeBD(),
        cargarSesionInventarioActiva(),
        cargarCapturasDesdeBD({ silencioso: true })
    ]);
    sincronizarProductosContados();
    renderizarListaEmpleado();
    if (usuarioActualEsAdmin()) {
        renderizarMapeoAdmin();
        renderizarTabla();
    }
}

function cambiarRol(rol) {
    const usuario = obtenerUsuarioActual();
    if (!usuario) return;
    if (rol === 'admin' && usuario.rol !== 'ADMIN') {
        mostrarToast('No tienes permisos para abrir el Dashboard administrativo', 'error');
        rol = 'operativo';
    }

    const modOp = document.getElementById('modulo-operativo');
    const modAdmin = document.getElementById('modulo-admin');
    const btnOp = document.getElementById('btn-operativo');
    const btnAdmin = document.getElementById('btn-admin');

    modOp?.classList.toggle('hidden', rol !== 'operativo');
    modAdmin?.classList.toggle('hidden', rol !== 'admin');

    if (btnOp) btnOp.className = rol === 'operativo'
        ? 'px-4 py-1.5 rounded-md text-sm font-bold transition bg-amber-500 text-slate-900'
        : 'px-4 py-1.5 rounded-md text-sm font-medium transition text-gray-300 hover:text-white';

    if (btnAdmin) btnAdmin.className = rol === 'admin'
        ? 'px-4 py-1.5 rounded-md text-sm font-bold transition bg-amber-500 text-slate-900'
        : 'px-4 py-1.5 rounded-md text-sm font-medium transition text-gray-300 hover:text-white';

    if (rol === 'operativo') {
        renderizarListaEmpleado();
        iniciarCamaraEmp();
    } else {
        detenerCamaraEmp();
        cargarCapturasDesdeBD({ silencioso: true });
        renderizarTabla();
    }
}

function cambiarSubTabEmp(tab) {
    const pEscaner = document.getElementById('pantalla-escaner');
    const pLista = document.getElementById('pantalla-lista');
    const subEscaner = document.getElementById('subtab-escaner');
    const subLista = document.getElementById('subtab-lista');

    pEscaner?.classList.toggle('hidden', tab !== 'escaner');
    pLista?.classList.toggle('hidden', tab !== 'lista');

    if (subEscaner) subEscaner.className = tab === 'escaner'
        ? 'w-1/2 py-3 border-b-2 border-amber-500 text-amber-600 bg-white'
        : 'w-1/2 py-3 border-b-2 border-transparent text-gray-500';

    if (subLista) subLista.className = tab === 'lista'
        ? 'w-1/2 py-3 border-b-2 border-amber-500 text-amber-600 bg-white'
        : 'w-1/2 py-3 border-b-2 border-transparent text-gray-500';

    if (tab === 'escaner') {
        iniciarCamaraEmp();
    } else {
        detenerCamaraEmp();
        renderizarListaEmpleado();
    }
}

function cambiarTabAdmin(tab) {
    const tabs = {
        'en-vivo': document.getElementById('tab-vivo'),
        'historial': document.getElementById('tab-historial'),
        'mapeo': document.getElementById('tab-mapeo'),
        'usuarios': document.getElementById('tab-usuarios')
    };
    const botones = {
        'en-vivo': document.getElementById('tab-btn-vivo'),
        'historial': document.getElementById('tab-btn-historial'),
        'mapeo': document.getElementById('tab-btn-mapeo'),
        'usuarios': document.getElementById('tab-btn-usuarios')
    };

    if (!Object.prototype.hasOwnProperty.call(tabs, tab)) tab = 'en-vivo';

    Object.entries(tabs).forEach(([nombre, elemento]) => {
        elemento?.classList.toggle('hidden', nombre !== tab);
    });

    Object.entries(botones).forEach(([nombre, boton]) => {
        if (!boton) return;
        boton.className = nombre === tab
            ? 'px-4 py-2 border-b-2 border-amber-500 font-bold text-amber-600 text-sm'
            : 'px-4 py-2 border-b-2 border-transparent font-medium text-gray-500 hover:text-gray-700 text-sm';
    });

    if (tab === 'mapeo') {
        renderizarMapeoAdmin();
        iniciarCamaraAdmin();
        return;
    }

    detenerCamaraAdmin();
    if (tab === 'usuarios') {
        cargarUsuariosAdmin({ silencioso: usuariosAdmin.length > 0 });
    } else if (tab === 'historial') {
        cargarHistorialInventarios({ silencioso: historialInventariosAdmin.length > 0 });
    } else {
        cargarCapturasDesdeBD({ silencioso: true });
    }
}

async function cargarUsuariosAdmin({ silencioso = false } = {}) {
    if (!usuarioActualEsAdmin() || cargandoUsuariosAdmin) return;

    cargandoUsuariosAdmin = true;
    const tbody = document.getElementById('tabla-usuarios-admin');
    if (!silencioso && tbody && usuariosAdmin.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-xs text-gray-400"><i class="fa-solid fa-spinner fa-spin me-1"></i> Cargando usuarios...</td></tr>';
    }

    try {
        const respuesta = await apiObtenerUsuarios();
        usuariosAdmin = Array.isArray(respuesta?.data) ? respuesta.data : [];
        renderizarUsuariosAdmin();
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-xs text-red-600">${escaparHtml(error.message || 'No se pudieron cargar los usuarios')}</td></tr>`;
        }
        if (!silencioso) mostrarToast(`No se pudieron cargar los usuarios: ${error.message}`, 'error');
    } finally {
        cargandoUsuariosAdmin = false;
    }
}

function actualizarResumenUsuariosAdmin() {
    const activos = usuariosAdmin.filter(u => u.activo).length;
    const empleados = usuariosAdmin.filter(u => u.activo && u.rol === 'EMPLEADO').length;
    const admins = usuariosAdmin.filter(u => u.activo && u.rol === 'ADMIN').length;
    const inactivos = usuariosAdmin.filter(u => !u.activo).length;

    const valores = {
        'usuarios-total-activos': activos,
        'usuarios-total-empleados': empleados,
        'usuarios-total-admins': admins,
        'usuarios-total-inactivos': inactivos
    };
    Object.entries(valores).forEach(([id, valor]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(valor);
    });
}

function usuariosAdminFiltrados() {
    const busqueda = String(document.getElementById('usuarios-busqueda')?.value || '').trim().toLowerCase();
    const rol = document.getElementById('usuarios-filtro-rol')?.value || 'TODOS';
    const estado = document.getElementById('usuarios-filtro-estado')?.value || 'TODOS';

    return usuariosAdmin.filter(usuario => {
        const coincideTexto = !busqueda || [usuario.nombre, usuario.username, usuario.email]
            .filter(Boolean)
            .some(valor => String(valor).toLowerCase().includes(busqueda));
        const coincideRol = rol === 'TODOS' || usuario.rol === rol;
        const coincideEstado = estado === 'TODOS'
            || (estado === 'ACTIVO' && usuario.activo)
            || (estado === 'INACTIVO' && !usuario.activo);
        return coincideTexto && coincideRol && coincideEstado;
    });
}

function renderizarUsuariosAdmin() {
    actualizarResumenUsuariosAdmin();
    const tbody = document.getElementById('tabla-usuarios-admin');
    if (!tbody) return;

    const actual = obtenerUsuarioActual();
    const filtrados = usuariosAdminFiltrados();

    if (!filtrados.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-xs text-gray-400">No hay usuarios que coincidan con los filtros.</td></tr>';
        return;
    }

    tbody.innerHTML = filtrados.map(usuario => {
        const esActual = usuario.id === actual?.id;
        const cuentaHistorica = !usuario.username;
        const idSeguro = String(usuario.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const rolAdmin = usuario.rol === 'ADMIN';
        const ultimoAcceso = usuario.lastLoginAt ? formatearFecha(usuario.lastLoginAt) : 'Nunca';
        const correo = usuario.email ? `<div class="text-[10px] text-gray-400 mt-0.5">${escaparHtml(usuario.email)}</div>` : '';
        const distintivoActual = esActual ? '<span class="ml-1 text-[9px] bg-slate-900 text-white px-1.5 py-0.5 rounded">Tú</span>' : '';
        const usuarioVisible = usuario.username
            ? `<span class="font-mono font-bold text-slate-800">${escaparHtml(usuario.username)}</span>${distintivoActual}${correo}`
            : '<span class="text-xs text-gray-400 italic">Registro histórico sin usuario</span>';
        const seguridad = cuentaHistorica
            ? '<span class="text-[10px] font-bold text-gray-400">Sin acceso</span>'
            : usuario.debeCambiarPassword
                ? '<span class="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full"><i class="fa-solid fa-key"></i> Cambio pendiente</span>'
                : '<span class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full"><i class="fa-solid fa-shield-halved"></i> Configurada</span>';
        const estado = usuario.activo
            ? '<span class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full"><i class="fa-solid fa-circle text-[6px]"></i> Activo</span>'
            : '<span class="inline-flex items-center gap-1 text-[10px] font-bold text-gray-600 bg-gray-100 border px-2 py-1 rounded-full"><i class="fa-solid fa-ban"></i> Desactivado</span>';
        const rolHtml = rolAdmin
            ? '<span class="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-full">ADMIN</span>'
            : '<span class="text-[10px] font-bold text-slate-700 bg-slate-100 border px-2 py-1 rounded-full">EMPLEADO</span>';

        let acciones = '';
        if (cuentaHistorica) {
            acciones = '<span class="text-[10px] text-gray-400">Solo trazabilidad</span>';
        } else if (esActual) {
            acciones = '<span class="text-[10px] text-gray-400"><i class="fa-solid fa-lock me-1"></i> Cuenta actual</span>';
        } else {
            const estadoBoton = usuario.activo
                ? `<button type="button" onclick="cambiarEstadoUsuarioAdmin('${idSeguro}', true)" class="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100" title="Desactivar cuenta"><i class="fa-solid fa-user-slash me-1"></i> Desactivar</button>`
                : `<button type="button" onclick="cambiarEstadoUsuarioAdmin('${idSeguro}', false)" class="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100" title="Activar cuenta"><i class="fa-solid fa-user-check me-1"></i> Activar</button>`;
            acciones = `${estadoBoton}<button type="button" onclick="restablecerPasswordUsuarioAdmin('${idSeguro}')" class="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700 border hover:bg-slate-200" title="Generar nueva contraseña temporal"><i class="fa-solid fa-key me-1"></i> Restablecer</button>`;
        }

        return `<tr class="hover:bg-slate-50/70">
            <td class="p-3">
                <div class="font-semibold text-slate-900">${escaparHtml(usuario.nombre || 'Sin nombre')}</div>
                <div class="text-[10px] text-gray-400">Creado: ${usuario.createdAt ? escaparHtml(formatearFecha(usuario.createdAt)) : '--'}</div>
            </td>
            <td class="p-3">${usuarioVisible}</td>
            <td class="p-3">${rolHtml}</td>
            <td class="p-3">${estado}</td>
            <td class="p-3">${seguridad}</td>
            <td class="p-3 text-xs text-gray-600">${escaparHtml(ultimoAcceso)}</td>
            <td class="p-3"><div class="flex justify-center gap-2 flex-wrap">${acciones}</div></td>
        </tr>`;
    }).join('');
}

function abrirModalNuevoUsuario() {
    if (!usuarioActualEsAdmin()) return;
    const form = document.getElementById('form-nuevo-usuario');
    form?.reset();
    const errorBox = document.getElementById('nuevo-usuario-error');
    errorBox?.classList.add('hidden');
    document.getElementById('modal-nuevo-usuario')?.classList.remove('hidden');
    setTimeout(() => document.getElementById('nuevo-usuario-nombre')?.focus(), 50);
}

function cerrarModalNuevoUsuario() {
    document.getElementById('modal-nuevo-usuario')?.classList.add('hidden');
    document.getElementById('nuevo-usuario-error')?.classList.add('hidden');
}

async function guardarNuevoUsuario(event) {
    event.preventDefault();
    if (!usuarioActualEsAdmin()) return;

    const nombre = String(document.getElementById('nuevo-usuario-nombre')?.value || '').trim();
    const username = String(document.getElementById('nuevo-usuario-username')?.value || '').trim().toLowerCase();
    const email = String(document.getElementById('nuevo-usuario-email')?.value || '').trim().toLowerCase();
    const rol = String(document.getElementById('nuevo-usuario-rol')?.value || 'EMPLEADO').toUpperCase();
    const errorBox = document.getElementById('nuevo-usuario-error');
    const btn = document.getElementById('btn-crear-usuario');

    const mostrarError = texto => {
        if (!errorBox) return;
        errorBox.textContent = texto;
        errorBox.classList.remove('hidden');
    };

    if (nombre.length < 2 || nombre.length > 100) return mostrarError('Ingresa un nombre válido.');
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
        return mostrarError('El usuario debe tener 3 a 40 caracteres y usar solo letras, números, punto, guion o guion bajo.');
    }
    if (!['ADMIN', 'EMPLEADO'].includes(rol)) return mostrarError('Selecciona un rol válido.');

    if (rol === 'ADMIN') {
        const confirmado = window.confirm('Esta cuenta tendrá acceso completo al Dashboard y a la administración de usuarios. ¿Deseas crearla como Administrador?');
        if (!confirmado) return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Creando...';
    }
    errorBox?.classList.add('hidden');

    try {
        const respuesta = await apiCrearUsuario({ nombre, username, email: email || null, rol });
        cerrarModalNuevoUsuario();
        await cargarUsuariosAdmin({ silencioso: true });
        mostrarCredencialTemporal({
            titulo: 'Usuario creado correctamente',
            username: respuesta?.data?.username || username,
            password: respuesta?.temporaryPassword || ''
        });
        mostrarToast('Usuario creado correctamente');
    } catch (error) {
        mostrarError(error.message || 'No fue posible crear el usuario.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-user-plus me-1"></i> Crear cuenta';
        }
    }
}

async function cambiarEstadoUsuarioAdmin(id, activoActual) {
    if (!usuarioActualEsAdmin()) return;
    const usuario = usuariosAdmin.find(u => u.id === id);
    if (!usuario) return mostrarToast('Usuario no encontrado', 'error');
    if (usuario.id === obtenerUsuarioActual()?.id) return mostrarToast('No puedes desactivar tu propia cuenta', 'error');

    const nuevoEstado = !activoActual;
    const accion = nuevoEstado ? 'activar' : 'desactivar';
    const advertencia = nuevoEstado
        ? `¿Deseas activar nuevamente la cuenta de ${usuario.nombre}?`
        : `¿Deseas desactivar la cuenta de ${usuario.nombre}?\n\nSus sesiones abiertas se cerrarán inmediatamente.`;
    if (!window.confirm(advertencia)) return;

    try {
        await apiCambiarEstadoUsuario(id, nuevoEstado);
        await cargarUsuariosAdmin({ silencioso: true });
        mostrarToast(`Usuario ${nuevoEstado ? 'activado' : 'desactivado'} correctamente`);
    } catch (error) {
        mostrarToast(error.message || `No fue posible ${accion} el usuario`, 'error');
    }
}

async function restablecerPasswordUsuarioAdmin(id) {
    if (!usuarioActualEsAdmin()) return;
    const usuario = usuariosAdmin.find(u => u.id === id);
    if (!usuario) return mostrarToast('Usuario no encontrado', 'error');
    if (!usuario.username) return mostrarToast('Este registro histórico no tiene una cuenta de acceso', 'error');
    if (usuario.id === obtenerUsuarioActual()?.id) {
        return mostrarToast('Para evitar cerrar tu propia sesión, no restablezcas aquí la cuenta con la que estás conectado', 'error');
    }

    const confirmado = window.confirm(
        `Se generará una nueva contraseña temporal para ${usuario.nombre}.\n\n` +
        'Todas sus sesiones actuales se cerrarán y deberá cambiar la contraseña al volver a entrar.\n\n¿Deseas continuar?'
    );
    if (!confirmado) return;

    try {
        const respuesta = await apiResetPasswordUsuario(id);
        await cargarUsuariosAdmin({ silencioso: true });
        mostrarCredencialTemporal({
            titulo: 'Contraseña restablecida',
            username: usuario.username,
            password: respuesta?.temporaryPassword || ''
        });
    } catch (error) {
        mostrarToast(error.message || 'No fue posible restablecer la contraseña', 'error');
    }
}

function mostrarCredencialTemporal({ titulo, username, password }) {
    passwordTemporalActual = String(password || '');
    const tituloEl = document.getElementById('credencial-temporal-titulo');
    const usuarioEl = document.getElementById('credencial-temporal-usuario');
    const passwordEl = document.getElementById('credencial-temporal-password');
    if (tituloEl) tituloEl.textContent = titulo || 'Credencial temporal generada';
    if (usuarioEl) usuarioEl.textContent = username || '--';
    if (passwordEl) passwordEl.value = passwordTemporalActual;
    document.getElementById('modal-credencial-temporal')?.classList.remove('hidden');
}

function cerrarModalCredencialTemporal() {
    passwordTemporalActual = '';
    const passwordEl = document.getElementById('credencial-temporal-password');
    if (passwordEl) passwordEl.value = '';
    document.getElementById('modal-credencial-temporal')?.classList.add('hidden');
}

async function copiarPasswordTemporal() {
    if (!passwordTemporalActual) return mostrarToast('No hay una contraseña temporal para copiar', 'error');
    try {
        await navigator.clipboard.writeText(passwordTemporalActual);
        mostrarToast('Contraseña temporal copiada');
    } catch (_) {
        const input = document.getElementById('credencial-temporal-password');
        if (!input) return;
        input.focus();
        input.select();
        try {
            document.execCommand('copy');
            mostrarToast('Contraseña temporal copiada');
        } catch (_) {
            mostrarToast('No fue posible copiar automáticamente. Selecciona la contraseña manualmente.', 'error');
        }
    }
}

async function buscarProducto(codigoEscaneado) {
    const codigo = String(codigoEscaneado || '').trim();
    if (!codigo) return null;

    const local = productosDia.find(p => p.codigo === codigo);
    if (local) return local;

    try {
        const producto = await apiBuscarProducto(codigo);
        const normalizado = normalizarProducto(producto);
        productosDia.push(normalizado);
        return normalizado;
    } catch (error) {
        if (!/no encontrado/i.test(error.message)) console.error(error);
        return null;
    }
}

function limpiarPreviewProductoEmpleado() {
    const inputProd = document.getElementById('producto-input');
    const inputPrecio = document.getElementById('precio-input');
    if (inputProd) inputProd.value = '--';
    if (inputPrecio) inputPrecio.value = '$0.00';
}

function procesarCodigoEmpleadoEnTiempoReal(valor) {
    const codigo = String(valor || '').trim();
    const inputProd = document.getElementById('producto-input');
    const inputPrecio = document.getElementById('precio-input');

    codigoEmpleadoPreview = codigo;

    if (!codigo) {
        limpiarPreviewProductoEmpleado();
        return;
    }

    // Todos los productos ya se cargan al abrir la app, así que esta búsqueda es local
    // y no genera una petición a Render por cada tecla.
    const exacto = productosDia.find(p => p.codigo === codigo);
    if (exacto) {
        if (inputProd) inputProd.value = exacto.nombre;
        if (inputPrecio) inputPrecio.value = `$${exacto.precio.toFixed(2)}`;
        return;
    }

    const coincidencias = productosDia
        .filter(p => p.codigo.startsWith(codigo))
        .slice(0, 6);

    if (coincidencias.length === 1) {
        const unico = coincidencias[0];
        if (inputProd) inputProd.value = unico.nombre;
        if (inputPrecio) inputPrecio.value = `$${unico.precio.toFixed(2)}`;
    } else if (coincidencias.length > 1) {
        if (inputProd) inputProd.value = `${coincidencias.length}${coincidencias.length === 6 ? '+' : ''} coincidencias por código`;
        if (inputPrecio) inputPrecio.value = '$0.00';
    } else {
        if (inputProd) inputProd.value = 'Sin coincidencias';
        if (inputPrecio) inputPrecio.value = '$0.00';
    }
}

function renderizarSelectorUbicacionEmpleado() {
    const select = document.getElementById('select-zona-conteo');
    if (!select) return;
    const anterior = select.value;
    select.innerHTML = zonas.length
        ? zonas.map(z => `<option value="${escaparHtml(z.id)}">${escaparHtml(z.nombre)}</option>`).join('')
        : '<option value="">No hay ubicaciones configuradas</option>';
    if (zonas.some(z => z.id === anterior)) select.value = anterior;
    actualizarPanelCoordinacionProducto();
    renderizarTareasCoordinadas();
}

function ubicacionConteoActual() {
    const id = document.getElementById('select-zona-conteo')?.value || '';
    return zonas.find(z => z.id === id) || null;
}

function cambiarUbicacionConteo() {
    const codigoFormulario = String(document.getElementById('codigo-input')?.value || '').trim();
    const codigo = codigoFormulario || codigoProductoMultiubicacionActivo;
    const producto = productosDia.find(p => p.codigo === codigo) || null;
    actualizarPanelCoordinacionProducto(producto);
    renderizarTareasCoordinadas();
}

function obtenerTareasCoordinadasGlobales() {
    const tareas = [];

    for (const producto of productosDia) {
        const habituales = Array.isArray(producto.ubicaciones) ? producto.ubicaciones : [];
        if (habituales.length <= 1) continue;

        const lineas = capturas.filter(c => c.codigo === producto.codigo);
        if (!lineas.length) continue;

        const zonasContadas = new Set();
        const fechas = [];
        for (const c of lineas) {
            if (Array.isArray(c.desgloseUbicaciones) && c.desgloseUbicaciones.length) {
                c.desgloseUbicaciones.forEach(d => {
                    if (d.zonaId) zonasContadas.add(d.zonaId);
                    const ms = new Date(d.createdAt || 0).getTime();
                    if (Number.isFinite(ms)) fechas.push(ms);
                });
            } else {
                if (c.zonaId) zonasContadas.add(c.zonaId);
                const ms = new Date(c.fechahora || 0).getTime();
                if (Number.isFinite(ms)) fechas.push(ms);
            }
        }

        // La coordinación solo comienza cuando al menos una ubicación habitual ya fue contada.
        if (!habituales.some(z => zonasContadas.has(z.id))) continue;
        const pendientes = habituales.filter(z => !zonasContadas.has(z.id));
        if (!pendientes.length) continue;

        const inicioMs = fechas.length ? Math.min(...fechas) : Date.now();
        tareas.push({
            producto,
            pendientes,
            minutos: Math.max(0, Math.round((Date.now() - inicioMs) / 60000))
        });
    }

    return tareas.sort((a, b) => b.minutos - a.minutos || a.producto.nombre.localeCompare(b.producto.nombre));
}

function renderizarTareasCoordinadas() {
    // Fase 10.2: la coordinación se muestra únicamente sobre el producto que la
    // empleada está contando. No enviamos a la persona a perseguir tareas globales
    // por toda la tienda; el selector de ubicación sigue bajo su control.
    const panel = document.getElementById('tareas-coordinadas');
    if (!panel) return;
    panel.classList.add('hidden');
    panel.innerHTML = '';
}

function actualizarPanelCoordinacionProducto(producto = null) {
    const panel = document.getElementById('coordinacion-producto');
    if (!panel) return;
    if (!producto) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }

    const actual = ubicacionConteoActual();
    const habituales = producto.ubicaciones || [];
    const esHabitual = Boolean(actual && habituales.some(z => z.id === actual.id));
    const contadas = habituales.filter(z => productoContadoEnZona(producto, z.id));
    const pendientes = habituales.filter(z => !productoContadoEnZona(producto, z.id));
    const esMultiubicacion = habituales.length > 1;

    const chips = habituales.length
        ? habituales.map(z => {
            const contado = productoContadoEnZona(producto, z.id);
            const esActual = actual?.id === z.id;
            const clase = contado
                ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                : esActual
                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                    : 'bg-white text-slate-700 border-slate-300';
            const icono = contado ? 'fa-circle-check' : esActual ? 'fa-location-dot' : 'fa-clock';
            return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold ${clase}"><i class="fa-solid ${icono}"></i>${escaparHtml(z.nombre)}${contado ? ' · contado' : esActual ? ' · aquí' : ' · pendiente'}</span>`;
        }).join(' ')
        : '<span class="text-[10px] text-gray-500">Este producto todavía no tiene ubicaciones habituales mapeadas.</span>';

    const avisoNoHabitual = actual && !esHabitual
        ? `<div class="mt-2 text-[10px] text-amber-900 bg-amber-100 border border-amber-300 rounded p-2"><i class="fa-solid fa-triangle-exclamation me-1"></i>${escaparHtml(actual.nombre)} no está registrada como ubicación habitual de este producto. El conteo se aceptará y el administrador podrá decidir si agrega el mapeo.</div>`
        : '';

    if (esMultiubicacion) {
        const completo = pendientes.length === 0;
        const faltantes = pendientes.map(z => z.nombre).join(', ');
        panel.className = `${completo ? 'bg-emerald-50 border-emerald-300' : 'bg-amber-50 border-amber-400'} border-2 rounded-lg p-3`;
        panel.innerHTML = `
            <div class="flex items-start gap-2">
                <i class="fa-solid ${completo ? 'fa-circle-check text-emerald-600' : 'fa-triangle-exclamation text-amber-600'} mt-0.5"></i>
                <div class="min-w-0 flex-1">
                    <div class="text-xs font-extrabold ${completo ? 'text-emerald-800' : 'text-amber-900'} uppercase tracking-wide">
                        ${completo ? 'Conteo multiubicación completo' : 'Importante: producto en varias ubicaciones'}
                    </div>
                    <div class="text-[11px] ${completo ? 'text-emerald-700' : 'text-amber-900'} mt-1 leading-relaxed">
                        ${completo
                            ? `Ya se contaron las ${habituales.length} ubicaciones habituales de este producto.`
                            : `Este producto tiene existencias habituales en ${habituales.length} ubicaciones. Para reducir el riesgo de que una venta cambie SICAR durante el conteo, termina las demás ubicaciones lo antes posible antes de continuar con otro producto.`}
                    </div>
                    <div class="mt-2 flex flex-wrap gap-1">${chips}</div>
                    <div class="mt-2 text-[10px] font-bold ${completo ? 'text-emerald-700' : 'text-amber-800'}">
                        ${contadas.length} de ${habituales.length} ubicaciones contadas${!completo ? ` · Faltan: ${escaparHtml(faltantes)}` : ''}
                    </div>
                </div>
            </div>
            ${avisoNoHabitual}`;
    } else {
        panel.className = 'bg-slate-50 border border-slate-200 rounded-lg p-2';
        panel.innerHTML = `<div class="text-[10px] uppercase font-bold text-gray-400 mb-1">Ubicación del producto</div><div class="flex flex-wrap gap-1">${chips}</div>${avisoNoHabitual}`;
    }

    panel.classList.remove('hidden');
}

async function procesarEscaneoEmpleado(codigo) {
    const codigoLimpio = String(codigo || '').trim();
    const inputCodigo = document.getElementById('codigo-input');
    const inputProd = document.getElementById('producto-input');
    const inputPrecio = document.getElementById('precio-input');
    const inputCant = document.getElementById('cantidad-input');

    if (inputCodigo) inputCodigo.value = codigoLimpio;
    codigoEmpleadoPreview = codigoLimpio;
    if (inputProd) inputProd.value = 'Buscando...';
    if (inputPrecio) inputPrecio.value = '$0.00';

    const producto = await buscarProducto(codigoLimpio);
    if (!producto) {
        if (inputProd) inputProd.value = 'Producto no registrado';
        actualizarPanelCoordinacionProducto(null);
        mostrarToast('Producto no encontrado en la base de datos', 'error');
        return null;
    }

    if (inputProd) inputProd.value = producto.nombre;
    if (inputPrecio) inputPrecio.value = `$${producto.precio.toFixed(2)}`;

    const pendientesMulti = (producto.ubicaciones || []).filter(z => !productoContadoEnZona(producto, z.id));
    if ((producto.ubicaciones || []).length > 1 && pendientesMulti.length) {
        codigoProductoMultiubicacionActivo = producto.codigo;
    }

    actualizarPanelCoordinacionProducto(producto);
    if (inputCant) inputCant.focus();
    if ((producto.ubicaciones || []).length > 1) {
        mostrarToast(`Producto multiubicación: revisa las ${(producto.ubicaciones || []).length} ubicaciones indicadas antes de continuar.`, 'warning', 6000);
    } else {
        mostrarToast(`Producto encontrado: ${producto.nombre}`);
    }
    return producto;
}

async function simularEscaneo(codigo) {
    await procesarEscaneoEmpleado(codigo);
}

async function registrarConteo(event) {
    event.preventDefault();
    if (!sesionInventarioActiva?.id) {
        mostrarToast('No hay un inventario activo. Solicita a un administrador que inicie uno.', 'error');
        return;
    }

    const codigoInput = document.getElementById('codigo-input');
    const cantidadInput = document.getElementById('cantidad-input');
    const productoInput = document.getElementById('producto-input');
    const precioInput = document.getElementById('precio-input');
    const zona = ubicacionConteoActual();
    const codigo = String(codigoInput?.value || '').trim();
    const cantidad = Number(cantidadInput?.value);

    if (!zona) {
        mostrarToast('Selecciona primero la ubicación física que estás contando', 'error');
        document.getElementById('select-zona-conteo')?.focus();
        return;
    }
    if (!codigo || !Number.isInteger(cantidad) || cantidad < 0) {
        mostrarToast('Ingresa un código y una cantidad válida', 'error');
        return;
    }

    const producto = await buscarProducto(codigo);
    if (!producto) return mostrarToast('No se puede registrar: producto no encontrado', 'error');
    if (productoContadoEnZona(producto, zona.id)) {
        mostrarToast(`Este producto ya fue contado en ${zona.nombre}`, 'error');
        return;
    }

    try {
        const respuesta = await apiRegistrarCaptura({ codigo, cantidad, zonaId: zona.id });
        capturas.unshift(normalizarCaptura(respuesta.data));
        sincronizarProductosContados();

        if (codigoInput) codigoInput.value = '';
        if (cantidadInput) cantidadInput.value = '';
        if (productoInput) productoInput.value = '--';
        if (precioInput) precioInput.value = '$0.00';
        codigoEmpleadoPreview = '';

        renderizarListaEmpleado();
        renderizarTareasCoordinadas();
        renderizarTabla();

        const pendientesCoordinados = (producto.ubicaciones || []).filter(z => !productoContadoEnZona(producto, z.id));
        const esMultiubicacion = (producto.ubicaciones || []).length > 1;
        if (esMultiubicacion && pendientesCoordinados.length) {
            codigoProductoMultiubicacionActivo = producto.codigo;
            actualizarPanelCoordinacionProducto(producto);
            mostrarToast(
                `Guardado en ${zona.nombre}. MULTIUBICACIÓN: faltan ${pendientesCoordinados.length}: ${pendientesCoordinados.map(z => z.nombre).join(', ')}. Cuéntalas lo antes posible.`,
                'warning',
                7000
            );
        } else if (esMultiubicacion) {
            codigoProductoMultiubicacionActivo = '';
            actualizarPanelCoordinacionProducto(producto);
            mostrarToast(`Conteo multiubicación completo: ${producto.ubicaciones.length} de ${producto.ubicaciones.length} ubicaciones contadas. Ya puede compararse con SICAR.`, 'success', 5000);
        } else {
            if (codigoProductoMultiubicacionActivo === producto.codigo) codigoProductoMultiubicacionActivo = '';
            actualizarPanelCoordinacionProducto(null);
            mostrarToast(respuesta.ubicacionHabitual === false
                ? `Conteo registrado en ${zona.nombre}. Ubicación no habitual detectada.`
                : `Conteo registrado en ${zona.nombre}: ${cantidad} unidades`);
        }
        codigoInput?.focus();
    } catch (error) {
        console.error(error);
        if (error?.code === 'PRODUCT_LOCATION_ALREADY_COUNTED') {
            await cargarCapturasDesdeBD({ silencioso: true });
            mostrarToast(`Otro usuario ya contó este producto en ${zona.nombre}`, 'error');
            return;
        }
        mostrarToast(`No se pudo registrar el conteo: ${error.message}`, 'error');
    }
}

function renderizarListaEmpleado() {
    const cont = document.getElementById('contenedor-lista-diaria');
    if (!cont) return;
    if (!productosDia.length) {
        cont.innerHTML = '<div class="text-center text-xs text-gray-400 py-6">No hay productos disponibles.</div>';
        return;
    }

    const orden = document.getElementById('select-orden-emp')?.value || 'barrida';
    const grupos = new Map();

    if (orden === 'barrida') {
        zonas.forEach(zona => {
            const items = productosDia
                .filter(p => (p.ubicaciones || []).some(u => u.id === zona.id))
                .map(p => ({ producto: p, zonaId: zona.id }));
            if (items.length) grupos.set(zona.nombre, items);
        });
        const sinZona = productosDia.filter(p => !(p.ubicaciones || []).length).map(p => ({ producto: p, zonaId: null }));
        if (sinZona.length) grupos.set('Sin zona asignada', sinZona);
    } else {
        productosDia.forEach(producto => {
            const nombre = producto.depto || 'General';
            if (!grupos.has(nombre)) grupos.set(nombre, []);
            grupos.get(nombre).push({ producto, zonaId: null });
        });
    }

    const nombres = [...grupos.keys()].sort((a, b) => {
        if (a === 'Sin zona asignada') return 1;
        if (b === 'Sin zona asignada') return -1;
        const completoA = grupos.get(a).length > 0 && grupos.get(a).every(item => item.zonaId ? productoContadoEnZona(item.producto, item.zonaId) : item.producto.contado);
        const completoB = grupos.get(b).length > 0 && grupos.get(b).every(item => item.zonaId ? productoContadoEnZona(item.producto, item.zonaId) : item.producto.contado);
        if (orden === 'barrida' && completoA !== completoB) return completoA ? 1 : -1;
        return a.localeCompare(b, 'es');
    });

    cont.innerHTML = nombres.map(nombre => {
        const items = grupos.get(nombre).slice().sort((a, b) => {
            const ca = a.zonaId ? productoContadoEnZona(a.producto, a.zonaId) : a.producto.contado;
            const cb = b.zonaId ? productoContadoEnZona(b.producto, b.zonaId) : b.producto.contado;
            if (ca !== cb) return ca ? 1 : -1;
            return a.producto.nombre.localeCompare(b.producto.nombre, 'es');
        });
        const completa = items.length > 0 && items.every(item => item.zonaId ? productoContadoEnZona(item.producto, item.zonaId) : item.producto.contado);
        const filas = items.map(({ producto: prod, zonaId }) => {
            const contado = zonaId ? productoContadoEnZona(prod, zonaId) : prod.contado;
            const avance = !zonaId && prod.ubicaciones.length > 1
                ? `<div class="text-[9px] text-gray-400">${prod.conteosPorZona?.size || 0}/${prod.ubicaciones.length} ubicaciones</div>` : '';
            return `<div class="p-2.5 rounded-lg border text-xs flex justify-between items-center ${contado ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-white border-gray-200'}">
                <div class="min-w-0 pr-2"><div class="font-bold truncate">${escaparHtml(prod.nombre)}</div><div class="text-[10px] text-gray-400 font-mono">${escaparHtml(prod.codigo)}</div>${avance}</div>
                ${contado ? '<span class="text-emerald-600 font-bold text-[10px] whitespace-nowrap"><i class="fa-solid fa-circle-check"></i> Contado</span>' : '<span class="text-gray-400 text-[10px] whitespace-nowrap">Pendiente</span>'}
            </div>`;
        }).join('');
        const icono = orden === 'departamento' ? 'fa-folder' : 'fa-location-dot';
        return `<section><h4 class="font-bold text-xs uppercase bg-slate-100 text-slate-700 px-2 py-1 rounded mb-2"><i class="fa-solid ${icono} me-1"></i>${escaparHtml(nombre)} <span class="text-[10px] text-gray-400">(${items.length})</span>${orden === 'barrida' && completa && nombre !== 'Sin zona asignada' ? '<span class="ms-2 text-[9px] text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">COMPLETA</span>' : ''}</h4><div class="space-y-1.5 pl-1 mb-3">${filas}</div></section>`;
    }).join('');
}

function formatearFecha(fecha) {
    if (!fecha) return '--';
    const d = new Date(fecha);
    if (Number.isNaN(d.getTime())) return escaparHtml(String(fecha));
    return d.toLocaleString('es-MX', {
        timeZone: 'America/Monterrey',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatearDiferencia(valor) {
    if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return '--';
    const numero = Number(valor);
    return numero > 0 ? `+${numero}` : String(numero);
}

function actualizarDiferenciaVista(id) {
    const captura = capturas.find(c => c.id === id);
    const input = document.getElementById(`sicar-${id}`);
    const celda = document.getElementById(`diferencia-${id}`);
    if (!captura || !input || !celda) return;

    const valor = String(input.value ?? '').trim();
    borradoresSicar.set(id, valor);
    if (valor === '') {
        celda.textContent = '--';
        celda.className = 'p-3 font-bold text-gray-400';
        return;
    }

    const stockSicar = Number(valor);
    if (!Number.isInteger(stockSicar)) {
        celda.textContent = '--';
        celda.className = 'p-3 font-bold text-gray-400';
        return;
    }

    const diferencia = captura.fisico - stockSicar;
    celda.textContent = formatearDiferencia(diferencia);
    celda.className = `p-3 font-bold ${diferencia === 0 ? 'text-emerald-600' : 'text-red-600'}`;
}

function htmlFilaCaptura(c) {
    const tieneBorrador = borradoresSicar.has(c.id);
    const valorSicarVista = tieneBorrador ? borradoresSicar.get(c.id) : (c.sicar ?? '');
    const numeroBorrador = String(valorSicarVista).trim() === '' ? null : Number(valorSicarVista);
    const diff = numeroBorrador !== null && Number.isInteger(numeroBorrador) ? c.fisico - numeroBorrador : c.diferencia;
    const diffClase = diff === null ? 'text-gray-400' : diff === 0 ? 'text-emerald-600' : 'text-red-600';
    const estadoCompleto = c.estado === 'completado';
    const participantes = c.participantesConteo || [];
    const usuarioNombre = participantes.length > 1 ? `${participantes.length} participantes` : (c.usuarioNombre || c.usuarioUsername || 'Sin identificar');
    const desglose = (c.desgloseUbicaciones || []).map(d =>
        `<div class="text-[10px] text-slate-500 flex items-center gap-1 whitespace-nowrap"><span><i class="fa-solid fa-location-dot text-amber-500 me-1"></i>${escaparHtml(d.zonaNombre)}: <b>${Number(d.cantidadFisica || 0)}</b>${d.usuario?.nombre ? ` · ${escaparHtml(d.usuario.nombre)}` : ''}</span><button type="button" onclick="eliminarConteoUbicacion('${d.id}')" class="text-red-400 hover:text-red-600" title="Quitar este conteo para volver a realizarlo"><i class="fa-solid fa-rotate-left"></i></button></div>`
    ).join('');
    const pendientes = c.conteoCoordinado?.pendientes || [];
    const noHabituales = c.conteoCoordinado?.noHabituales || [];
    const coordinacion = pendientes.length
        ? `<div class="mt-1 text-[10px] text-amber-700 font-semibold" title="${escaparHtml(pendientes.map(z => z.nombre).join(', '))}"><i class="fa-solid fa-clock me-1"></i>Faltan ${pendientes.length} ubicación(es)</div>`
        : c.conteoCoordinado?.requerido ? '<div class="mt-1 text-[10px] text-emerald-700 font-semibold"><i class="fa-solid fa-circle-check me-1"></i>Ubicaciones habituales completas</div>' : '';
    const avisoDesfase = c.conteoCoordinado?.desfasado
        ? `<div class="mt-1 text-[10px] text-red-600 font-semibold"><i class="fa-solid fa-clock-rotate-left me-1"></i>Conteos separados ${c.conteoCoordinado.minutosEntreConteos} min</div>` : '';
    const avisoNoHabitual = noHabituales.length
        ? `<div class="mt-1 text-[10px] text-indigo-600 font-semibold"><i class="fa-solid fa-location-crosshairs me-1"></i>Ubicación no habitual: ${noHabituales.map(z => `<button type="button" onclick="confirmarUbicacionHabitual('${escaparHtml(c.codigo)}','${escaparHtml(z.id)}')" class="underline hover:text-indigo-800" title="Agregar al mapeo habitual">${escaparHtml(z.nombre)} +</button>`).join(', ')}</div>` : '';

    return `
        <tr data-captura-id="${escaparHtml(c.id)}" class="hover:bg-slate-50 align-top">
            <td class="p-3 text-xs whitespace-nowrap">${formatearFecha(c.fechahora)}</td>
            <td class="p-3 text-xs"><div class="flex items-center gap-1.5"><span class="font-mono">${escaparHtml(c.codigo)}</span><button type="button" data-code="${escaparHtml(c.codigo)}" onclick="copiarCodigoDesdeBoton(this)" class="text-gray-400 hover:text-amber-600" title="Copiar código para consultar en SICAR"><i class="fa-regular fa-copy"></i></button></div></td>
            <td class="p-3 font-semibold"><div>${escaparHtml(c.producto)}</div>${coordinacion}${avisoDesfase}${avisoNoHabitual}</td>
            <td class="p-3"><div class="font-semibold text-slate-800">${escaparHtml(usuarioNombre)}</div>${participantes.length > 1 ? `<div class="text-[10px] text-gray-400">${escaparHtml(participantes.map(p => p.nombre).join(', '))}</div>` : ''}</td>
            <td class="p-3"><div class="font-bold text-slate-900 text-base">${c.fisico}</div><div class="mt-1 space-y-0.5">${desglose}</div></td>
            <td class="p-3"><input id="sicar-${c.id}" type="number" min="0" step="1" value="${escaparHtml(String(valorSicarVista))}" placeholder="Capturar" oninput="actualizarDiferenciaVista('${c.id}')" class="w-24 border rounded p-1.5 text-sm font-bold bg-white focus:ring-2 focus:ring-amber-500 outline-none" title="Consulta SICAR ahora y escribe aquí la existencia vigente" /></td>
            <td id="diferencia-${c.id}" class="p-3 font-bold ${diffClase}">${formatearDiferencia(diff)}</td>
            <td class="p-3"><span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase ${estadoCompleto ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">${estadoCompleto ? 'Completado' : 'Pendiente'}</span></td>
            <td class="p-3 text-center"><button onclick="guardarValidacionCaptura('${c.id}')" class="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded text-xs font-bold shadow"><i class="fa-solid fa-check me-1 text-amber-400"></i>${estadoCompleto ? 'Actualizar' : 'Validar'}</button></td>
        </tr>`;
}

async function confirmarUbicacionHabitual(codigo, zonaId) {
    try {
        await apiAsignarProductoZona(zonaId, codigo);
        const producto = productosDia.find(p => p.codigo === codigo);
        const zona = zonas.find(z => z.id === zonaId);
        if (producto && zona && !producto.ubicaciones.some(u => u.id === zonaId)) producto.ubicaciones.push({ id: zona.id, nombre: zona.nombre });
        if (zona) zona.totalProductos = Number(zona.totalProductos || 0) + 1;
        sincronizarProductosContados();
        renderizarMapeoAdmin();
        renderizarListaEmpleado();
        renderizarTareasCoordinadas();
        mostrarToast('Ubicación agregada al mapeo habitual del producto');
        cargarCapturasDesdeBD({ silencioso: true });
    } catch (error) {
        mostrarToast(`No se pudo actualizar el mapeo: ${error.message}`, 'error');
    }
}

async function eliminarConteoUbicacion(id) {
    if (!window.confirm('¿Quitar este conteo de ubicación?\n\nLa ubicación quedará pendiente y podrá contarse nuevamente. Si el producto ya estaba validado, su validación se reiniciará porque cambiará el total físico.')) return;
    try {
        await apiEliminarConteoUbicacion(id);
        borradoresSicar.clear();
        mostrarToast('Conteo retirado. Ya puede realizarse nuevamente.');
        await cargarCapturasDesdeBD({ silencioso: true });
    } catch (error) {
        mostrarToast(`No se pudo retirar el conteo: ${error.message}`, 'error');
    }
}

function capturasVisiblesEnFiltro() {
    return capturas.filter(c => filtroActual === 'todos' || c.estado === filtroActual);
}

function renderizarTabla() {
    const tbody = document.getElementById('tabla-capturas');
    if (!tbody) return;

    const visibles = capturasVisiblesEnFiltro();
    if (!visibles.length) {
        tbody.innerHTML = '<tr data-empty-row="true"><td colspan="9" class="p-8 text-center text-gray-400 text-sm">No hay capturas para mostrar.</td></tr>';
        return;
    }

    tbody.innerHTML = visibles.map(htmlFilaCaptura).join('');
}

function insertarCapturasNuevasEnTabla() {
    const tbody = document.getElementById('tabla-capturas');
    if (!tbody) return;

    const existentes = new Set(
        [...tbody.querySelectorAll('tr[data-captura-id]')]
            .map(fila => fila.getAttribute('data-captura-id'))
            .filter(Boolean)
    );

    const nuevas = capturasVisiblesEnFiltro().filter(c => !existentes.has(String(c.id)));
    if (!nuevas.length) return;

    tbody.querySelector('tr[data-empty-row="true"]')?.remove();

    // capturas viene ordenado de la más reciente a la más antigua. Insertamos al revés
    // para conservar ese orden al utilizar afterbegin.
    nuevas.slice().reverse().forEach(c => {
        tbody.insertAdjacentHTML('afterbegin', htmlFilaCaptura(c));
    });
}

function filtrarTabla(filtro) {
    filtroActual = filtro;
    ['todos', 'pendiente', 'completado'].forEach(nombre => {
        const boton = document.getElementById(`filtro-${nombre}`);
        if (!boton) return;
        boton.className = nombre === filtro
            ? 'px-3 py-1 rounded-md bg-white shadow text-slate-800'
            : 'px-3 py-1 rounded-md text-gray-500 hover:text-slate-800';
    });
    renderizarTabla();
}

async function guardarValidacionCaptura(id, { forzarUbicaciones = false } = {}) {
    const input = document.getElementById(`sicar-${id}`);
    const valorSicar = String(input?.value ?? '').trim();
    if (valorSicar === '') {
        mostrarToast('Consulta SICAR e ingresa la existencia actual antes de validar', 'error');
        input?.focus();
        return;
    }
    const stockSicar = Number(valorSicar);
    if (!Number.isInteger(stockSicar) || stockSicar < 0) {
        mostrarToast('Ingresa una existencia SICAR válida', 'error');
        input?.focus();
        return;
    }

    try {
        const respuesta = await apiActualizarCaptura(id, { stockSicar, estado: 'COMPLETADO', forzarUbicaciones });
        const actualizada = normalizarCaptura(respuesta.data);
        const indice = capturas.findIndex(c => c.id === id);
        if (indice >= 0) capturas[indice] = actualizada;
        borradoresSicar.delete(id);
        sincronizarProductosContados();
        renderizarTabla();
        mostrarToast('Producto consolidado validado correctamente');
    } catch (error) {
        if (error?.code === 'LOCATIONS_PENDING' && !forzarUbicaciones) {
            const pendientes = Array.isArray(error.body?.pendientes) ? error.body.pendientes.map(z => z.nombre).join(', ') : 'ubicaciones habituales';
            const confirmar = window.confirm(`Todavía falta contar este producto en: ${pendientes}.\n\nLo recomendable es completar esas ubicaciones dentro de la misma ventana de conteo.\n\n¿Deseas validar de todos modos con el total físico actual?`);
            if (confirmar) return guardarValidacionCaptura(id, { forzarUbicaciones: true });
            return;
        }
        if (error?.code === 'COUNT_WINDOW_EXCEEDED' && !forzarUbicaciones) {
            const minutos = Number(error.body?.minutos || 0);
            const ventana = Number(error.body?.ventanaMinutos || 15);
            const confirmar = window.confirm(`Los conteos de este producto se realizaron con ${minutos} minutos de separación y la ventana recomendada es de ${ventana} minutos.\n\nPara una comparación más confiable con SICAR conviene volver a contar sus ubicaciones de forma coordinada.\n\n¿Deseas validar de todos modos?`);
            if (confirmar) return guardarValidacionCaptura(id, { forzarUbicaciones: true });
            return;
        }
        console.error(error);
        mostrarToast(`No se pudo validar: ${error.message}`, 'error');
    }
}

async function crearNuevaZona(event) {
    event.preventDefault();
    const input = document.getElementById('input-nueva-zona');
    const nombre = String(input?.value || '').trim();
    if (!nombre) return mostrarToast('Escribe el nombre de la nueva ubicación', 'error');

    try {
        const respuesta = await apiCrearZona(nombre);
        const nueva = normalizarZona(respuesta?.data || { id: '', nombre });
        if (nueva.id && !zonas.some(z => z.id === nueva.id)) zonas.push(nueva);
        zonas.sort((a, b) => a.nombre.localeCompare(b.nombre));
        if (input) input.value = '';
        renderizarSelectorUbicacionEmpleado();
        renderizarMapeoAdmin();
        mostrarToast(`Ubicación creada: ${nombre}`);
    } catch (error) {
        mostrarToast(`No se pudo crear la ubicación: ${error.message}`, 'error');
    }
}

async function procesarCodigoMapeo(codigo) {
    const codigoLimpio = String(codigo || '').trim();
    const inputNombre = document.getElementById('input-nombre-zona');
    const alerta = document.getElementById('alerta-no-registrado');
    const btnAsignar = document.getElementById('btn-asignar-zona');
    const info = document.getElementById('mapeo-ubicaciones-producto');
    if (!inputNombre) return;

    if (!codigoLimpio) {
        inputNombre.value = '--';
        alerta?.classList.add('hidden');
        info?.classList.add('hidden');
        if (btnAsignar) btnAsignar.disabled = false;
        return;
    }

    const prod = productosDia.find(p => p.codigo === codigoLimpio);
    if (prod) {
        inputNombre.value = prod.nombre;
        alerta?.classList.add('hidden');
        if (btnAsignar) btnAsignar.disabled = false;
        if (info) {
            const nombres = prod.ubicaciones.length ? prod.ubicaciones.map(z => z.nombre).join(' · ') : 'Sin ubicaciones habituales';
            info.innerHTML = `<i class="fa-solid fa-location-dot me-1"></i>Actualmente: ${escaparHtml(nombres)}`;
            info.classList.remove('hidden');
        }
    } else {
        inputNombre.value = '⚠️ Producto no registrado';
        alerta?.classList.remove('hidden');
        info?.classList.add('hidden');
        if (btnAsignar) btnAsignar.disabled = true;
    }
}

async function procesarEscaneoMapeo(codigo) {
    const input = document.getElementById('input-codigo-zona');
    if (input) input.value = codigo;
    let producto = productosDia.find(p => p.codigo === String(codigo).trim());
    if (!producto) producto = await buscarProducto(codigo);
    await procesarCodigoMapeo(codigo);
    mostrarToast(producto ? `Producto escaneado: ${producto.nombre}` : 'Producto no catalogado', producto ? 'success' : 'error');
}

async function simularEscaneoMapeo(codigo) {
    await procesarEscaneoMapeo(codigo);
}

function filtrarMapeoAdmin() {
    filtroMapeoAdmin = String(document.getElementById('input-buscar-mapeo')?.value || '').trim().toLowerCase();
    renderizarMapeoAdmin();
}

function renderizarMapeoAdmin() {
    const sel = document.getElementById('select-zona-activa');
    const cont = document.getElementById('contenedor-zonas-admin');
    if (!sel || !cont) return;

    const seleccionAnterior = sel.value;
    sel.innerHTML = zonas.length
        ? zonas.map(z => `<option value="${escaparHtml(z.id)}">${escaparHtml(z.nombre)}</option>`).join('')
        : '<option value="">Crea una ubicación primero</option>';
    if (zonas.some(z => z.id === seleccionAnterior)) sel.value = seleccionAnterior;

    const mapeados = productosDia.filter(p => p.ubicaciones.length > 0).length;
    const sinZona = productosDia.length - mapeados;
    const eZ = document.getElementById('mapeo-total-zonas');
    const eM = document.getElementById('mapeo-total-mapeados');
    const eS = document.getElementById('mapeo-sin-zona');
    if (eZ) eZ.textContent = zonas.length;
    if (eM) eM.textContent = mapeados;
    if (eS) eS.textContent = sinZona;

    if (!zonas.length) {
        cont.innerHTML = '<div class="col-span-full text-xs text-gray-400 italic border rounded-lg p-6 text-center">No hay ubicaciones configuradas. Crea la primera para comenzar el mapeo.</div>';
        return;
    }

    const filtro = filtroMapeoAdmin;
    cont.innerHTML = zonas.map(z => {
        let productosZona = productosDia.filter(p => p.ubicaciones.some(u => u.id === z.id));
        if (filtro) productosZona = productosZona.filter(p => `${p.nombre} ${p.codigo}`.toLowerCase().includes(filtro));
        const prodsHTML = productosZona.map(p => `
            <div class="text-xs bg-white p-2 border rounded flex justify-between items-center gap-2">
                <div class="min-w-0"><div class="font-bold truncate">${escaparHtml(p.nombre)}</div><div class="font-mono text-gray-400 text-[10px]">${escaparHtml(p.codigo)}</div></div>
                <button type="button" onclick="quitarProductoDeZona('${z.id}','${p.id}')" class="text-red-500 hover:bg-red-50 border border-red-100 rounded px-2 py-1 text-[10px] font-bold whitespace-nowrap" title="Quitar solamente de esta ubicación"><i class="fa-solid fa-link-slash me-1"></i>Quitar</button>
            </div>`).join('');
        return `<div class="border rounded-xl p-3 bg-gray-50 space-y-2">
            <div class="flex justify-between items-start gap-2 border-b pb-2">
                <div><div class="font-bold text-xs text-slate-800"><i class="fa-solid fa-location-dot me-1 text-amber-500"></i>${escaparHtml(z.nombre)}</div><div class="text-[10px] text-gray-400 mt-0.5">${productosZona.length}${filtro ? ' visibles' : ''} producto(s)</div></div>
                <div class="flex gap-1"><button type="button" onclick="renombrarZona('${z.id}')" class="w-7 h-7 border rounded bg-white text-slate-500 hover:text-amber-600" title="Renombrar"><i class="fa-solid fa-pen"></i></button><button type="button" onclick="eliminarZona('${z.id}')" class="w-7 h-7 border rounded bg-white text-red-500 hover:bg-red-50" title="Eliminar ubicación"><i class="fa-solid fa-trash"></i></button></div>
            </div>
            <div class="space-y-1 max-h-52 overflow-y-auto">${prodsHTML || `<span class="block text-xs text-gray-400 italic py-2">${filtro ? 'Sin coincidencias en esta ubicación' : 'Sin productos asignados'}</span>`}</div>
        </div>`;
    }).join('');
}

async function asignarProductoAZona(event) {
    event.preventDefault();
    const codigo = String(document.getElementById('input-codigo-zona')?.value || '').trim();
    const zonaId = document.getElementById('select-zona-activa')?.value;
    const zona = zonas.find(z => z.id === zonaId);
    if (!codigo || !zona) return mostrarToast('Selecciona una ubicación y escanea un producto', 'error');

    const producto = productosDia.find(p => p.codigo === codigo) || await buscarProducto(codigo);
    if (!producto) {
        await procesarCodigoMapeo(codigo);
        return mostrarToast('El producto todavía no está registrado', 'error');
    }
    if (producto.ubicaciones.some(z => z.id === zona.id)) return mostrarToast(`${producto.nombre} ya está asignado a ${zona.nombre}`, 'error');

    try {
        await apiAsignarProductoZona(zona.id, codigo);
        producto.ubicaciones.push({ id: zona.id, nombre: zona.nombre });
        zona.totalProductos = Number(zona.totalProductos || 0) + 1;
        sincronizarProductosContados();
        renderizarMapeoAdmin();
        renderizarListaEmpleado();
        renderizarTareasCoordinadas();
        document.getElementById('input-codigo-zona').value = '';
        document.getElementById('input-nombre-zona').value = '--';
        document.getElementById('mapeo-ubicaciones-producto')?.classList.add('hidden');
        mostrarToast(`${producto.nombre} también quedó asignado a ${zona.nombre}`);
    } catch (error) {
        mostrarToast(`No se pudo asignar la ubicación: ${error.message}`, 'error');
    }
}

async function quitarProductoDeZona(zonaId, productoId) {
    const zona = zonas.find(z => z.id === zonaId);
    const producto = productosDia.find(p => p.id === productoId);
    if (!zona || !producto) return;
    if (!window.confirm(`¿Quitar ${producto.nombre} de ${zona.nombre}?\n\nEl producto NO se eliminará del catálogo y sus conteos históricos no se modificarán.`)) return;
    try {
        await apiQuitarProductoZona(zonaId, productoId);
        producto.ubicaciones = producto.ubicaciones.filter(u => u.id !== zonaId);
        zona.totalProductos = Math.max(0, Number(zona.totalProductos || 0) - 1);
        sincronizarProductosContados();
        renderizarMapeoAdmin();
        renderizarListaEmpleado();
        renderizarTareasCoordinadas();
        mostrarToast('Asignación eliminada correctamente');
    } catch (error) {
        mostrarToast(`No se pudo quitar el producto: ${error.message}`, 'error');
    }
}

async function renombrarZona(zonaId) {
    const zona = zonas.find(z => z.id === zonaId);
    if (!zona) return;
    const nombre = window.prompt('Nuevo nombre de la ubicación:', zona.nombre);
    if (nombre === null || !String(nombre).trim() || String(nombre).trim() === zona.nombre) return;
    try {
        const nuevoNombre = String(nombre).trim();
        await apiRenombrarZona(zonaId, nuevoNombre);
        zona.nombre = nuevoNombre;
        productosDia.forEach(p => p.ubicaciones.forEach(u => { if (u.id === zonaId) u.nombre = nuevoNombre; }));
        renderizarSelectorUbicacionEmpleado();
        renderizarMapeoAdmin();
        renderizarListaEmpleado();
        renderizarTareasCoordinadas();
        mostrarToast('Ubicación renombrada correctamente');
    } catch (error) {
        mostrarToast(`No se pudo renombrar: ${error.message}`, 'error');
    }
}

async function eliminarZona(zonaId) {
    const zona = zonas.find(z => z.id === zonaId);
    if (!zona) return;
    const productos = productosDia.filter(p => p.ubicaciones.some(u => u.id === zonaId)).length;
    const texto = productos
        ? `La ubicación ${zona.nombre} tiene ${productos} producto(s) asignado(s).\n\nAl eliminarla se quitará esa asignación, pero NO se borrarán productos ni conteos históricos. ¿Continuar?`
        : `¿Eliminar la ubicación ${zona.nombre}?`;
    if (!window.confirm(texto)) return;
    try {
        await apiEliminarZona(zonaId);
        zonas = zonas.filter(z => z.id !== zonaId);
        productosDia.forEach(p => { p.ubicaciones = p.ubicaciones.filter(u => u.id !== zonaId); });
        sincronizarProductosContados();
        renderizarSelectorUbicacionEmpleado();
        renderizarMapeoAdmin();
        renderizarListaEmpleado();
        renderizarTareasCoordinadas();
        mostrarToast('Ubicación eliminada correctamente');
    } catch (error) {
        mostrarToast(`No se pudo eliminar: ${error.message}`, 'error');
    }
}

function abrirModalAlta() {
    const codigo = String(document.getElementById('input-codigo-zona')?.value || '').trim();
    if (!codigo) {
        mostrarToast('Primero escribe o escanea un código', 'error');
        return;
    }
    const modalCodigo = document.getElementById('modal-codigo');
    if (modalCodigo) modalCodigo.value = codigo;
    document.getElementById('modal-nombre')?.focus();
    document.getElementById('modal-alta-producto')?.classList.remove('hidden');
}

function cerrarModalAlta() {
    document.getElementById('modal-alta-producto')?.classList.add('hidden');
    const nombre = document.getElementById('modal-nombre');
    const precio = document.getElementById('modal-precio');
    if (nombre) nombre.value = '';
    if (precio) precio.value = '';
}

async function guardarNuevoProducto(event) {
    event.preventDefault();

    const codigo = String(document.getElementById('modal-codigo')?.value || '').trim();
    const nombre = String(document.getElementById('modal-nombre')?.value || '').trim();
    const precio = Number(document.getElementById('modal-precio')?.value || 0);
    const categoria = document.getElementById('modal-depto')?.value || 'General';
    const zona = zonas.find(z => z.id === document.getElementById('select-zona-activa')?.value);

    if (!codigo || !nombre || !Number.isFinite(precio) || precio < 0) {
        mostrarToast('Completa correctamente los datos del producto', 'error');
        return;
    }

    try {
        const creado = await apiCrearProducto({
            codigo,
            nombre,
            precio,
            stock: 0,
            categoria,
            seccion: null
        });

        if (zona?.id) await apiAsignarProductoZona(zona.id, codigo);
        const nuevo = normalizarProducto(creado);
        productosDia.push(nuevo);
        await cargarProductosDesdeBD();
        cerrarModalAlta();
        document.getElementById('input-codigo-zona').value = codigo;
        await procesarCodigoMapeo(codigo);
        renderizarMapeoAdmin();
        renderizarListaEmpleado();
        mostrarToast('Producto registrado correctamente');
    } catch (error) {
        console.error(error);
        mostrarToast(`No se pudo registrar: ${error.message}`, 'error');
    }
}

async function copiarTextoPortapapeles(texto) {
    const valor = String(texto ?? '');
    if (!valor) return false;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(valor);
            return true;
        }
    } catch (_) {}

    try {
        const area = document.createElement('textarea');
        area.value = valor;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const copiado = document.execCommand('copy');
        area.remove();
        return copiado;
    } catch (_) {
        return false;
    }
}

async function copiarCodigoDesdeBoton(boton) {
    const codigo = boton?.dataset?.code || '';
    const copiado = await copiarTextoPortapapeles(codigo);
    mostrarToast(copiado ? `Código ${codigo} copiado` : 'No fue posible copiar el código automáticamente', copiado ? 'success' : 'error');
}

function escaparHtml(valor) {
    return String(valor ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function mostrarToast(msg, tipo = 'success', duracion = 2800) {
    const toast = document.getElementById('toast');
    const texto = document.getElementById('toast-msg');
    const icono = toast?.querySelector('i');
    if (!toast || !texto) return;

    texto.innerText = msg;
    if (icono) {
        icono.className = tipo === 'error'
            ? 'fa-solid fa-circle-exclamation text-red-400 text-lg'
            : tipo === 'warning'
                ? 'fa-solid fa-triangle-exclamation text-amber-400 text-lg'
                : 'fa-solid fa-circle-check text-emerald-400 text-lg';
    }

    toast.classList.remove('hidden');
    clearTimeout(mostrarToast._timer);
    mostrarToast._timer = setTimeout(() => toast.classList.add('hidden'), duracion);
}


function programarSincronizacionTiempoReal({ capturas: recargarCapturas = false, productos = false, sesion = false } = {}) {
    sincronizacionTiempoRealPendiente.capturas ||= recargarCapturas;
    sincronizacionTiempoRealPendiente.productos ||= productos;
    sincronizacionTiempoRealPendiente.sesion ||= sesion;

    if (sincronizacionTiempoRealTimer) return;

    sincronizacionTiempoRealTimer = setTimeout(async () => {
        sincronizacionTiempoRealTimer = null;
        const pendiente = { ...sincronizacionTiempoRealPendiente };
        sincronizacionTiempoRealPendiente.capturas = false;
        sincronizacionTiempoRealPendiente.productos = false;
        sincronizacionTiempoRealPendiente.sesion = false;

        try {
            if (pendiente.sesion) await cargarSesionInventarioActiva();
            if (pendiente.productos) {
                await cargarZonasDesdeBD({ silencioso: true });
                await cargarProductosDesdeBD();
            }
            if (pendiente.capturas) await cargarCapturasDesdeBD({ silencioso: true });
        } catch (error) {
            console.warn('No se pudo sincronizar el inventario en tiempo real:', error);
        }
    }, 80);
}

function procesarEventoInventarioTiempoReal(evento) {
    const tipo = String(evento?.tipo || '');
    if (!tipo || tipo === 'conexion') return;

    if (tipo === 'captura_creada' || tipo === 'captura_actualizada') {
        programarSincronizacionTiempoReal({ capturas: true });
        return;
    }

    if (tipo === 'sesion_nueva' || tipo === 'sesion_finalizada') {
        programarSincronizacionTiempoReal({ sesion: true, capturas: true });
        if (usuarioActualEsAdmin()) cargarHistorialInventarios({ silencioso: true });
        return;
    }

    if (tipo === 'catalogo_actualizado') {
        programarSincronizacionTiempoReal({ productos: true });
    }
}

function detenerEventosInventarioTiempoReal() {
    if (eventosInventarioReconectarTimer) {
        clearTimeout(eventosInventarioReconectarTimer);
        eventosInventarioReconectarTimer = null;
    }
    if (eventosInventarioAbortController) {
        eventosInventarioAbortController.abort();
        eventosInventarioAbortController = null;
    }
}

function iniciarEventosInventarioTiempoReal() {
    detenerEventosInventarioTiempoReal();
    if (!obtenerUsuarioActual()) return;

    const controller = new AbortController();
    eventosInventarioAbortController = controller;

    apiEscucharEventosInventario({
        signal: controller.signal,
        onEvento: procesarEventoInventarioTiempoReal
    }).then(() => {
        if (controller.signal.aborted || !obtenerUsuarioActual()) return;
        eventosInventarioReconectarTimer = setTimeout(iniciarEventosInventarioTiempoReal, 1500);
    }).catch(error => {
        if (error?.name === 'AbortError' || controller.signal.aborted) return;
        console.warn('Canal en tiempo real desconectado. Se intentará reconectar:', error?.message || error);
        if (obtenerUsuarioActual()) {
            eventosInventarioReconectarTimer = setTimeout(iniciarEventosInventarioTiempoReal, 2000);
        }
    });
}

window.detenerEventosInventarioTiempoReal = detenerEventosInventarioTiempoReal;

async function inicializarAplicacionProtegida() {
    // Los eventos se registran una sola vez, aunque el usuario cierre sesión y vuelva a entrar.
    if (!appEventosInicializados) {
        const codigoInput = document.getElementById('codigo-input');
        codigoInput?.addEventListener('keydown', async event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                await procesarEscaneoEmpleado(codigoInput.value);
            }
        });

        // Respaldo periódico. La actualización principal llega mediante el canal SSE,
        // pero este sondeo permite recuperar el estado si una red móvil corta temporalmente la conexión.
        intervaloRecepcion = setInterval(() => {
            if (!obtenerUsuarioActual()) return;
            const appVisible = !document.getElementById('app-main')?.classList.contains('hidden');
            if (!appVisible) return;
            cargarCapturasDesdeBD({ silencioso: true });
        }, 10000);

        // Al terminar de escribir una existencia SICAR hacemos un render completo para
        // incorporar también cambios de filas existentes que se hubieran diferido.
        document.addEventListener('focusout', event => {
            const elemento = event.target;
            if (!elemento || elemento.tagName !== 'INPUT' || !String(elemento.id || '').startsWith('sicar-')) return;
            setTimeout(() => {
                if (usuarioActualEsAdmin() && !hayEdicionSicarActiva()) renderizarTabla();
            }, 0);
        });

        window.addEventListener('focus', () => {
            if (obtenerUsuarioActual()) cargarCapturasDesdeBD({ silencioso: true });
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && obtenerUsuarioActual()) {
                cargarCapturasDesdeBD({ silencioso: true });
            }
        });

        appEventosInicializados = true;
    }

    productosDia = [];
    capturas = [];
    usuariosAdmin = [];
    historialInventariosAdmin = [];
    detalleInventarioAdmin = null;
    filtrosHistorialAdmin = { desde: '', hasta: '' };
    filtrosDetalleHistorialAdmin = { desde: '', hasta: '', departamento: '', zona: '' };
    passwordTemporalActual = '';
    borradoresSicar.clear();
    sesionInventarioActiva = null;
    filtroActual = 'todos';
    await cargarDatosIniciales();
    iniciarEventosInventarioTiempoReal();
}

window.inicializarAplicacionProtegida = inicializarAplicacionProtegida;

window.addEventListener('load', async () => {
    await inicializarAutenticacion();
});
