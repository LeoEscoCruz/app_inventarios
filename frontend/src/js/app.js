function cambiarRol(rol) {
    document.getElementById('modulo-operativo').classList.toggle('hidden', rol !== 'operativo');
    document.getElementById('modulo-admin').classList.toggle('hidden', rol !== 'admin');
    document.getElementById('btn-operativo').className = rol === 'operativo' ? "px-4 py-1.5 rounded-md text-sm font-bold bg-amber-500 text-slate-900" : "px-4 py-1.5 rounded-md text-sm font-medium text-gray-300 hover:text-white";
    document.getElementById('btn-admin').className = rol === 'admin' ? "px-4 py-1.5 rounded-md text-sm font-bold bg-amber-500 text-slate-900" : "px-4 py-1.5 rounded-md text-sm font-medium text-gray-300 hover:text-white";
    
    if (rol === 'operativo') {
        renderizarListaEmpleado();
        iniciarCamaraEmp();
    } else {
        detenerCamaraEmp();
    }
}

function cambiarSubTabEmp(tab) {
    document.getElementById('pantalla-escaner').classList.toggle('hidden', tab !== 'escaner');
    document.getElementById('pantalla-lista').classList.toggle('hidden', tab !== 'lista');
    document.getElementById('subtab-escaner').className = tab === 'escaner' ? "w-1/2 py-3 border-b-2 border-amber-500 text-amber-600 bg-white" : "w-1/2 py-3 border-b-2 border-transparent text-gray-500";
    document.getElementById('subtab-lista').className = tab === 'lista' ? "w-1/2 py-3 border-b-2 border-amber-500 text-amber-600 bg-white" : "w-1/2 py-3 border-b-2 border-transparent text-gray-500";
    
    if (tab === 'escaner') {
        iniciarCamaraEmp();
    } else {
        detenerCamaraEmp();
        renderizarListaEmpleado();
    }
}

function cambiarTabAdmin(tab) {
    document.getElementById('tab-vivo').classList.toggle('hidden', tab !== 'en-vivo');
    document.getElementById('tab-mapeo').classList.toggle('hidden', tab !== 'mapeo');
    document.getElementById('tab-btn-vivo').className = tab === 'en-vivo' ? "px-4 py-2 border-b-2 border-amber-500 font-bold text-amber-600 text-sm" : "px-4 py-2 border-b-2 border-transparent text-gray-500 text-sm";
    document.getElementById('tab-btn-mapeo').className = tab === 'mapeo' ? "px-4 py-2 border-b-2 border-amber-500 font-bold text-amber-600 text-sm" : "px-4 py-2 border-b-2 border-transparent text-gray-500 text-sm";
    
    if(tab === 'mapeo') {
        renderizarMapeoAdmin();
        iniciarCamaraAdmin();
    } else {
        detenerCamaraAdmin();
    }
}

function procesarCodigoMapeo(codigo) {
    const codigoLimpio = codigo.trim();
    const inputNombre = document.getElementById('input-nombre-zona');
    const alerta = document.getElementById('alerta-no-registrado');
    const btnAsignar = document.getElementById('btn-asignar-zona');

    if (!codigoLimpio) {
        inputNombre.value = "--";
        alerta.classList.add('hidden');
        btnAsignar.disabled = false;
        return;
    }

    const prodEncontrado = productosDia.find(p => p.codigo === codigoLimpio);

    if (prodEncontrado) {
        inputNombre.value = prodEncontrado.nombre;
        alerta.classList.add('hidden');
        btnAsignar.disabled = false;
    } else {
        inputNombre.value = "⚠️ Producto no registrado";
        alerta.classList.remove('hidden');
        btnAsignar.disabled = true;
    }
}

function simularEscaneoMapeo(codigo) {
    document.getElementById('input-codigo-zona').value = codigo;
    procesarCodigoMapeo(codigo);
    mostrarToast("Código simulado: " + codigo);
}

function abrirModalAlta() {
    const cod = document.getElementById('input-codigo-zona').value.trim();
    document.getElementById('modal-codigo').value = cod;
    document.getElementById('modal-nombre').value = "";
    document.getElementById('modal-alta-producto').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-nombre').focus(), 100);
}

function cerrarModalAlta() {
    document.getElementById('modal-alta-producto').classList.add('hidden');
}

function guardarNuevoProducto(e) {
    e.preventDefault();
    const cod = document.getElementById('modal-codigo').value;
    const nom = document.getElementById('modal-nombre').value.trim();
    const dep = document.getElementById('modal-depto').value;

    if(!cod || !nom) return;

    productosDia.push({
        codigo: cod,
        nombre: nom,
        depto: dep,
        contado: false
    });

    cerrarModalAlta();
    procesarCodigoMapeo(cod);
    mostrarToast(`Producto "${nom}" registrado`);
}

function crearNuevaZona(e) {
    if(e) e.preventDefault();
    const nom = document.getElementById('input-nueva-zona').value.trim();
    if(!nom) return;
    zonas.push({ id: 'z' + Date.now(), nombre: nom, productos: [] });
    document.getElementById('input-nueva-zona').value = "";
    renderizarMapeoAdmin();
    mostrarToast(`Zona "${nom}" creada`);
}

