# FalconSky

Simulador de vuelo arcade instalable (PWA): pilota un caza sobre ciudades vóxel generadas
proceduralmente (infinitas), compite contrarreloj, combate contra bots y juega con amigos.

## Mundo

- Ciudad vóxel infinita y procedural: calles, puentes, parques, playas, bahías y rascacielos.
- 3 escenarios: Metrópolis, Archipiélago y Ciudad nocturna.
- 4 vistas: Básica, Lejana, Cenital y Cabina (HUD e instrumentos).
- Sonido sintetizado con WebAudio y bloom en los efectos luminosos.

## Instalar como app (PWA)

FalconSky es una **Progressive Web App**: se instala desde el navegador y se abre a pantalla
completa, con su icono, sin barra del navegador.

- **Android / Chrome / Edge (escritorio)**: botón **Instalar app** del menú (o el icono de
  instalar de la barra de direcciones).
- **iPhone / iPad**: Safari → Compartir → **Añadir a pantalla de inicio** (el botón del menú
  muestra estas instrucciones).
- Funciona **sin conexión** en los modos en solitario (vuelo libre, competición, desafío diario
  y batalla contra bots). Clasificaciones y multijugador necesitan conexión.
- Cuando se publica una versión nueva, aparece el aviso **Actualizar**.
- Accesos directos (mantener pulsado el icono): *Vuelo libre* y *Desafío diario*.
- La pantalla no se apaga mientras juegas.

## Modos de juego

- **Vuelo libre**: anillos, drones de práctica y cajas de recompensa.
- **Competición**: carrera contrarreloj por **hitos**. Entre hito e hito eliges ruta: la
  **baja**, entre edificios, tiene anillos azules que restan 1 s; la **alta**, anillos verdes de
  acelerón. Tiempos parciales frente a tu mejor vuelta y **fantasma** de tu récord.
- **Desafío diario**: un circuito nuevo cada día (igual para todo el mundo, cambia a las 00:00
  UTC) con su propia clasificación.
- **Batalla** contra bots: *todos contra todos*, *equipos* (tú y bots aliados contra bots) o
  *tú contra la máquina*. Límite de derribos y de tiempo configurables.
- **Multijugador** (2 a 8 jugadores) con **código de sala**: vuelo libre en equipo, carrera en
  grupo o batalla (todos contra todos, equipos Naranja vs Azul o todos contra la máquina, con
  bots de relleno que simula el anfitrión).

## Orientación en las carreras

Para no perderse en un mundo abierto, sin mover los hitos (sería injusto en la clasificación):

- Circuitos compactos: ~800 m entre hitos.
- **Haz de luz** vertical en el siguiente hito (y uno tenue en el posterior), visible a km.
- **Flecha 3D** delante del avión apuntando al siguiente hito.
- **Radar** orientado al rumbo, con el siguiente hito, el posterior y la ruta.
- **Fuera de ruta**: si te alejas, aparece *Volver a la ruta* (tecla R): vuelves al último hito
  con 3 s de penalización.

## Aros

| Aro | Premio |
| --- | --- |
| Naranja | 1 anillo y +40 balas |
| Amarillo | 1 anillo y munición completa |
| Verde | 1 anillo y +25 % de blindaje |
| Violeta | 1 anillo y +1 misil |
| Rojo | 1 anillo y acelerón |
| Dorado (pequeño, gira rápido) | 5 anillos |
| Marino (gigante, medio sumergido en el agua) | 3 anillos |

Cada 5 anillos recogidos se gana además 1 misil.

## Multijugador: identidad y escuadrón

- En la sala cada piloto elige **nombre, color e icono** (✕ ● ■ ★ ▲ ➤ ◆ ✚). Los que ya
  usa otro jugador aparecen tachados.
- En vuelo, cada avión va pintado con su color y lleva una **etiqueta** con icono, nombre y
  distancia; si está fuera de la pantalla, la etiqueta se queda en el borde señalando dónde está.
