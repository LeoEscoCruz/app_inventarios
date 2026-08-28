let zonas = [
    { id: 'z1', nombre: 'Pasillo #1 (Entrada)', productos: ['7501055305339'] },
    { id: 'z2', nombre: 'Refri 1 (Lácteos)', productos: ['7501055377206', '7501055377213'] }
];

let productosDia = [
    { codigo: '7501055377206', nombre: 'Lechita Vainilla 180ml', depto: 'Lácteos', contado: false },
    { codigo: '7501055377213', nombre: 'Lechita Capuccino 180ml', depto: 'Lácteos', contado: false },
    { codigo: '7501055305339', nombre: 'CC Light 600ml 12PK', depto: 'Refrescos', contado: true }
];

let capturas = [
    { id: 1, fechahora: '27/08/2026 15:10', codigo: '7501055305339', producto: 'CC Light 600ml 12PK', fisico: 12, sicar: 5, diferencia: 7, estado: 'completado' },
    { id: 2, fechahora: '27/08/2026 15:25', codigo: '7501055377206', producto: 'Lechita Vainilla 180ml', fisico: 0, sicar: null, diferencia: null, estado: 'pendiente' }
];

let filtroActual = 'todos';