function asignarProductoAZona(e) {
    if(e) e.preventDefault();
    const zonaId = document.getElementById('select-zona-activa').value;
    const codigo = document.getElementById('input-codigo-zona').value.trim();
    if(!zonaId || !codigo) return;

    const zona = zonas.find(z => z.id === zonaId);
    if(zona && !zona.productos.includes(codigo)) {
        zona.productos.push(codigo);
        document.getElementById('input-codigo-zona').value = "";
        document.getElementById('input-nombre-zona').value = "--";
        renderizarMapeoAdmin();
        mostrarToast(`Producto asignado a ${zona.nombre}`);
    }
}

function renderizarMapeoAdmin() {
    const sel = document.getElementById('select-zona-activa');
    const cont = document.getElementById('contenedor-zonas-admin');
    sel.innerHTML = "";
    cont.innerHTML = "";

    zonas.forEach(z => {
        const opt = document.createElement('option');
        opt.value = z.id;
        opt.innerText = z.nombre;
        sel.appendChild(opt);

        const card = document.createElement('div');
        card.className = "border rounded-lg p-3 bg-gray-50 space-y-2";
        
        let prodsHTML = z.productos.map(cod => {
            const p = productosDia.find(x => x.codigo === cod);
            return `<div class="text-xs bg-white p-1.5 border rounded flex justify-between">
                <span class="font-bold">${p ? p.nombre : 'Producto Registrado'}</span>
                <span class="font-mono text-gray-400">${cod}</span>
            </div>`;
        }).join('');

        card.innerHTML = `
            <div class="flex justify-between items-center border-b pb-1 font-bold text-xs text-slate-800">
                <span><i class="fa-solid fa-location-dot me-1 text-amber-500"></i> ${z.nombre}</span>
                <span class="bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-[10px]">${z.productos.length} items</span>
            </div>
            <div class="space-y-1">${prodsHTML || '<span class="text-xs text-gray-400 italic">Sin productos asignados</span>'}</div>
        `;
        cont.appendChild(card);
    });
}

function renderizarListaEmpleado() {
    const modo = document.getElementById('select-orden-emp').value;
    const cont = document.getElementById('contenedor-lista-diaria');
    cont.innerHTML = "";

    if (modo === 'barrida') {
        zonas.forEach(z => {
            const sec = document.createElement('div');
            sec.innerHTML = `<h4 class="font-bold text-xs uppercase bg-slate-900 text-amber-400 px-2.5 py-1.5 rounded-lg mb-2 flex items-center justify-between font-mono">
                <span><i class="fa-solid fa-map-pin me-1"></i> ${z.nombre}</span>
            </h4>`;
            const sublist = document.createElement('div');
            sublist.className = "space-y-1.5 pl-1 mb-4";

            z.productos.forEach(cod => {
                const prod = productosDia.find(p => p.codigo === cod) || { codigo: cod, nombre: 'Producto', contado: false };
                sublist.appendChild(crearItemProducto(prod));
            });
            sec.appendChild(sublist);
            cont.appendChild(sec);
        });
    } else {
        const deptos = [...new Set(productosDia.map(p => p.depto))];
        deptos.forEach(d => {
            const sec = document.createElement('div');
            sec.innerHTML = `<h4 class="font-bold text-xs uppercase bg-slate-100 text-slate-700 px-2 py-1 rounded mb-2"><i class="fa-solid fa-folder me-1"></i>${d}</h4>`;
            const sublist = document.createElement('div');
            sublist.className = "space-y-1.5 pl-1 mb-3";
            
            productosDia.filter(p => p.depto === d).forEach(prod => {
                sublist.appendChild(crearItemProducto(prod));
            });
            sec.appendChild(sublist);
            cont.appendChild(sec);
        });
    }
}

function crearItemProducto(prod) {
    const div = document.createElement('div');
    div.className = `p-2.5 rounded-lg border text-xs flex justify-between items-center ${prod.contado ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-white border-gray-200'}`;
    div.innerHTML = `
        <div>
            <div class="font-bold">${prod.nombre}</div>
            <div class="text-[10px] text-gray-400 font-mono">${prod.codigo}</div>
        </div>
        ${prod.contado ? '<span class="text-emerald-600 font-bold text-[10px]"><i class="fa-solid fa-circle-check"></i> Contado</span>' : '<span class="text-gray-400 text-[10px]">Pendiente</span>'}
    `;
    return div;
}

function simularEscaneo(codigo, nombre) {
    document.getElementById('codigo-input').value = codigo;
    document.getElementById('producto-input').value = nombre;
    document.getElementById('cantidad-input').focus();
    mostrarToast("Lectura: " + codigo);
}