- En el radar, cada piloto aparece con su icono y su color (los enemigos, con un aro rojo).
- **Vuelo en equipo**: sin fuego amigo. Si te alejas más de 1,1 km del compañero más cercano
  aparece un aviso y una flecha verde; a más de 1,7 km durante 4 s te reagrupa detrás de un
  compañero.

## Combate y daños

- **Disparo** con trazadoras, fogonazos, chispas, humo y explosiones con onda expansiva.
- **Apuntado asistido**: fija el objetivo dentro de un cono de 20° y corrige la anticipación.
- **Misiles con fijación** (2 al empezar, máx. 4): necesitan el blanco fijado. Persiguen al
  objetivo; se pueden esquivar con un giro brusco o con **bengalas** (3, se recargan solas).
  Aviso de *MISIL* con su dirección.
- **Recompensas**: escudo, munición (+2 misiles), reparación, turbo infinito y doble daño.
- **Blindaje**: los impactos quitan vida; con mucho daño el avión humea y explota.
- **Choques**: un roce o un golpe leve produce chispas, daño y aturdimiento; solo un golpe
  fuerte destruye el avión.

## Progreso

- **Créditos** por anillos, drones, carreras, batallas, desafíos y logros.
- **Hangar**: 4 aviones (Halcón, Raptor, Tifón, Colibrí) con velocidad, agilidad y blindaje
  distintos; 8 pinturas; mejoras de motor, blindaje y cargador (3 niveles).
- **19 logros**, algunos desbloquean pinturas o aviones.
- **Repetición** de las mejores jugadas (derribos, misiles, rozaduras, meta) con cámara
  cinematográfica y cámara lenta.

## Controles

| Acción | Móvil | Teclado / ratón | Mando |
| --- | --- | --- | --- |
| Cabeceo / alabeo | Joystick | W/S · A/D (o flechas) | Stick izquierdo |
| Disparo | Disparo | F, J o clic izquierdo | X / LT |
| Misil | Misil | Q o clic derecho | RB |
| Bengalas | Bengalas | G | LB |
| Turbo | Turbo | Espacio / Shift | A / RT |
| Subir | — | E | B |
| Volver a la ruta | botón en pantalla | R | — |
| Cambiar vista | Vista | C | Y |
| Pausa | ❚❚ | P / Esc | Start |

**Ajustes**: personalizar controles táctiles (posición, tamaño, opacidad), sensibilidad,
apuntado asistido, **clima** (variable: lluvia, niebla, tormenta con rayos y turbulencias,
nieve / siempre despejado), **vibración**, fantasma, eje invertido, sonido y efectos.

## Tecnologías

| Parte | Elección |
| --- | --- |
| Lenguaje | TypeScript |
| Bundler / dev server | Vite |
| 3D | Three.js (InstancedMesh, shader de ventanas propio, bloom) |
| Clasificaciones | Cloud Firestore |
| Multijugador | Firebase Realtime Database (salas, posiciones a 10 Hz, eventos) |
| Usuarios | Firebase Auth anónima |
| Web | Firebase Hosting |

### Coste: 0 €

Todo funciona en el **plan gratuito Spark** de Firebase (sin tarjeta). No se usan Cloud
Functions (que requieren el plan de pago): la lógica es del cliente y las reglas de seguridad
validan los datos. Límites del plan gratuito relevantes:

- Realtime Database: 100 conexiones simultáneas, 1 GB guardado, 10 GB/mes de descarga.
  Una partida de 4 jugadores consume unos 20 KB/s en total: ~140 horas de juego al mes.
- Firestore: 50 000 lecturas y 20 000 escrituras al día.
- Hosting: 10 GB/mes de transferencia.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173 (también accesible desde el móvil en la misma red)
npm run build    # typecheck + build en dist/
```

## Configurar Firebase

> 📘 **¿Primera vez?** Sigue la guía paso a paso [DESPLIEGUE.md](DESPLIEGUE.md): crear el
> proyecto, las dos bases de datos y publicar el juego, sin conocimientos previos.


El repositorio ya está configurado para el proyecto **`falconsky`**:

- `.env`: configuración pública de la app web y URL de la Realtime Database
  (`https://falconsky-default-rtdb.europe-west1.firebasedatabase.app`).
