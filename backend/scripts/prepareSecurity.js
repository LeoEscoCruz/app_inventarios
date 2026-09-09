const prisma = require('../config/db');

async function main() {
  const usuarios = await prisma.usuario.findMany();
  let modificados = 0;

  for (const usuario of usuarios) {
    const data = {};

    if (!usuario.username) {
      data.username = `legacy-${usuario.id.slice(0, 8).toLowerCase()}`;
    }

    // Nunca conservar contraseñas antiguas en texto plano.
    if (usuario.password) data.password = null;

    // Los usuarios legados no podrán autenticarse hasta que el administrador les restablezca una contraseña.
    if (!usuario.passwordHash) {
      data.activo = false;
      data.debeCambiarPassword = true;
    }

    if (Object.keys(data).length) {
      await prisma.usuario.update({ where: { id: usuario.id }, data });
      modificados += 1;
    }
  }

  console.log(`Preparación de seguridad terminada. Usuarios legados actualizados: ${modificados}`);
  console.log('No se eliminó ningún usuario ni ninguna captura histórica.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
