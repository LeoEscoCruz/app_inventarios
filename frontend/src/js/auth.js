const AUTH_TOKEN_KEY = 'laFlor_auth_token';
const AUTH_USER_KEY = 'laFlor_auth_user';
const AUTH_EXPIRES_KEY = 'laFlor_auth_expires';

let authUsuario = null;
let inicializandoAuth = false;

function leerUsuarioSesion() {
    try {
        const raw = sessionStorage.getItem(AUTH_USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function guardarSesionAuth(token, user, expiresAt) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    sessionStorage.setItem(AUTH_EXPIRES_KEY, expiresAt || '');
    authUsuario = user;
}

function actualizarUsuarioSesion(user) {
    authUsuario = user;
    try { sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user)); } catch (_) {}
}

function limpiarSesionAuth() {
    window.detenerEventosInventarioTiempoReal?.();
    try {
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
        sessionStorage.removeItem(AUTH_USER_KEY);
        sessionStorage.removeItem(AUTH_EXPIRES_KEY);
    } catch (_) {}
    authUsuario = null;
}

function obtenerUsuarioActual() {
    return authUsuario || leerUsuarioSesion();
}

function usuarioActualEsAdmin() {
    return obtenerUsuarioActual()?.rol === 'ADMIN';
}

function mostrarPantallaLogin(mensaje = '') {
    document.getElementById('pantalla-login')?.classList.remove('hidden');
    document.getElementById('app-nav')?.classList.add('hidden');
    document.getElementById('app-main')?.classList.add('hidden');
    document.getElementById('modal-cambio-password')?.classList.add('hidden');

    const msg = document.getElementById('login-mensaje');
    if (msg) {
        msg.textContent = mensaje;
        msg.classList.toggle('hidden', !mensaje);
    }

    setTimeout(() => document.getElementById('login-usuario')?.focus(), 50);
}

function actualizarCabeceraUsuario() {
    const user = obtenerUsuarioActual();
    if (!user) return;

    const nombre = document.getElementById('usuario-nombre-nav');
    const rol = document.getElementById('usuario-rol-nav');
    if (nombre) nombre.textContent = user.nombre || user.username || 'Usuario';
    if (rol) rol.textContent = user.rol === 'ADMIN' ? 'Administrador' : 'Empleado';

    const btnAdmin = document.getElementById('btn-admin');
    if (btnAdmin) btnAdmin.classList.toggle('hidden', user.rol !== 'ADMIN');
}

async function mostrarAplicacionAutenticada() {
    const user = obtenerUsuarioActual();
    if (!user) return mostrarPantallaLogin();

    document.getElementById('pantalla-login')?.classList.add('hidden');
    document.getElementById('app-nav')?.classList.remove('hidden');
    document.getElementById('app-main')?.classList.remove('hidden');
    actualizarCabeceraUsuario();

    await window.inicializarAplicacionProtegida?.();

    if (user.rol === 'ADMIN') {
        cambiarRol('admin');
    } else {
        cambiarRol('operativo');
    }
}

function mostrarCambioPasswordObligatorio() {
    document.getElementById('modal-cambio-password')?.classList.remove('hidden');
    document.getElementById('cambio-password-error')?.classList.add('hidden');
    setTimeout(() => document.getElementById('password-actual')?.focus(), 50);
}

window.mostrarCambioPasswordObligatorio = mostrarCambioPasswordObligatorio;

window.manejarSesionInvalida = function manejarSesionInvalida(error) {
    limpiarSesionAuth();
    window.detenerCamaraEmp?.();
    window.detenerCamaraAdmin?.();
    mostrarPantallaLogin(error?.message || 'Tu sesión terminó. Inicia sesión nuevamente.');
};