function registrarConteo(e) {
    e.preventDefault();
    const codigo = document.getElementById('codigo-input').value;
    const producto = document.getElementById('producto-input').value || 'Producto Desconocido';
    const cantidad = parseInt(document.getElementById('cantidad-input').value);

    const p = productosDia.find(x => x.codigo === codigo);
    if(p) p.contado = true;

    const ahora = new Date();
    const fechaHoraStr = `${ahora.toLocaleDateString()} ${ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    capturas.unshift({
        id: Date.now(),
        fechahora: fechaHoraStr,
        codigo: codigo,
        producto: producto,
        fisico: cantidad,
        sicar: null,
        diferencia: null,
        estado: 'pendiente'
    });

    document.getElementById('codigo-input').value = "";
    document.getElementById('producto-input').value = "";
    document.getElementById('cantidad-input').value = "";

    mostrarToast("Conteo enviado a administración");
    renderizarTabla();
}

function filtrarTabla(estado) {
    filtroActual = estado;
    ['todos', 'pendiente', 'completado'].forEach(e => {
        const btn = document.getElementById(`filtro-${e}`);
        if(e === estado) {
            btn.className = "px-3 py-1 rounded-md bg-white shadow text-slate-800 font-bold";
        } else {
            btn.className = "px-3 py-1 rounded-md text-gray-500 hover:text-slate-800";
        }
    });
    renderizarTabla();
}

function renderizarTabla() {
    const tbody = document.getElementById('tabla-capturas');
    tbody.innerHTML = "";

    let lista = [...capturas].sort((a, b) => {
        if (a.estado === 'pendiente' && b.estado === 'completado') return -1;
        if (a.estado === 'completado' && b.estado === 'pendiente') return 1;
        return b.id - a.id;
    });

    if (filtroActual !== 'todos') {
        lista = lista.filter(x => x.estado === filtroActual);
    }

    lista.forEach(c => {
        const tr = document.createElement('tr');
        tr.className = c.estado === 'completado' ? 'bg-gray-50/60' : 'bg-white';
        tr.innerHTML = `
            <td class="p-3 text-xs text-gray-500 whitespace-nowrap">${c.fechahora}</td>
            <td class="p-3 font-mono text-xs font-bold text-slate-700">${c.codigo}</td>
            <td class="p-3 font-semibold text-slate-900">${c.producto}</td>
            <td class="p-3 font-bold text-slate-900">${c.fisico} pzs</td>
            <td class="p-3">
                <input type="number" value="${c.sicar !== null ? c.sicar : ''}" oninput="calcularDiferencia(${c.id}, this.value)" placeholder="Stock SICAR" class="w-24 p-1 border rounded text-xs transition ${c.estado === 'completado' ? 'bg-gray-100 text-gray-500 border-gray-200' : 'bg-white border-gray-300 focus:ring-2 focus:ring-amber-500 outline-none'}" ${c.estado === 'completado' ? 'disabled' : ''}>
            </td>
            <td class="p-3">
                <span id="dif-${c.id}" class="font-bold ${c.diferencia === 0 ? 'text-emerald-600' : 'text-red-600'}">
                    ${c.diferencia !== null ? c.diferencia : '--'}
                </span>
            </td>
            <td class="p-3">
                ${c.estado === 'pendiente' ? 
                    '<span class="text-xs px-2 py-1 rounded bg-amber-100 text-amber-800 font-bold"><i class="fa-solid fa-clock me-1"></i>Pendiente</span>' : 
                    '<span class="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800 font-bold"><i class="fa-solid fa-check me-1"></i>Completado</span>'}
            </td>
            <td class="p-3 text-center">
                ${c.estado === 'pendiente' ? 
                    `<button onclick="completarAjuste(${c.id})" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-2.5 py-1 rounded shadow transition">
                        <i class="fa-solid fa-check me-1"></i> Completar
                    </button>` : 
                    `<button onclick="editarAjuste(${c.id})" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs px-2.5 py-1 rounded transition border border-slate-300">
                        <i class="fa-solid fa-pen-to-square me-1"></i> Editar
                    </button>`}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function calcularDiferencia(id, val) {
    const c = capturas.find(x => x.id === id);
    if(c) {
        if(val !== "") {
            c.sicar = parseInt(val);
            c.diferencia = c.fisico - c.sicar;
        } else {
            c.sicar = null;
            c.diferencia = null;
        }
        const elem = document.getElementById(`dif-${id}`);
        if(elem) {
            elem.innerText = c.diferencia !== null ? c.diferencia : '--';
            elem.className = `font-bold ${c.diferencia === 0 ? 'text-emerald-600' : 'text-red-600'}`;
        }
    }
}

function completarAjuste(id) {
    const c = capturas.find(x => x.id === id);
    if(c) {
        if(c.sicar === null) {
            mostrarToast("Ingresa la cantidad de SICAR primero");
            return;
        }
        c.estado = 'completado';
        mostrarToast(`Ajuste de ${c.producto} completado`);
        renderizarTabla();
    }
}

function editarAjuste(id) {
    const c = capturas.find(x => x.id === id);
    if(c) {
        c.estado = 'pendiente';
        mostrarToast(`Modo edición activado para ${c.producto}`);
        renderizarTabla();
    }
}

function mostrarToast(msg) {
    const t = document.getElementById('toast');
    document.getElementById('toast-msg').innerText = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 2500);
}

window.addEventListener('load', () => {
    renderizarTabla();
    iniciarCamaraEmp();
});