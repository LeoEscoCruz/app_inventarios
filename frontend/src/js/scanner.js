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
        async (decodedText) => { // Agregamos 'async' aquí para poder consultar la base de datos
            document.getElementById('codigo-input').value = decodedText;
            
            // Reemplazamos la búsqueda local por la consulta al servidor
            await buscarProducto(decodedText);
            
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

// Nueva función independiente al final del archivo
async function buscarProducto(codigoEscaneado) {
    try {
        // Usamos la API_BASE_URL que declaraste en tu clase api
        const response = await fetch(`${API_BASE_URL}/productos/${codigoEscaneado}`);
        
        if (!response.ok) {
            document.getElementById('producto-input').value = 'Producto no registrado';
            return;
        }

        const producto = await response.json();
        
        // Actualiza el input con el nombre que viene de la base de datos
        document.getElementById('producto-input').value = producto.nombre;
        
    } catch (error) {
        console.error('Error al consultar el producto:', error);
        document.getElementById('producto-input').value = 'Error de red';
    }
}