# FalconSky — notas para Claude

## Al terminar cualquier cambio de código

1. Comprobar tipos y compilar: `npx tsc --noEmit` y `npm run build`.
2. Regenerar el artefacto de prueba: `npm run build:artifact` y republicarlo en el mismo enlace.
3. Hacer commit y push a la rama de trabajo.
4. **Terminar siempre la respuesta con el enlace de descarga del proyecto listo para subir a
   Firebase** (ZIP de la rama, después de hacer push):

   https://github.com/rubencarbo/FalconFree/archive/refs/heads/claude/fervent-maxwell-i88232.zip

   Si la rama de trabajo cambia, usar
   `https://github.com/rubencarbo/FalconFree/archive/refs/heads/<rama>.zip`
   y recordar los pasos: descomprimir, `npm install`, `npm run deploy`.

## Proyecto

- Juego: FalconSky (repositorio de GitHub `rubencarbo/FalconFree`).
- Firebase: proyecto `falconsky` (plan gratuito Spark, presupuesto cero: no usar Cloud
  Functions ni nada que exija el plan Blaze).
- `.env` lleva la configuración pública de la app web; `.firebaserc` apunta a `falconsky`.
- Para pruebas locales no usar las claves reales: lanzar Vite con las variables
  `VITE_FIREBASE_*` vacías o con `VITE_USE_EMULATORS=1` y `npm run emulators`.
- Interfaz y textos en español.
