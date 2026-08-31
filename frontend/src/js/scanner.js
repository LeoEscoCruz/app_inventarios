let html5QrCodeEmp = null;
let html5QrCodeAdmin = null;
let ultimoCodigoEmp = '';
let ultimoCodigoAdmin = '';
let ultimaLecturaEmp = 0;
let ultimaLecturaAdmin = 0;

function lecturaRepetida(codigo, tipo) {
    const ahora = Date.now();
    if (tipo === 'emp') {
        const repetida = codigo === ultimoCodigoEmp && ahora - ultimaLecturaEmp < 1800;
        ultimoCodigoEmp = codigo;
        ultimaLecturaEmp = ahora;
        return repetida;
    }

    const repetida = codigo === ultimoCodigoAdmin && ahora - ultimaLecturaAdmin < 1800;
    ultimoCodigoAdmin = codigo;
    ultimaLecturaAdmin = ahora;
    return repetida;
}

async function iniciarCamaraEmp() {
    await detenerCamaraAdmin();
    if (typeof Html5Qrcode === 'undefined' || !document.getElementById('reader-emp')) return;
    await detenerCamaraEmp();
    activarLectorEmp();
}

function activarLectorEmp() {
    if (html5QrCodeEmp?.isScanning) return;

    if (!html5QrCodeEmp) html5QrCodeEmp = new Html5Qrcode('reader-emp');
    const config = { fps: 10, qrbox: { width: 250, height: 120 } };

    html5QrCodeEmp.start(
        { facingMode: 'environment' },
        config,
        async (decodedText) => {
            const codigo = String(decodedText).trim();
            if (!codigo || lecturaRepetida(codigo, 'emp')) return;
            if (typeof procesarEscaneoEmpleado === 'function') {
                await procesarEscaneoEmpleado(codigo);
            }
        },
        () => {}
    ).catch(err => console.warn('Cámara empleado no disponible:', err));
}

async function detenerCamaraEmp() {
    if (html5QrCodeEmp?.isScanning) {
        try { await html5QrCodeEmp.stop(); } catch (err) { console.warn(err); }
    }
}

async function iniciarCamaraAdmin() {
    await detenerCamaraEmp();
    if (typeof Html5Qrcode === 'undefined' || !document.getElementById('reader-admin')) return;
    await detenerCamaraAdmin();
    activarLectorAdmin();
}

function activarLectorAdmin() {
    if (html5QrCodeAdmin?.isScanning) return;

    if (!html5QrCodeAdmin) html5QrCodeAdmin = new Html5Qrcode('reader-admin');
    const config = { fps: 10, qrbox: { width: 220, height: 100 } };

    html5QrCodeAdmin.start(
        { facingMode: 'environment' },
        config,
        async (decodedText) => {
            const codigo = String(decodedText).trim();
            if (!codigo || lecturaRepetida(codigo, 'admin')) return;
            if (typeof procesarEscaneoMapeo === 'function') {
                await procesarEscaneoMapeo(codigo);
            }
        },
        () => {}
    ).catch(err => console.warn('Cámara administrador no disponible:', err));
}

async function detenerCamaraAdmin() {
    if (html5QrCodeAdmin?.isScanning) {
        try { await html5QrCodeAdmin.stop(); } catch (err) { console.warn(err); }
    }
}
