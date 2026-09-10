const STORAGE_ZONAS = 'laFlorMexico_zonas_v1';

let zonas = cargarZonasLocales();
let productosDia = [];
let capturas = [];
let filtroActual = 'todos';
let refrescandoCapturas = false;
let codigoEmpleadoPreview = '';
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
// Conserva lo que el administrador está escribiendo en SICAR aunque llegue un refresco en vivo.
const borradoresSicar = new Map();

function cargarZonasLocales() {
    const zonasBase = [
        { id: 'z1', nombre: 'Pasillo #1 (Entrada)' },
        { id: 'z2', nombre: 'Refri 1 (Lácteos)' }
    ];

    try {
        const guardadas = JSON.parse(localStorage.getItem(STORAGE_ZONAS));
        return Array.isArray(guardadas) && guardadas.length ? guardadas : zonasBase;
    } catch (_) {
        return zonasBase;
    }
}

function guardarZonasLocales() {
    try {
        localStorage.setItem(STORAGE_ZONAS, JSON.stringify(zonas));
    } catch (_) {}
}

function normalizarProducto(p) {
    return {
        id: p.id,
        codigo: String(p.codigo || '').trim(),
        nombre: p.nombre || 'Producto sin nombre',
        precio: Number(p.precio || 0),
        stock: Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0,
        depto: p.categoria || 'General',
        zona: p.seccion || '',
        contado: false
    };
}

function normalizarCaptura(c) {
    return {
        id: c.id,
        fechahora: c.createdAt || c.fechahora,
        codigo: c.producto?.codigo || c.codigo || '',
        producto: c.producto?.nombre || c.productoNombre || c.producto || 'Producto no identificado',
        fisico: Number(c.cantidadFisica ?? c.fisico ?? 0),
        sicar: c.stockSicar ?? c.sicar ?? null,
        diferencia: c.diferencia ?? null,
        estado: String(c.estado || 'PENDIENTE').toLowerCase(),
        zona: c.seccionCapturada || c.zona || c.producto?.seccion || 'General',
        usuarioNombre: c.usuario?.nombre || c.usuarioNombre || c.usuario?.username || 'Sin identificar',
        usuarioUsername: c.usuario?.username || c.usuarioUsername || ''
    };
}

function incorporarZonasDesdeProductos() {
    let cambio = false;
    productosDia.forEach(producto => {
        const nombre = String(producto.zona || '').trim();
        if (!nombre) return;
        if (!zonas.some(z => z.nombre.toLowerCase() === nombre.toLowerCase())) {
            zonas.push({ id: `z-${Date.now()}-${zonas.length}`, nombre });
            cambio = true;
        }
    });
    if (cambio) guardarZonasLocales();
}

function sincronizarProductosContados() {
    const codigosContados = new Set(capturas.map(c => c.codigo).filter(Boolean));
    productosDia.forEach(p => { p.contado = codigosContados.has(p.codigo); });
}

