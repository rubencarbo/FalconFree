# Publicar FalconSky en Internet (guía paso a paso)

Esta guía te lleva desde cero hasta tener FalconSky publicado en una dirección como
`https://falconsky.web.app`, con la clasificación online y el multijugador
funcionando, y con la app instalable en el móvil.

- **Tiempo**: unos 30–45 minutos la primera vez.
- **Coste**: 0 €. Todo cabe en el plan gratuito de Firebase (plan **Spark**), que no pide
  tarjeta. Mientras no cambies de plan, es imposible que te cobren nada.
- **Qué necesitas**: un ordenador (Windows, Mac o Linux) y una cuenta de Google.

## Dónde estás ahora (proyecto `falconsky`)

| Paso | Estado |
| --- | --- |
| 3. Proyecto de Firebase `falconsky` | ✅ Hecho |
| 4. App web registrada | ✅ Hecho (sus claves ya están en el archivo `.env` del repositorio) |
| 5. Inicio de sesión anónimo | ⬜ **Pendiente**: compruébalo |
| 6. Firestore (clasificaciones) | ⬜ **Pendiente**: aún no está creado |
| 7. Realtime Database (multijugador) | ✅ Hecho: `https://falconsky-default-rtdb.europe-west1.firebasedatabase.app` |
| 8. Configurar el juego con las claves | ✅ Hecho en el repositorio (`.env` y `.firebaserc`) |
| 9. Publicar | ⬜ **Pendiente** |

**Te quedan 4 cosas**: instalar las herramientas (paso 1), descargar el código (paso 2),
los pasos **5 y 6** en la consola de Firebase, y publicar (paso **9**).

> 🔐 **Sobre las reglas «bloqueadas»** (`".read": false, ".write": false`): es lo correcto
> para empezar. Nadie puede leer ni escribir hasta que publiques. Al hacer el paso 9, la
> orden de publicar **sustituye** esas reglas por las del juego (`database.rules.json` y
> `firestore.rules`), que solo dejan a cada jugador escribir sus propios datos.
> **No hace falta que edites las reglas a mano en la consola.**

> 💡 Cuando veas un bloque como este:
> ```
> npm install
> ```
> significa: copia ese texto, pégalo en la **terminal** y pulsa **Intro**.

---

## Índice

