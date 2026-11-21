# FalconFree

Simulador de vuelo arcade en el navegador: pilota un caza sobre ciudades vóxel generadas
proceduralmente (infinitas), atraviesa anillos, compite contrarreloj y juega con amigos.

## Mundo

- Ciudad vóxel infinita y procedural: calles, puentes, parques, playas, bahías y rascacielos.
- 3 escenarios: Metrópolis, Archipiélago y Ciudad nocturna.
- 4 vistas: Básica, Lejana, Cenital y Cabina (HUD e instrumentos).
- Sonido sintetizado con WebAudio y bloom en los efectos luminosos.

## Modos de juego

- **Vuelo libre**: anillos que recargan balas y drones de práctica para disparar.
- **Competición**: carrera contrarreloj por **hitos** (puertas con pilares). Entre hito e hito
  eliges la ruta: la **baja**, entre edificios, tiene anillos azules que restan 1 s; la **alta**
  tiene anillos verdes de acelerón. Tiempos parciales comparados con tu mejor vuelta
  (verde/rojo) y clasificación online por circuito. 2 circuitos por escenario.
- **Multijugador** (2 a 8 jugadores) con **código de sala** de 6 caracteres:
  - *Vuelo libre en equipo*: contador de anillos compartido.
  - *Carrera en grupo*: misma parrilla, salida sincronizada y clasificación de la sala.

## Combate y daños

- **Disparo** con balas trazadoras, fogonazos, chispas, humo y explosiones con onda expansiva.
- **Apuntado asistido**: fija el objetivo dentro de un cono de 20° y corrige la anticipación.
- **Munición** limitada (160). Se recarga al pasar por hitos (+80) o anillos (+40).
- **Blindaje**: los impactos quitan vida; con mucho daño el avión sale humeando y explota.
- **Choques**: un roce o un golpe leve (contra edificios, suelo u otro avión) produce chispas,
  daños y un breve aturdimiento; solo un golpe fuerte destruye el avión. En carrera
  reapareces en el último hito, habiendo perdido tiempo.

## Controles

| Acción | Móvil | Teclado / ratón | Mando |
| --- | --- | --- | --- |
| Cabeceo / alabeo | Joystick | W/S · A/D (o flechas) | Stick izquierdo |
| Disparo | Disparo | F, J o clic izquierdo | X / LT |
| Turbo | Turbo | Espacio / Shift | A / RT |
| Subir | Subir | E | B |
| Cambiar vista | Vista | C | Y |
| Pausa | ❚❚ | P / Esc | Start |

En **Ajustes → Personalizar controles táctiles** puedes mover cada control, cambiar su
tamaño (60-200 %) y su opacidad (20-100 %). También: sensibilidad, apuntado asistido,
eje vertical invertido, sonido y efectos visuales.

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

1. Crea un proyecto en <https://console.firebase.google.com>.
2. **Authentication → Método de acceso**: activa **Anónimo**.
3. **Firestore Database**: créala (modo producción).
4. **Configuración del proyecto → Tus apps**: añade una app web y copia su configuración.
5. **Realtime Database** (para el multijugador): créala y copia su URL
   (`https://<proyecto>-default-rtdb.<región>.firebasedatabase.app`).
6. Copia `.env.example` a `.env.local` y rellena los valores `VITE_FIREBASE_*`,
   incluida `VITE_FIREBASE_DATABASE_URL`.
7. Despliega reglas, índices y la web (la CLI ya viene en las dependencias de desarrollo):

```bash
npx firebase login
cp .firebaserc.example .firebaserc               # pon el id de tu proyecto
npx firebase deploy --only firestore,database    # reglas + índices
npm run deploy                                   # build + firebase deploy
```

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
  stages.ts        Definición de escenarios (paletas, agua, alturas)
  world/
    noise.ts       Hash y ruido deterministas
    city.ts        Generación pura de la ciudad (también usada para colisiones)
    chunks.ts      Streaming de chunks y texturas de suelo pixeladas
```
