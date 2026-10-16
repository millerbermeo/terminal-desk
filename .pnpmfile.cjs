// typescript-eslint aún no soporta TypeScript 7: sus paquetes usan la API de TS 6 (@typescript/typescript6)
// mientras el proyecto compila con TS 7. Quitar cuando typescript-eslint soporte TS >= 7.1.
const PAQUETES = /^(typescript-eslint|@typescript-eslint\/.+|ts-api-utils)$/

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (!PAQUETES.test(pkg.name)) return pkg
      if (pkg.peerDependencies?.typescript) {
        delete pkg.peerDependencies.typescript
        pkg.dependencies = { ...pkg.dependencies, typescript: 'npm:@typescript/typescript6@6.0.2' }
      }
      return pkg
    }
  }
}