async function procesarLogin(event) {
    event.preventDefault();
    if (inicializandoAuth) return;

    const inputUsuario = document.getElementById('login-usuario');
    const inputPassword = document.getElementById('login-password');
    const btn = document.getElementById('btn-login');
    const msg = document.getElementById('login-mensaje');
    const username = String(inputUsuario?.value || '').trim();
    const password = String(inputPassword?.value || '');

    if (!username || !password) return;

    inicializandoAuth = true;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Iniciando...';
    }
    msg?.classList.add('hidden');

    try {
        const respuesta = await apiLogin(username, password);
        guardarSesionAuth(respuesta.token, respuesta.user, respuesta.expiresAt);
        if (inputPassword) inputPassword.value = '';

        if (respuesta.user?.debeCambiarPassword) {
            document.getElementById('pantalla-login')?.classList.add('hidden');
            document.getElementById('app-nav')?.classList.add('hidden');
            document.getElementById('app-main')?.classList.add('hidden');
            mostrarCambioPasswordObligatorio();
        } else {
            await mostrarAplicacionAutenticada();
        }
    } catch (error) {
        if (msg) {
            msg.textContent = error.message || 'No fue posible iniciar sesión';
            msg.classList.remove('hidden');
        }
    } finally {
        inicializandoAuth = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Iniciar sesión';
        }
    }
}

async function procesarCambioPassword(event) {
    event.preventDefault();
    const actual = String(document.getElementById('password-actual')?.value || '');
    const nueva = String(document.getElementById('password-nueva')?.value || '');
    const confirmar = String(document.getElementById('password-confirmar')?.value || '');
    const errorBox = document.getElementById('cambio-password-error');
    const btn = document.getElementById('btn-cambiar-password');

    const mostrarError = texto => {
        if (!errorBox) return;
        errorBox.textContent = texto;
        errorBox.classList.remove('hidden');
    };

    if (nueva.length < 10 || nueva.length > 128) {
        return mostrarError('La nueva contraseña debe tener entre 10 y 128 caracteres.');
    }
    if (nueva !== confirmar) return mostrarError('Las contraseñas nuevas no coinciden.');
    if (actual === nueva) return mostrarError('La nueva contraseña debe ser diferente a la actual.');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
    }
    errorBox?.classList.add('hidden');

    try {
        await apiCambiarPassword(actual, nueva);
        const me = await apiMe();
        actualizarUsuarioSesion(me.user);

        ['password-actual', 'password-nueva', 'password-confirmar'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('modal-cambio-password')?.classList.add('hidden');
        await mostrarAplicacionAutenticada();
        window.mostrarToast?.('Contraseña actualizada correctamente');
    } catch (error) {
        mostrarError(error.message || 'No fue posible cambiar la contraseña.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-key"></i> Guardar nueva contraseña';
        }
    }
}

async function cerrarSesion() {
    window.detenerEventosInventarioTiempoReal?.();
    try {
        await apiLogout();
    } catch (_) {
        // Aunque el servidor ya considere inválida la sesión, limpiamos el estado local.
    }
    limpiarSesionAuth();
    window.detenerCamaraEmp?.();
    window.detenerCamaraAdmin?.();
    if (typeof productosDia !== 'undefined') productosDia = [];
    if (typeof capturas !== 'undefined') capturas = [];
    mostrarPantallaLogin('Sesión cerrada correctamente.');
}

async function inicializarAutenticacion() {
    authUsuario = leerUsuarioSesion();
    const token = sessionStorage.getItem(AUTH_TOKEN_KEY);

    if (!token) {
        mostrarPantallaLogin();
        return;
    }

    try {
        const respuesta = await apiMe();
        actualizarUsuarioSesion(respuesta.user);
        if (respuesta.user?.debeCambiarPassword) {
            document.getElementById('pantalla-login')?.classList.add('hidden');
            mostrarCambioPasswordObligatorio();
        } else {
            await mostrarAplicacionAutenticada();
        }
    } catch (error) {
        limpiarSesionAuth();
        mostrarPantallaLogin(error?.message || 'La sesión expiró.');
    }
}
