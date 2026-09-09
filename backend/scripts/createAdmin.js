const prisma = require('../config/db');
const {
  normalizarUsername,
  validarUsername,
  generarPasswordTemporal,
  hashPassword
} = require('../utils/security');

async function main() {
  const username = normalizarUsername(process.argv[2]);
  const nombre = String(process.argv[3] || 'Administrador').trim();
  const email = process.argv[4] ? normalizarUsername(process.argv[4]) : null;

  if (!validarUsername(username)) {
    console.error('Uso: npm run security:create-admin -- <username> "Nombre del administrador" [correo-opcional]');
    process.exitCode = 1;
    return;
  }

  const existe = await prisma.usuario.findFirst({
    where: { OR: [{ username }, ...(email ? [{ email }] : [])] }
  });

  if (existe) {
    console.error('Ya existe un usuario con ese username o correo.');
    process.exitCode = 1;
    return;
  }

  const passwordTemporal = generarPasswordTemporal();
  const passwordHash = await hashPassword(passwordTemporal);

  const admin = await prisma.usuario.create({
    data: {
      nombre,
      username,
      email,
      password: null,
      passwordHash,
      rol: 'ADMIN',
      activo: true,
      debeCambiarPassword: true
    }
  });

  console.log('\nAdministrador creado correctamente.');
  console.log(`Usuario: ${admin.username}`);
  console.log(`Contraseña temporal: ${passwordTemporal}`);
  console.log('IMPORTANTE: copia la contraseña ahora. No vuelve a mostrarse ni se guarda en texto plano.');
  console.log('El usuario deberá cambiarla en su primer inicio de sesión.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
