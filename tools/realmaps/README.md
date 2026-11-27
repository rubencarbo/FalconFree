# Mapas del mundo real

Genera `public/real/<id>.dat` (Barcelona, Madrid, Nueva York, Everest) a partir de datos abiertos:

- Edificios, calles, agua y parques: OpenStreetMap a través de las teselas vectoriales de
  [OpenFreeMap](https://openfreemap.org) (esquema OpenMapTiles). © colaboradores de OpenStreetMap, licencia ODbL.
- Relieve: teselas «Terrarium» de AWS (Mapzen / Tilezen).

```sh
NODE_USE_ENV_PROXY=1 node tools/realmaps/build.mjs            # todos
NODE_USE_ENV_PROXY=1 node tools/realmaps/build.mjs madrid     # uno
```

Los lugares se definen en `maps.mjs` (centro, tamaño, escala, giro). Las descargas se guardan en
`tools/realmaps/cache/` (no se sube al repositorio). El juego lee los `.dat` con `src/world/real.ts`.