1. [Instalar las herramientas en tu ordenador](#1-instalar-las-herramientas-en-tu-ordenador)
2. [Descargar el código del juego](#2-descargar-el-código-del-juego)
3. [Crear el proyecto de Firebase](#3-crear-el-proyecto-de-firebase)
4. [Registrar la app web y copiar sus claves](#4-registrar-la-app-web-y-copiar-sus-claves)
5. [Activar el inicio de sesión anónimo](#5-activar-el-inicio-de-sesión-anónimo)
6. [Crear la base de datos de clasificaciones (Firestore)](#6-crear-la-base-de-datos-de-clasificaciones-firestore)
7. [Crear la base de datos del multijugador (Realtime Database)](#7-crear-la-base-de-datos-del-multijugador-realtime-database)
8. [Configurar el juego con tus claves](#8-configurar-el-juego-con-tus-claves)
9. [Publicar (deploy)](#9-publicar-deploy)
10. [Comprobar que todo funciona](#10-comprobar-que-todo-funciona)
11. [Instalar la app en el móvil](#11-instalar-la-app-en-el-móvil)
12. [Publicar una versión nueva más adelante](#12-publicar-una-versión-nueva-más-adelante)
13. [Si algo falla](#13-si-algo-falla)

---

## 1. Instalar las herramientas en tu ordenador

Solo hay que hacerlo una vez.

### 1.1 Node.js

Node.js es lo que permite construir el juego en tu ordenador.

1. Entra en <https://nodejs.org>.
2. Descarga la versión que pone **LTS** (la recomendada).
3. Instálala con las opciones por defecto (Siguiente, Siguiente, Finalizar).

### 1.2 Abrir una terminal

La terminal es una ventana donde se escriben órdenes.

- **Windows**: pulsa la tecla Windows, escribe `PowerShell` y ábrelo.
- **Mac**: pulsa `Cmd + Espacio`, escribe `Terminal` y ábrelo.
- **Linux**: abre la aplicación *Terminal*.

Comprueba que Node.js se ha instalado bien:

```
node -v
```

Debe salir algo como `v22.15.0` o `v24.x.x`. El número tiene que ser **22 o mayor**.
Si sale un error, cierra la terminal, ábrela de nuevo y vuelve a probar (o reinicia el
ordenador).

### 1.3 Git (opcional)

Solo hace falta si prefieres descargar el código con Git (opción B del paso 2).
Descárgalo de <https://git-scm.com> e instálalo con las opciones por defecto.

---

## 2. Descargar el código del juego

El código está en GitHub, en el repositorio `rubencarbo/FalconFree`, rama
`claude/fervent-maxwell-i88232`.

**Opción A — sin Git (la más sencilla)**

1. Entra en <https://github.com/rubencarbo/FalconFree>.
2. Comprueba que en el desplegable de ramas (arriba a la izquierda) pone
   `claude/fervent-maxwell-i88232`. Si pone otra, elígela.
3. Pulsa el botón verde **Code** → **Download ZIP**.
4. Descomprime el ZIP en una carpeta fácil de encontrar, por ejemplo `Documentos/FalconFree`.

**Opción B — con Git**

```
git clone -b claude/fervent-maxwell-i88232 https://github.com/rubencarbo/FalconFree.git
```

### 2.1 Entrar en la carpeta e instalar las dependencias

En la terminal, ve a la carpeta del juego. Escribe `cd ` (con un espacio al final),
**arrastra la carpeta del juego a la ventana de la terminal** y pulsa Intro.
Debe quedar algo así:

```
cd C:\Users\TuNombre\Documents\FalconFree
```

Ahora instala todo lo que el juego necesita (tarda 1–3 minutos):

```
npm install
```

Es normal que salgan avisos (`warn`) o un mensaje sobre `npm audit`. Mientras no ponga
`ERR!`, todo va bien.

> ⚠️ A partir de aquí, **todas las órdenes se escriben dentro de esta carpeta**. Si cierras la
> terminal, vuelve a hacer el `cd` a la carpeta antes de seguir.

---

## 3. Crear el proyecto de Firebase

1. Entra en <https://console.firebase.google.com> con tu cuenta de Google.
2. Pulsa **Crear un proyecto** (o *Comenzar con un proyecto de Firebase*).
3. **Nombre**: escribe `FalconSky`. Debajo verás el **ID del proyecto**, por ejemplo
   `falconsky`. **Apúntalo**: lo necesitarás varias veces.
4. Acepta las condiciones y pulsa **Continuar**.
5. Si te pregunta por **Gemini** o por **Google Analytics**, puedes **desactivarlos**: el
   juego no los usa.
6. Pulsa **Crear proyecto**, espera unos segundos y pulsa **Continuar**.

✅ Ya estás dentro del panel de tu proyecto. Abajo a la izquierda debe poner
**Plan Spark** (el gratuito). **No lo cambies.**

---

## 4. Registrar la app web y copiar sus claves

1. En la página principal del proyecto, pulsa el icono **`</>`** (Web). Si no lo ves,
   ve al engranaje ⚙️ (arriba a la izquierda) → **Configuración del proyecto** → bajando,
   **Tus apps** → icono **`</>`**.
2. **Sobrenombre de la app**: `FalconSky web`.
3. **No** marques la casilla de Firebase Hosting (lo haremos nosotros más tarde).
4. Pulsa **Registrar app**.
5. Aparece un bloque de código con algo así:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSyB...",
     authDomain: "falconsky.firebaseapp.com",
     projectId: "falconsky",
     storageBucket: "falconsky.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123def456"
   };
   ```

6. **Copia esos seis valores** a un bloc de notas. Los usarás en el paso 8.
7. Pulsa **Ir a la consola**.

> 🔒 Estas claves **no son secretas**: van dentro de cualquier web que use Firebase. Lo que
> protege los datos son las reglas de seguridad, que se suben en el paso 9.

¿Las has perdido? Están siempre en ⚙️ → **Configuración del proyecto** → **Tus apps** →
**Configuración del SDK** → **Config**.

---

## 5. Activar el inicio de sesión anónimo

El juego identifica a cada jugador sin pedirle correo ni contraseña.

1. En el menú de la izquierda: **Compilación** (*Build*) → **Authentication**.
2. Pulsa **Comenzar**.
3. Pestaña **Método de acceso** (*Sign-in method*).
4. En la lista de proveedores, elige **Anónimo**.
5. Activa el interruptor **Habilitar** y pulsa **Guardar**.

✅ En la lista debe aparecer **Anónimo — Habilitado**.

---

## 6. Crear la base de datos de clasificaciones (Firestore)

Aquí se guardan los récords: anillos, tiempos de carrera y desafío diario.

1. Menú de la izquierda: **Compilación** → **Firestore Database**.
2. Pulsa **Crear base de datos**.
3. Si te pregunta por la **edición**, elige **Standard**.
4. **ID de la base de datos**: déjalo como está (`(default)`).
5. **Ubicación**: elige una de Europa, por ejemplo **`eur3 (Europe)`** o
   **`europe-southwest1 (Madrid)`**.
   ⚠️ La ubicación **no se puede cambiar después**.
6. **Reglas**: elige **Iniciar en modo de producción**. Las reglas buenas las subimos en el
   paso 9.
7. Pulsa **Crear** y espera a que termine (menos de un minuto).

✅ Verás una base de datos vacía. No hay que crear nada a mano: las colecciones `scores` y
`times` las crea el juego solo cuando alguien bate un récord.

---

## 7. Crear la base de datos del multijugador (Realtime Database)

Aquí viven las salas multijugador: quién está conectado, las posiciones de los aviones y
los disparos.

1. Menú de la izquierda: **Compilación** → **Realtime Database**.
2. Pulsa **Crear base de datos**.
3. **Ubicación**: **Bélgica (`europe-west1`)**.
4. **Reglas de seguridad**: elige **Empezar en modo bloqueado**.
5. Pulsa **Habilitar**.
6. Arriba de los datos verás un enlace parecido a:

   ```
   https://falconsky-default-rtdb.europe-west1.firebasedatabase.app/
   ```

   **Cópialo** a tu bloc de notas, **sin la barra `/` final**. Es tu
   `VITE_FIREBASE_DATABASE_URL`.

✅ Tampoco hay que crear nada a mano: el juego crea y borra las salas automáticamente.

---

## 8. Configurar el juego con tus claves

✅ **Para FalconSky ya está hecho**: el repositorio incluye

- `.env`, con las claves de la app web `falconsky` y la dirección de la Realtime Database.
- `.firebaserc`, que dice a la terminal que publique en el proyecto `falconsky`.

No tienes que tocar nada. Puedes saltar al paso 9.

<details>
<summary>Solo si algún día usas otro proyecto de Firebase</summary>

Crea un archivo `.env.local` en la carpeta del juego (tiene prioridad sobre `.env` y no se
sube a GitHub) con tus valores, cada uno justo después del `=`, sin espacios ni comillas:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto
VITE_FIREBASE_STORAGE_BUCKET=tu-proyecto.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_DATABASE_URL=https://tu-proyecto-default-rtdb.europe-west1.firebasedatabase.app
```

Y cambia el ID en `.firebaserc`:

```json
{
  "projects": {
    "default": "tu-proyecto"
  }
}
```

</details>

---

## 9. Publicar (deploy)

### 9.1 Iniciar sesión en Firebase desde la terminal (solo la primera vez)

```
npx firebase login
```

- Si pregunta si quieres enviar informes de uso (*Allow Firebase to collect…*), da igual:
  escribe `n` y pulsa Intro.
- Se abrirá el navegador: elige **la misma cuenta de Google** del paso 3 y pulsa
  **Permitir**.
- En la terminal debe salir: `✔ Success! Logged in as tu-correo@gmail.com`.

### 9.2 Publicar todo

```
npm run deploy
```

Esta orden hace todo de una vez:

1. **Construye** el juego con tus claves (crea la carpeta `dist`).
2. **Sube las reglas de seguridad** de Firestore y de Realtime Database.
3. **Crea los índices** de las clasificaciones.
4. **Publica la web** en Firebase Hosting.

Tarda 1–2 minutos. Al final verás algo así:

```
✔  Deploy complete!

Project Console: https://console.firebase.google.com/project/falconsky/overview
Hosting URL: https://falconsky.web.app
```

🎉 **Esa `Hosting URL` es la dirección de tu juego.** Ábrela en el navegador.

> ⏳ Los **índices** de las clasificaciones tardan unos minutos en estar listos la primera
> vez. Si al abrir la clasificación justo después sale un error, espera 5 minutos.
> Puedes ver su estado en **Firestore Database → Índices**.

---

## 10. Comprobar que todo funciona

Abre tu `Hosting URL` y repasa esta lista:

- [ ] Abajo del menú pone **«Clasificación online activa»**. Si pone *Modo local* o
      *Sin conexión con Firebase*, mira el [paso 13](#13-si-algo-falla).
- [ ] **Vuelo libre**: atraviesa algún anillo y estréllate. En el resumen debe salir
      *«¡Nuevo récord guardado en la clasificación!»*.
- [ ] **Clasificación**: aparece tu nombre.
- [ ] **Multijugador**: pulsa *Crear y obtener código*. Debe salir un código tipo `ABC-123`.
- [ ] Con **otro dispositivo** (el móvil, por ejemplo), abre la misma dirección, entra en
      **Multijugador → Unirse con código** y escribe el código. Los dos debéis aparecer en
      la sala. El anfitrión pulsa **Empezar** y os veréis volar.

En la consola de Firebase también puedes ver los datos:

- **Firestore Database → Datos**: aparecen las colecciones `scores` y `times`.
- **Realtime Database → Datos**: mientras hay una sala abierta, aparece `rooms`.
- **Authentication → Usuarios**: un usuario anónimo por cada dispositivo que ha jugado.

---

## 11. Instalar la app en el móvil

- **Android (Chrome)**: abre tu dirección → en el menú del juego pulsa **Instalar app**
  (o menú ⋮ de Chrome → **Instalar aplicación**).
- **iPhone / iPad**: abre tu dirección **en Safari** → botón **Compartir** (cuadrado con
  flecha) → **Añadir a pantalla de inicio** → **Añadir**.
- **Ordenador (Chrome / Edge)**: botón **Instalar app** del menú, o el icono de instalar a la
  derecha de la barra de direcciones.

Se abre a pantalla completa, con su icono, y los modos de un jugador funcionan **sin
conexión**.

---

## 12. Publicar una versión nueva más adelante

Cada vez que haya cambios en el código:

1. Descarga la versión nueva del código (paso 2). Ya trae `.env` y `.firebaserc`.
2. En la terminal, dentro de la carpeta:
   ```
   npm install
   npm run deploy
   ```

Quien tenga la app instalada verá el aviso **«Hay una nueva versión — Actualizar»**.

> `npm run deploy` publica también las **reglas** de Firestore y de Realtime Database. Es
> importante: las versiones nuevas añaden colecciones (perfil en la nube, fantasmas del récord
> mundial, circuitos) y modos de sala (Supervivencia, Jefe final) que sin las reglas nuevas
> darían «permission denied».

> Si solo cambias reglas de seguridad, basta con:
> ```
> npx firebase deploy --only firestore,database
> ```

---

## 13. Si algo falla

| Lo que ves | Qué pasa | Solución |
| --- | --- | --- |
| `node` o `npm` *no se reconoce como un comando* | Node.js no está instalado o la terminal se abrió antes de instalarlo | Instala Node.js (paso 1.1) y **abre una terminal nueva** |
| En el menú pone *«Modo local: configura Firebase…»* | El juego se construyó sin el archivo `.env` | Comprueba que el archivo `.env` está en la carpeta del juego (en Windows, activa *Ver → Elementos ocultos*; en Mac, `Cmd+Mayús+.`) y repite `npm run deploy` |
| *«Sin conexión con Firebase»* | El inicio de sesión anónimo no está activado | Haz el paso 5 (no hace falta volver a publicar; recarga la página) |
| Multijugador: *«El multijugador necesita Firebase con Realtime Database»* | Falta `VITE_FIREBASE_DATABASE_URL` en `.env` | Revisa el archivo `.env` y repite `npm run deploy` |
| `Error: Failed to get Firebase project … Please make sure the project exists` | El ID de `.firebaserc` no es el tuyo | Corrige el ID (paso 8.2). Lo ves en ⚙️ → Configuración del proyecto → *ID del proyecto* |
| `Error: … database … not found` o `Realtime Database instance … does not exist` al publicar | No se ha creado la Realtime Database | Haz el paso 7 y repite `npm run deploy` |
| `Error: … Cloud Firestore API has not been used` o *database (default) does not exist* | No se ha creado Firestore | Haz el paso 6 y repite `npm run deploy` |
| `Error: Authentication Error` / `not logged in` | La terminal no tiene tu sesión de Firebase | `npx firebase login` (o `npx firebase login --reauth`) |
| Al crear una sala: `transaction at /rooms/…/meta failed: permission_denied` | La Realtime Database sigue con las reglas bloqueadas: las del juego no se han publicado | `npm run deploy:multijugador` (publica solo esas reglas). Comprueba en **Realtime Database → Reglas** que aparece `"rooms"`. Ver la nota de abajo |
| `auth/configuration-not-found` | Authentication no está activado en el proyecto | Paso 5: **Authentication → Comenzar → Método de acceso → Anónimo → Habilitar** |
| La clasificación pone *«No se pudo cargar la clasificación»* justo tras publicar | Los índices aún se están creando | Espera 5–10 minutos (Firestore → Índices) |
| En la consola del navegador: `Missing or insufficient permissions` | Las reglas no se han subido | `npx firebase deploy --only firestore,database` |
| He cambiado `.env` o `.env.local` y no se nota | Las claves se meten en el juego **al construirlo** | Repite `npm run deploy` |
| El móvil sigue mostrando la versión antigua | La app guardada en el móvil aún no se ha actualizado | Cierra y abre la app y pulsa **Actualizar** en el aviso; o recarga la página dos veces |

### Publicar solo las reglas

Si `npm run deploy` se detuvo con un error (por ejemplo porque Firestore aún no estaba
creado), puede que las reglas no se hayan subido. Hay órdenes para publicarlas por separado:

- Solo multijugador (Realtime Database): `npm run deploy:multijugador`
- Todas las reglas e índices (Realtime Database y Firestore): `npm run deploy:reglas`

**Plan B, sin terminal**: en la consola de Firebase, **Realtime Database → Reglas**, borra lo
que haya, pega el contenido completo del archivo `database.rules.json` del proyecto y pulsa
**Publicar**. Para Firestore es igual: **Firestore Database → Reglas**, pega
`firestore.rules` y **Publicar** (los índices sí necesitan `npm run deploy:reglas`).

### Proteger el presupuesto cero

- Quédate en el **plan Spark**. Si en algún momento Firebase te propone *Actualizar a Blaze*,
  **no lo hagas**: Blaze pide tarjeta y cobra por uso. En Spark, si se superan los límites
  gratuitos, el servicio simplemente se pausa hasta el mes siguiente; nunca hay cargos.
- Límites gratuitos más relevantes (de sobra para jugar con amigos):
  - **Realtime Database**: 100 conexiones simultáneas y 10 GB de descarga al mes (unas
    140 horas de partidas de 4 jugadores).
  - **Firestore**: 50 000 lecturas y 20 000 escrituras **al día**.
  - **Hosting**: 10 GB de transferencia al mes.
- Puedes ver el consumo en la consola: **Uso y facturación** (*Usage and billing*).

### Usar tu propio dominio (opcional)

En **Hosting → Agregar dominio personalizado** sigue el asistente. Después, en
**Authentication → Configuración → Dominios autorizados**, añade tu dominio para que el
inicio de sesión anónimo funcione también allí.
