const STORAGE_ZONAS = 'laFlorMexico_zonas_v1';

let zonas = cargarZonasLocales();
let productosDia = [];
let capturas = [];
let filtroActual = 'todos';
let refrescandoCapturas = false;

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
        zona: c.seccionCapturada || c.zona || c.producto?.seccion || 'General'
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

async function cargarCapturasDesdeBD({ silencioso = false } = {}) {
    if (refrescandoCapturas) return;
    refrescandoCapturas = true;
    try {
        const respuesta = await apiObtenerCapturas();
        capturas = Array.isArray(respuesta?.data) ? respuesta.data.map(normalizarCaptura) : [];
        sincronizarProductosContados();
        renderizarTabla();
        renderizarListaEmpleado();
    } catch (error) {
        console.error('Error al cargar capturas:', error);
        if (!silencioso) mostrarToast(`No se pudieron cargar las capturas: ${error.message}`, 'error');
    } finally {
        refrescandoCapturas = false;
    }
}

async function cargarDatosIniciales() {
    await Promise.all([cargarProductosDesdeBD(), cargarCapturasDesdeBD({ silencioso: true })]);
    sincronizarProductosContados();
    renderizarListaEmpleado();
    renderizarMapeoAdmin();
    renderizarTabla();
}

function cambiarRol(rol) {
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
    const tabVivo = document.getElementById('tab-vivo');
    const tabMapeo = document.getElementById('tab-mapeo');
    const btnVivo = document.getElementById('tab-btn-vivo');
    const btnMapeo = document.getElementById('tab-btn-mapeo');

    tabVivo?.classList.toggle('hidden', tab !== 'en-vivo');
    tabMapeo?.classList.toggle('hidden', tab !== 'mapeo');

    if (btnVivo) btnVivo.className = tab === 'en-vivo'
        ? 'px-4 py-2 border-b-2 border-amber-500 font-bold text-amber-600 text-sm'
        : 'px-4 py-2 border-b-2 border-transparent font-medium text-gray-500 hover:text-gray-700 text-sm';

    if (btnMapeo) btnMapeo.className = tab === 'mapeo'
        ? 'px-4 py-2 border-b-2 border-amber-500 font-bold text-amber-600 text-sm'
        : 'px-4 py-2 border-b-2 border-transparent font-medium text-gray-500 hover:text-gray-700 text-sm';

    if (tab === 'mapeo') {
        renderizarMapeoAdmin();
        iniciarCamaraAdmin();
    } else {
        detenerCamaraAdmin();
        cargarCapturasDesdeBD({ silencioso: true });
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

async function procesarEscaneoEmpleado(codigo) {
    const codigoLimpio = String(codigo || '').trim();
    const inputCodigo = document.getElementById('codigo-input');
    const inputProd = document.getElementById('producto-input');
    const inputPrecio = document.getElementById('precio-input');
    const inputCant = document.getElementById('cantidad-input');

    if (inputCodigo) inputCodigo.value = codigoLimpio;
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
        if (productoInput) productoInput.value = '';
        if (precioInput) precioInput.value = '';

        renderizarListaEmpleado();
        renderizarTabla();
        mostrarToast(`Conteo registrado: ${cantidad} unidades`);
        codigoInput?.focus();
    } catch (error) {
        console.error(error);
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

    const nombresGrupos = [...grupos.keys()].sort((a, b) => {
        if (a === 'Sin zona asignada') return 1;
        if (b === 'Sin zona asignada') return -1;
        return a.localeCompare(b, 'es');
    });

    const fragment = document.createDocumentFragment();
    nombresGrupos.forEach(nombreGrupo => {
        const productos = grupos.get(nombreGrupo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        const sec = document.createElement('div');
        const icono = orden === 'departamento' ? 'fa-folder' : 'fa-location-dot';
        sec.innerHTML = `<h4 class="font-bold text-xs uppercase bg-slate-100 text-slate-700 px-2 py-1 rounded mb-2"><i class="fa-solid ${icono} me-1"></i>${escaparHtml(nombreGrupo)} <span class="text-[10px] text-gray-400">(${productos.length})</span></h4>`;

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

function renderizarTabla() {
    const tbody = document.getElementById('tabla-capturas');
    if (!tbody) return;

    const visibles = capturas.filter(c => filtroActual === 'todos' || c.estado === filtroActual);

    if (!visibles.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-gray-400 text-sm">No hay capturas para mostrar.</td></tr>';
        return;
    }

    tbody.innerHTML = visibles.map(c => {
        const diff = c.diferencia;
        const diffClase = diff === null ? 'text-gray-400' : diff === 0 ? 'text-emerald-600' : 'text-red-600';
        const estadoCompleto = c.estado === 'completado';
        return `
            <tr class="hover:bg-slate-50">
                <td class="p-3 text-xs whitespace-nowrap">${formatearFecha(c.fechahora)}</td>
                <td class="p-3 font-mono text-xs">${escaparHtml(c.codigo)}</td>
                <td class="p-3 font-semibold">${escaparHtml(c.producto)}</td>
                <td class="p-3 font-bold text-slate-900">${c.fisico}</td>
                <td class="p-3">
                    <input id="sicar-${c.id}" type="number" value="${c.sicar ?? ''}" class="w-20 border rounded p-1.5 text-sm font-bold bg-white focus:ring-2 focus:ring-amber-500 outline-none" />
                </td>
                <td class="p-3 font-bold ${diffClase}">${diff === null ? '--' : (diff > 0 ? `+${diff}` : diff)}</td>
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
    }).join('');
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
    const stockSicar = Number(input?.value);

    if (!Number.isInteger(stockSicar)) {
        mostrarToast('Ingresa un stock SICAR válido', 'error');
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

window.addEventListener('load', async () => {
    const codigoInput = document.getElementById('codigo-input');
    codigoInput?.addEventListener('keydown', async event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            await procesarEscaneoEmpleado(codigoInput.value);
        }
    });

    await cargarDatosIniciales();
    iniciarCamaraEmp();

    // Refresco ligero para que el dashboard reciba capturas hechas desde otro dispositivo.
    setInterval(() => {
        const adminVisible = !document.getElementById('modulo-admin')?.classList.contains('hidden');
        const vivoVisible = !document.getElementById('tab-vivo')?.classList.contains('hidden');
        if (adminVisible && vivoVisible) cargarCapturasDesdeBD({ silencioso: true });
    }, 5000);
});
