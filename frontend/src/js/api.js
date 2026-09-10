// En local la API puede servirse desde el mismo Express (puerto 3000).
// En producción el frontend está en Vercel y la API en Render.
// window.APP_API_BASE_URL permite sobrescribir la URL sin editar este archivo.
const API_BASE_URL = window.APP_API_BASE_URL || (() => {
    const host = window.location.hostname;
    const port = window.location.port;
    const local = host === 'localhost' || host === '127.0.0.1';

    if (window.location.protocol === 'file:') return 'http://localhost:3000/api';
    if (local && port && port !== '3000') return 'http://localhost:3000/api';
    if (local) return '/api';
    return 'https://app-inventarios.onrender.com/api';
})();

class ApiError extends Error {
    constructor(message, { status = 0, code = null, body = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.body = body;
    }
}

function obtenerTokenParaApi() {
    try {
        return sessionStorage.getItem('laFlor_auth_token') || '';
    } catch (_) {
        return '';
    }
}

async function apiRequest(ruta, opciones = {}) {
    const token = opciones.omitirAuth ? '' : obtenerTokenParaApi();
    const headers = {
        ...(opciones.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opciones.headers || {})
    };

    const config = {
        ...opciones,
        headers
    };
    delete config.omitirAuth;

    let response;
    try {
        response = await fetch(`${API_BASE_URL}${ruta}`, config);
    } catch (error) {
        throw new ApiError('No fue posible conectar con el servidor', { body: error });
    }

    let body = null;
    try {
        body = await response.json();
    } catch (_) {
        body = null;
    }

    if (!response.ok) {
        const mensaje = body?.message || body?.error || `Error HTTP ${response.status}`;
        const error = new ApiError(mensaje, {
            status: response.status,
            code: body?.code || null,
            body
        });

        if (['AUTH_REQUIRED', 'SESSION_INVALID', 'USER_DISABLED'].includes(error.code)) {
            window.manejarSesionInvalida?.(error);
        } else if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
            window.mostrarCambioPasswordObligatorio?.();
        }

        throw error;
    }

    return body;
}

// ---------------- AUTENTICACIÓN ----------------
function apiLogin(username, password) {
    return apiRequest('/auth/login', {
        method: 'POST',
        omitirAuth: true,
        body: JSON.stringify({ username, password })
    });
}

function apiMe() {
    return apiRequest('/auth/me');
}

function apiLogout() {
    return apiRequest('/auth/logout', { method: 'POST' });
}

function apiCambiarPassword(currentPassword, newPassword) {
    return apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
    });
}

// ---------------- PRODUCTOS ----------------
function apiObtenerProductos() {
    return apiRequest('/productos');
}

function apiBuscarProducto(codigo) {
    return apiRequest(`/productos/${encodeURIComponent(String(codigo).trim())}`);
}

function apiCrearProducto(datos) {
    return apiRequest('/productos', {
        method: 'POST',
        body: JSON.stringify(datos)
    });
}

function apiActualizarProducto(codigo, datos) {
    return apiRequest(`/productos/${encodeURIComponent(String(codigo).trim())}`, {
        method: 'PATCH',
        body: JSON.stringify(datos)
    });
}

// ---------------- CAPTURAS ----------------
function apiObtenerCapturas() {
    return apiRequest('/capturas');
}

function apiObtenerMisCapturas() {
    return apiRequest('/capturas/mias');
}

function apiObtenerProgresoInventario() {
    return apiRequest('/capturas/progreso');
}

function apiRegistrarCaptura(datos) {
    return apiRequest('/capturas', {
        method: 'POST',
        body: JSON.stringify(datos)
    });
}

function apiActualizarCaptura(id, datos) {
    return apiRequest(`/capturas/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(datos)
    });
}


// ---------------- SESIONES DE INVENTARIO ----------------
function apiObtenerSesionActiva() {
    return apiRequest('/sesiones/activa');
}

function apiIniciarNuevaSesion(nombre = '') {
    return apiRequest('/sesiones/nueva', {
        method: 'POST',
        body: JSON.stringify({ nombre })
    });
}

function apiFinalizarSesionInventario(forzar = false) {
    return apiRequest('/sesiones/activa/finalizar', {
        method: 'POST',
        body: JSON.stringify({ forzar })
    });
}

function apiObtenerHistorialInventarios() {
    return apiRequest('/sesiones/historial');
}

function apiObtenerDetalleInventario(id) {
    return apiRequest(`/sesiones/${encodeURIComponent(id)}`);
}

// ---------------- USUARIOS (ADMIN) ----------------
function apiObtenerUsuarios() {
    return apiRequest('/usuarios');
}

function apiCrearUsuario(datos) {
    return apiRequest('/usuarios', {
        method: 'POST',
        body: JSON.stringify(datos)
    });
}

function apiCambiarEstadoUsuario(id, activo) {
    return apiRequest(`/usuarios/${encodeURIComponent(id)}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ activo })
    });
}

function apiResetPasswordUsuario(id) {
    return apiRequest(`/usuarios/${encodeURIComponent(id)}/reset-password`, {
        method: 'POST'
    });
}

// ---------------- EVENTOS EN TIEMPO REAL (SSE SOBRE FETCH) ----------------
// Se usa fetch en lugar de EventSource para poder enviar el Bearer token en Authorization.
async function apiEscucharEventosInventario({ signal, onEvento } = {}) {
    const token = obtenerTokenParaApi();
    if (!token) throw new ApiError('No hay una sesión activa', { code: 'AUTH_REQUIRED' });

    let response;
    try {
        response = await fetch(`${API_BASE_URL}/eventos/inventario`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'text/event-stream'
            },
            cache: 'no-store',
            signal
        });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new ApiError('No fue posible abrir el canal de actualizaciones', { body: error });
    }

    if (!response.ok) {
        let body = null;
        try { body = await response.json(); } catch (_) {}
        const error = new ApiError(body?.message || `Error HTTP ${response.status}`, {
            status: response.status,
            code: body?.code || null,
            body
        });
        if (['AUTH_REQUIRED', 'SESSION_INVALID', 'USER_DISABLED'].includes(error.code)) {
            window.manejarSesionInvalida?.(error);
        } else if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
            window.mostrarCambioPasswordObligatorio?.();
        }
        throw error;
    }

    if (!response.body) {
        throw new ApiError('El navegador no soporta el canal de actualizaciones en tiempo real');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');

        let indice;
        while ((indice = buffer.indexOf('\n\n')) >= 0) {
            const bloque = buffer.slice(0, indice);
            buffer = buffer.slice(indice + 2);

            const lineasData = bloque
                .split('\n')
                .filter(linea => linea.startsWith('data:'))
                .map(linea => linea.slice(5).trim());

            if (!lineasData.length) continue;

            try {
                const evento = JSON.parse(lineasData.join('\n'));
                onEvento?.(evento);
            } catch (error) {
                console.warn('Evento de inventario inválido:', error);
            }
        }
    }
}
