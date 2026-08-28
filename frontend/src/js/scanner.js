let html5QrCodeEmp = null;
let html5QrCodeAdmin = null;

function iniciarCamaraEmp() {
    detenerCamaraAdmin();
    if (html5QrCodeEmp && html5QrCodeEmp.isScanning) {
        html5QrCodeEmp.stop().then(() => activarLectorEmp()).catch(err => console.error(err));
    } else {
        activarLectorEmp();
    }
}

function activarLectorEmp() {
    html5QrCodeEmp = new Html5Qrcode("reader-emp");
    const config = { fps: 10, qrbox: { width: 250, height: 120 } };

    html5QrCodeEmp.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
            document.getElementById('codigo-input').value = decodedText;
            const prod = productosDia.find(p => p.codigo === decodedText);
            document.getElementById('producto-input').value = prod ? prod.nombre : 'Producto Detectado';
            document.getElementById('cantidad-input').focus();
            mostrarToast("Código leído: " + decodedText);
        },
        (err) => {}
    ).catch(err => console.warn("Camara emp error:", err));
}

function detenerCamaraEmp() {
    if (html5QrCodeEmp && html5QrCodeEmp.isScanning) {
        html5QrCodeEmp.stop().catch(err => console.error(err));
    }
}

function iniciarCamaraAdmin() {
    detenerCamaraEmp();
    if (html5QrCodeAdmin && html5QrCodeAdmin.isScanning) {
        html5QrCodeAdmin.stop().then(() => activarLectorAdmin()).catch(err => console.error(err));
    } else {
        activarLectorAdmin();
    }
}

function activarLectorAdmin() {
    html5QrCodeAdmin = new Html5Qrcode("reader-admin");
    const config = { fps: 10, qrbox: { width: 220, height: 100 } };

    html5QrCodeAdmin.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
            document.getElementById('input-codigo-zona').value = decodedText;
            procesarCodigoMapeo(decodedText);
            mostrarToast("Código escaneado: " + decodedText);
        },
        (err) => {}
    ).catch(err => console.warn("Camara admin error:", err));
}

function detenerCamaraAdmin() {
    if (html5QrCodeAdmin && html5QrCodeAdmin.isScanning) {
        html5QrCodeAdmin.stop().catch(err => console.error(err));
    }
}