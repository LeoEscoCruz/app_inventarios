// En local la API vive en el mismo Express; en producción el frontend está en Vercel y la API en Render.
// window.APP_API_BASE_URL permite sobrescribir la URL sin volver a editar este archivo.
const API_BASE_URL = window.APP_API_BASE_URL || (
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? '/api'
        : 'https://app-inventarios.onrender.com/api'
);

async function apiRequest(ruta, opciones = {}) {
    const config = {
        ...opciones,
        headers: {
            'Content-Type': 'application/json',
            ...(opciones.headers || {})
        }
    };

    const response = await fetch(`${API_BASE_URL}${ruta}`, config);
    let body = null;

    try {
        body = await response.json();
    } catch (_) {
        body = null;
    }

    if (!response.ok) {
        const mensaje = body?.message || body?.error || `Error HTTP ${response.status}`;
        throw new Error(mensaje);
    }

    return body;
}

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

function apiObtenerCapturas() {
    return apiRequest('/capturas');
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
