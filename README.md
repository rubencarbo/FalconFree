# FalconFree

Simulador de vuelo arcade en el navegador: pilota un caza sobre ciudades vóxel generadas
proceduralmente (infinitas), atraviesa anillos y compite en una clasificación online.

## Características

- **Mundo infinito procedural**: calles, avenidas, puentes, parques, playas, lagos/bahías y
  rascacielos en el centro. Se genera por chunks alrededor del avión.
- **3 escenarios**: Metrópolis, Archipiélago y Ciudad nocturna (ventanas iluminadas).
- **4 vistas**: Básica, Lejana, Cenital y Cabina (HUD verde con escalera de cabeceo, cinta de
  rumbo y panel de instrumentos: velocidad, actitud, altitud, ascenso y brújula).
- **Anillos** con indicador de distancia al más cercano, **turbo**, botón **Subir**,
  estelas, explosión al chocar y aviso de proximidad al suelo.
- **Controles**: joystick táctil + botones en móvil; teclado y mando en escritorio.
- **Sonido** sintetizado con WebAudio (sin archivos).
- **Firebase**: autenticación anónima, clasificación en Firestore por escenario y hosting.
  Si no se configura, el juego funciona en modo local (récords en `localStorage`).

## Tecnologías

| Parte | Elección |
| --- | --- |
| Lenguaje | TypeScript |
| Bundler / dev server | Vite |
| 3D | Three.js (InstancedMesh + shader de ventanas propio) |
| Backend | Firebase Auth (anónima), Cloud Firestore, Firebase Hosting |

## Controles

| Acción | Móvil | Teclado | Mando |
| --- | --- | --- | --- |
| Cabeceo / alabeo | Joystick | W/S · A/D (o flechas) | Stick izquierdo |
| Turbo | Turbo | Espacio / Shift | A / RT |
| Subir | Subir | E | B |
| Cambiar vista | Vista | C | Y |
| Pausa | ❚❚ | P / Esc | Start |

El eje Y se puede invertir desde el menú.

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
5. Copia `.env.example` a `.env.local` y rellena los valores `VITE_FIREBASE_*`.
6. Instala la CLI y despliega reglas, índices y la web:

```bash
npm i -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc   # pon el id de tu proyecto
firebase deploy --only firestore     # reglas + índice compuesto
npm run deploy                       # build + firebase deploy (hosting)
```

### Modelo de datos

`scores/{stageId}_{uid}` → `{ uid, name, stage, rings, maxSpeed, updatedAt }`

Las reglas (`firestore.rules`) solo permiten a cada jugador escribir su propio documento,
validan los campos y solo aceptan actualizaciones que **mejoren** su marca.

## Estructura

```
src/
  main.ts          Bucle del juego, estados, UI
  jet.ts           Modelo vóxel del caza y física de vuelo arcade
  cameraRig.ts     Vistas de cámara
  effects.ts       Cielo, estelas, explosión, anillos, suelo lejano
  hud.ts           HUD, indicador de anillos y cabina (canvas 2D)
  input.ts         Joystick táctil, teclado y mando
  audio.ts         Sonido sintetizado
  firebase.ts      Auth anónima + clasificación
  stages.ts        Definición de escenarios (paletas, agua, alturas)
  world/
    noise.ts       Hash y ruido deterministas
    city.ts        Generación pura de la ciudad (también usada para colisiones)
    chunks.ts      Streaming de chunks y texturas de suelo pixeladas
```
