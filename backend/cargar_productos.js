const xlsx = require('xlsx');
const prisma = require('./config/db');

async function cargarDesdeExcel() {
  try {
    const workbook = xlsx.readFile('./productos.xlsx');
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    console.log(`📦 Se encontraron ${data.length} productos en el Excel. Preparando carga ultrarrápida...`);

    const productosParaInsertar = [];
    const codigosVistos = new Set();

    for (const fila of data) {
      const llaves = Object.keys(fila);
      const keyCodigo = llaves.find(k => k.trim().toLowerCase() === 'clave' || k.trim().toLowerCase() === 'codigo');
      const keyNombre = llaves.find(k => k.trim().toLowerCase() === 'descripcion' || k.trim().toLowerCase() === 'nombre');
      const keyStock = llaves.find(k => k.trim().toLowerCase() === 'existencia' || k.trim().toLowerCase() === 'stock');
      const keyPrecio = llaves.find(k => k.trim().toLowerCase() === 'precio');

      const codigo = keyCodigo ? String(fila[keyCodigo]).trim() : '';
      const nombre = keyNombre ? String(fila[keyNombre]).trim() : '';
      const stock = keyStock ? parseInt(fila[keyStock] || 0, 10) : 0;
      
      const rawPrecio = keyPrecio ? String(fila[keyPrecio]) : '0';
      const precioLimpio = rawPrecio.replace(/[^0-9.-]+/g, '');
      const precio = parseFloat(precioLimpio) || 0.0;

      if (!codigo || !nombre || codigosVistos.has(codigo)) continue;
      codigosVistos.add(codigo);

      productosParaInsertar.push({
        codigo,
        nombre,
        precio,
        stock
      });
    }

    console.log(`🚀 Insertando ${productosParaInsertar.length} productos en lote a Supabase...`);

    // Inserción masiva ignorando duplicados si ya existen
    const resultado = await prisma.producto.createMany({
      data: productosParaInsertar,
      skipDuplicates: true
    });

    console.log(`✅ ¡Éxito instantáneo! Se registraron ${resultado.count} productos nuevos en Supabase.`);
  } catch (error) {
    console.error('❌ Error al procesar el archivo Excel:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

cargarDesdeExcel();