async function cargarProductosDesdeBD() {
    try {
        const data = await apiObtenerProductos();
        productosDia = Array.isArray(data) ? data.map(normalizarProducto) : [];
        incorporarZonasDesdeProductos();
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
        if (respuesta?.sesion) {
            sesionInventarioActiva = respuesta.sesion;
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
    const nombre = sesionInventarioActiva?.nombre || 'Inventario activo';
    const fecha = sesionInventarioActiva?.fechaInicio
        ? formatearFecha(sesionInventarioActiva.fechaInicio)
        : '--';

    const labelOperativo = document.getElementById('sesion-operativa-label');
    const labelAdmin = document.getElementById('sesion-admin-label');
    const fechaAdmin = document.getElementById('sesion-admin-fecha');

    if (labelOperativo) labelOperativo.textContent = nombre;
    if (labelAdmin) labelAdmin.textContent = nombre;
    if (fechaAdmin) fechaAdmin.textContent = `Iniciado: ${fecha}`;
}

async function iniciarNuevoInventario() {
    if (!usuarioActualEsAdmin()) {
        mostrarToast('Solo un administrador puede iniciar un inventario', 'error');
        return;
    }

    const confirmado = window.confirm(
        'Se cerrará el inventario actual y comenzará uno nuevo.\n\n' +
        'Las capturas anteriores se conservarán para el histórico y todos los productos volverán a aparecer como pendientes.\n\n' +
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

async function cargarDatosIniciales() {
    await Promise.all([
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
        'mapeo': document.getElementById('tab-mapeo'),
        'usuarios': document.getElementById('tab-usuarios')
    };
    const botones = {
        'en-vivo': document.getElementById('tab-btn-vivo'),
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
        incorporarZonasDesdeProductos();
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
        mostrarToast('Producto no encontrado en la base de datos', 'error');
        return null;
    }

    if (inputProd) inputProd.value = producto.nombre;
    if (inputPrecio) inputPrecio.value = `$${producto.precio.toFixed(2)}`;
    if (inputCant) inputCant.focus();
    mostrarToast(`Producto encontrado: ${producto.nombre}`);
    return producto;
}

async function simularEscaneo(codigo) {
    await procesarEscaneoEmpleado(codigo);
}

async function registrarConteo(event) {
    event.preventDefault();

    const codigoInput = document.getElementById('codigo-input');
    const cantidadInput = document.getElementById('cantidad-input');
    const productoInput = document.getElementById('producto-input');
    const precioInput = document.getElementById('precio-input');

    const codigo = String(codigoInput?.value || '').trim();
    const cantidad = Number(cantidadInput?.value);

    if (!codigo || !Number.isInteger(cantidad) || cantidad < 0) {
        mostrarToast('Ingresa un código y una cantidad válida', 'error');
        return;
    }

    const producto = await buscarProducto(codigo);
    if (!producto) {
        mostrarToast('No se puede registrar: producto no encontrado', 'error');
        return;
    }

    if (producto.contado) {
        mostrarToast('Este producto ya fue contado en el inventario activo', 'error');
        return;
    }

    try {
        const respuesta = await apiRegistrarCaptura({
            codigo,
            cantidad,
            zona: producto.zona || 'General'
        });

        const nueva = normalizarCaptura(respuesta.data);
        capturas.unshift(nueva);
        producto.contado = true;

        if (codigoInput) codigoInput.value = '';
        if (cantidadInput) cantidadInput.value = '';
        if (productoInput) productoInput.value = '--';
        if (precioInput) precioInput.value = '$0.00';
        codigoEmpleadoPreview = '';

        renderizarListaEmpleado();
        renderizarTabla();
        mostrarToast(`Conteo registrado: ${cantidad} unidades`);
        codigoInput?.focus();
    } catch (error) {
        console.error(error);
        if (error?.code === 'PRODUCT_ALREADY_COUNTED') {
            await cargarCapturasDesdeBD({ silencioso: true });
            mostrarToast('Otro usuario ya contó este producto en el inventario activo', 'error');
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

    productosDia.forEach(producto => {
        const grupo = orden === 'departamento'
            ? (producto.depto || 'General')
            : (producto.zona || 'Sin zona asignada');
        if (!grupos.has(grupo)) grupos.set(grupo, []);
        grupos.get(grupo).push(producto);
    });

    const ultimaCapturaPorCodigo = new Map();
    capturas.forEach(captura => {
        if (!captura.codigo || !captura.fechahora) return;
        const fecha = new Date(captura.fechahora).getTime();
        if (!Number.isFinite(fecha)) return;
        const actual = ultimaCapturaPorCodigo.get(captura.codigo) || 0;
        if (fecha > actual) ultimaCapturaPorCodigo.set(captura.codigo, fecha);
    });

    const infoGrupo = nombre => {
        const productos = grupos.get(nombre) || [];
        const completado = productos.length > 0 && productos.every(p => p.contado);
        const fechaFinalizacion = completado
            ? Math.max(...productos.map(p => ultimaCapturaPorCodigo.get(p.codigo) || 0))
            : 0;
        return { productos, completado, fechaFinalizacion };
    };

    const nombresGrupos = [...grupos.keys()].sort((a, b) => {
        // La agrupación grande de productos sin zona siempre queda hasta el final.
        if (orden === 'barrida') {
            if (a === 'Sin zona asignada') return 1;
            if (b === 'Sin zona asignada') return -1;

            const infoA = infoGrupo(a);
            const infoB = infoGrupo(b);

            // Zonas pendientes primero; zonas 100% contadas se apilan abajo,
            // inmediatamente antes de "Sin zona asignada".
            if (infoA.completado !== infoB.completado) {
                return infoA.completado ? 1 : -1;
            }

            // Entre zonas terminadas conservamos el orden en que se fueron completando:
            // la última terminada queda más cerca de "Sin zona asignada".
            if (infoA.completado && infoB.completado && infoA.fechaFinalizacion !== infoB.fechaFinalizacion) {
                return infoA.fechaFinalizacion - infoB.fechaFinalizacion;
            }
        }

        return a.localeCompare(b, 'es');
    });

    const fragment = document.createDocumentFragment();
    nombresGrupos.forEach(nombreGrupo => {
        const info = infoGrupo(nombreGrupo);
        const productos = info.productos.sort((a, b) => {
            if (a.contado !== b.contado) return a.contado ? 1 : -1;
            return a.nombre.localeCompare(b.nombre, 'es');
        });
        const sec = document.createElement('div');
        const icono = orden === 'departamento' ? 'fa-folder' : 'fa-location-dot';
        const etiquetaCompletada = orden === 'barrida' && nombreGrupo !== 'Sin zona asignada' && info.completado
            ? '<span class="ms-2 text-[9px] text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">COMPLETA</span>'
            : '';
        sec.innerHTML = `<h4 class="font-bold text-xs uppercase bg-slate-100 text-slate-700 px-2 py-1 rounded mb-2"><i class="fa-solid ${icono} me-1"></i>${escaparHtml(nombreGrupo)} <span class="text-[10px] text-gray-400">(${productos.length})</span>${etiquetaCompletada}</h4>`;

        const sublist = document.createElement('div');
        sublist.className = 'space-y-1.5 pl-1 mb-3';

        productos.forEach(prod => {
            const div = document.createElement('div');
            div.className = `p-2.5 rounded-lg border text-xs flex justify-between items-center ${prod.contado ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-white border-gray-200'}`;
            div.innerHTML = `
                <div class="min-w-0 pr-2">
                    <div class="font-bold truncate">${escaparHtml(prod.nombre)}</div>
                    <div class="text-[10px] text-gray-400 font-mono">${escaparHtml(prod.codigo)}</div>
                </div>
                ${prod.contado
                    ? '<span class="text-emerald-600 font-bold text-[10px] whitespace-nowrap"><i class="fa-solid fa-circle-check"></i> Contado</span>'
                    : '<span class="text-gray-400 text-[10px] whitespace-nowrap">Pendiente</span>'}
            `;
            sublist.appendChild(div);
        });

        sec.appendChild(sublist);
        fragment.appendChild(sec);
    });

    cont.innerHTML = '';
    cont.appendChild(fragment);
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
    const diff = numeroBorrador !== null && Number.isInteger(numeroBorrador)
        ? c.fisico - numeroBorrador
        : c.diferencia;
    const diffClase = diff === null ? 'text-gray-400' : diff === 0 ? 'text-emerald-600' : 'text-red-600';
    const estadoCompleto = c.estado === 'completado';
    const usuarioNombre = c.usuarioNombre || c.usuarioUsername || 'Sin identificar';
    const usuarioUsername = c.usuarioUsername && c.usuarioUsername !== usuarioNombre
        ? `@${c.usuarioUsername}`
        : '';

    return `
        <tr data-captura-id="${escaparHtml(c.id)}" class="hover:bg-slate-50">
            <td class="p-3 text-xs whitespace-nowrap">${formatearFecha(c.fechahora)}</td>
            <td class="p-3 font-mono text-xs">${escaparHtml(c.codigo)}</td>
            <td class="p-3 font-semibold">${escaparHtml(c.producto)}</td>
            <td class="p-3 whitespace-nowrap">
                <div class="font-semibold text-slate-800">${escaparHtml(usuarioNombre)}</div>
                ${usuarioUsername ? `<div class="text-[10px] text-gray-400">${escaparHtml(usuarioUsername)}</div>` : ''}
            </td>
            <td class="p-3 font-bold text-slate-900">${c.fisico}</td>
            <td class="p-3">
                <input
                    id="sicar-${c.id}"
                    type="number"
                    min="0"
                    step="1"
                    value="${escaparHtml(String(valorSicarVista))}"
                    placeholder="Capturar"
                    oninput="actualizarDiferenciaVista('${c.id}')"
                    class="w-24 border rounded p-1.5 text-sm font-bold bg-white focus:ring-2 focus:ring-amber-500 outline-none"
                    title="Consulta SICAR ahora y escribe aquí la existencia vigente"
                />
            </td>
            <td id="diferencia-${c.id}" class="p-3 font-bold ${diffClase}">${formatearDiferencia(diff)}</td>
            <td class="p-3">
                <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase ${estadoCompleto ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
                    ${estadoCompleto ? 'Completado' : 'Pendiente'}
                </span>
            </td>
            <td class="p-3 text-center">
                <button onclick="guardarValidacionCaptura('${c.id}')" class="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded text-xs font-bold shadow">
                    <i class="fa-solid fa-check me-1 text-amber-400"></i>${estadoCompleto ? 'Actualizar' : 'Validar'}
                </button>
            </td>
        </tr>
    `;
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

async function guardarValidacionCaptura(id) {
    const input = document.getElementById(`sicar-${id}`);
    const valorSicar = String(input?.value ?? '').trim();

    if (valorSicar === '') {
        mostrarToast('Consulta SICAR e ingresa la existencia actual antes de validar', 'error');
        input?.focus();
        return;
    }

    const stockSicar = Number(valorSicar);
    if (!Number.isInteger(stockSicar)) {
        mostrarToast('Ingresa una existencia SICAR válida', 'error');
        input?.focus();
        return;
    }

    try {
        const respuesta = await apiActualizarCaptura(id, {
            stockSicar,
            estado: 'COMPLETADO'
        });
        const actualizada = normalizarCaptura(respuesta.data);
        const indice = capturas.findIndex(c => c.id === id);
        if (indice >= 0) capturas[indice] = actualizada;
        borradoresSicar.delete(id);
        renderizarTabla();
        mostrarToast('Captura validada correctamente');
    } catch (error) {
        console.error(error);
        mostrarToast(`No se pudo validar: ${error.message}`, 'error');
    }
}

function crearNuevaZona(event) {
    event.preventDefault();
    const input = document.getElementById('input-nueva-zona');
    const nombre = String(input?.value || '').trim();

    if (!nombre) {
        mostrarToast('Escribe el nombre de la nueva zona', 'error');
        return;
    }

    if (zonas.some(z => z.nombre.toLowerCase() === nombre.toLowerCase())) {
        mostrarToast('Esa zona ya existe', 'error');
        return;
    }

    zonas.push({ id: `z-${Date.now()}`, nombre });
    guardarZonasLocales();
    if (input) input.value = '';
    renderizarMapeoAdmin();
    mostrarToast(`Zona creada: ${nombre}`);
}

async function procesarCodigoMapeo(codigo) {
    const codigoLimpio = String(codigo || '').trim();
    const inputNombre = document.getElementById('input-nombre-zona');
    const alerta = document.getElementById('alerta-no-registrado');
    const btnAsignar = document.getElementById('btn-asignar-zona');

    if (!inputNombre) return;

    if (!codigoLimpio) {
        inputNombre.value = '--';
        alerta?.classList.add('hidden');
        if (btnAsignar) btnAsignar.disabled = false;
        return;
    }

    const prodEncontrado = productosDia.find(p => p.codigo === codigoLimpio);
    if (prodEncontrado) {
        inputNombre.value = prodEncontrado.nombre;
        alerta?.classList.add('hidden');
        if (btnAsignar) btnAsignar.disabled = false;
    } else {
        inputNombre.value = '⚠️ Producto no registrado';
        alerta?.classList.remove('hidden');
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

function renderizarMapeoAdmin() {
    const sel = document.getElementById('select-zona-activa');
    const cont = document.getElementById('contenedor-zonas-admin');
    if (!sel || !cont) return;

    const seleccionAnterior = sel.value;
    sel.innerHTML = '';
    cont.innerHTML = '';

    if (!zonas.length) {
        sel.innerHTML = '<option value="">Crea una zona primero</option>';
        cont.innerHTML = '<div class="text-xs text-gray-400 italic">No hay zonas configuradas.</div>';
        return;
    }

    zonas.forEach(z => {
        const opt = document.createElement('option');
        opt.value = z.id;
        opt.innerText = z.nombre;
        sel.appendChild(opt);

        const productosZona = productosDia.filter(p => p.zona === z.nombre);
        const card = document.createElement('div');
        card.className = 'border rounded-lg p-3 bg-gray-50 space-y-2';

        const prodsHTML = productosZona.map(p => `
            <div class="text-xs bg-white p-1.5 border rounded flex justify-between gap-2">
                <span class="font-bold truncate">${escaparHtml(p.nombre)}</span>
                <span class="font-mono text-gray-400 whitespace-nowrap">${escaparHtml(p.codigo)}</span>
            </div>
        `).join('');

        card.innerHTML = `
            <div class="flex justify-between items-center border-b pb-1 font-bold text-xs text-slate-800">
                <span><i class="fa-solid fa-location-dot me-1 text-amber-500"></i> ${escaparHtml(z.nombre)}</span>
                <span class="bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-[10px]">${productosZona.length} items</span>
            </div>
            <div class="space-y-1 max-h-40 overflow-y-auto">${prodsHTML || '<span class="text-xs text-gray-400 italic">Sin productos asignados</span>'}</div>
        `;
        cont.appendChild(card);
    });

    if ([...sel.options].some(o => o.value === seleccionAnterior)) sel.value = seleccionAnterior;
}

async function asignarProductoAZona(event) {
    event.preventDefault();
    const codigo = String(document.getElementById('input-codigo-zona')?.value || '').trim();
    const zonaId = document.getElementById('select-zona-activa')?.value;
    const zona = zonas.find(z => z.id === zonaId);

    if (!codigo || !zona) {
        mostrarToast('Selecciona una zona y escanea un producto', 'error');
        return;
    }

    let producto = productosDia.find(p => p.codigo === codigo);
    if (!producto) producto = await buscarProducto(codigo);

    if (!producto) {
        procesarCodigoMapeo(codigo);
        mostrarToast('El producto todavía no está registrado', 'error');
        return;
    }

    try {
        const actualizado = await apiActualizarProducto(codigo, { seccion: zona.nombre });
        Object.assign(producto, normalizarProducto(actualizado), { contado: producto.contado });
        renderizarMapeoAdmin();
        renderizarListaEmpleado();
        document.getElementById('input-codigo-zona').value = '';
        document.getElementById('input-nombre-zona').value = '--';
        mostrarToast(`${producto.nombre} asignado a ${zona.nombre}`);
    } catch (error) {
        console.error(error);
        mostrarToast(`No se pudo asignar la zona: ${error.message}`, 'error');
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
            seccion: zona?.nombre || null
        });

        const nuevo = normalizarProducto(creado);
        productosDia.push(nuevo);
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

function escaparHtml(valor) {
    return String(valor ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function mostrarToast(msg, tipo = 'success') {
    const toast = document.getElementById('toast');
    const texto = document.getElementById('toast-msg');
    const icono = toast?.querySelector('i');
    if (!toast || !texto) return;

    texto.innerText = msg;
    if (icono) {
        icono.className = tipo === 'error'
            ? 'fa-solid fa-circle-exclamation text-red-400 text-lg'
            : 'fa-solid fa-circle-check text-emerald-400 text-lg';
    }

    toast.classList.remove('hidden');
    clearTimeout(mostrarToast._timer);
    mostrarToast._timer = setTimeout(() => toast.classList.add('hidden'), 2800);
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
            if (pendiente.productos) await cargarProductosDesdeBD();
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

    if (tipo === 'sesion_nueva') {
        programarSincronizacionTiempoReal({ sesion: true, capturas: true });
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