- `.firebaserc`: proyecto por defecto `falconsky`.

En la consola de Firebase deben estar activados: **Authentication → Anónimo**,
**Firestore Database** y **Realtime Database**. Después:

```bash
npx firebase login
npm run deploy        # build + reglas + índices + hosting
```

Para usar otro proyecto, crea `.env.local` (tiene prioridad sobre `.env`, ver `.env.example`)
y cambia el ID en `.firebaserc`.

### Probar todo en local sin cuenta (emuladores)

Necesita Java 11+. En una terminal:

```bash
npm run emulators            # Auth, Firestore y Realtime Database en local
```

En otra:

```bash
VITE_USE_EMULATORS=1 npm run dev
```

Abre dos pestañas (o un móvil en la misma red con `--host`) para jugar contra ti mismo.

### Modelo de datos

Firestore:

- `scores/{stageId}_{uid}` → `{ uid, name, stage, rings, maxSpeed, updatedAt }`
- `times/{courseId}_{uid}` → `{ uid, name, course, timeMs, updatedAt }`

Realtime Database (`rooms/{CODE}`):

- `meta` → anfitrión, modo, escenario, circuito, estado, hora de salida, ronda
- `players/{uid}` → nombre, color · `pos/{uid}` → posición y estado (10 Hz)
- `events/{id}` → impactos, choques y derribos dirigidos a un jugador
- `results/{uid}` → tiempo de carrera · `rings/{id}` → anillos recogidos por el equipo
- `bots/{botId}` → estado de los bots (solo escribe el anfitrión) · `score/{id}` → derribos y caídas

Las reglas (`firestore.rules`, `database.rules.json`) solo permiten a cada jugador escribir
sus propios datos, validan los campos, y en las clasificaciones solo aceptan **mejoras**.
Si el anfitrión se va, el jugador más antiguo de la sala toma el relevo.

## Estructura

```
src/
  main.ts          Bucle del juego, modos, daños, UI
  jet.ts           Modelo vóxel del caza y física de vuelo arcade
  cameraRig.ts     Vistas de cámara
  effects.ts       Cielo, estelas, anillos, suelo lejano
  fx.ts            Partículas: chispas, humo, explosiones, onda expansiva
  combat.ts        Cañones, trazadoras, apuntado asistido, munición
  drones.ts        Drones de práctica
  race.ts          Circuitos, hitos, rutas alternativas y parciales
  net.ts           Salas multijugador (Realtime Database)
  remote.ts        Aviones de otros jugadores (interpolación)
  hud.ts           HUD, retículo, cronómetro y cabina (canvas 2D)
  input.ts         Joystick táctil, teclado, ratón y mando
  controls.ts      Disposición y editor de controles táctiles
  settings.ts      Ajustes guardados
  audio.ts         Sonido sintetizado
  firebase.ts      Auth anónima, clasificaciones, emuladores
  pwa.ts           Instalación, actualizaciones, pantalla encendida
  nav.ts           Flecha guía y radar
  weather.ts       Clima
  ghost.ts         Fantasma de la mejor vuelta
  powerups.ts      Recompensas
  missiles.ts      Misiles y bengalas
  bots.ts          IA de los bots
  battle.ts        Reglas y marcador de batalla
  progress.ts      Créditos, logros, hangar
  daily.ts         Desafío diario
  replay.ts        Grabación y repetición cinematográfica
  haptics.ts       Vibración
  stages.ts        Definición de escenarios (paletas, agua, alturas)
  world/
    noise.ts       Hash y ruido deterministas
    city.ts        Generación pura de la ciudad (también usada para colisiones)
    chunks.ts      Streaming de chunks y texturas de suelo pixeladas
```
