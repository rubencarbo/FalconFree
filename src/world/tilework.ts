/// <reference lib="webworker" />
/**
 * Mundo abierto: descarga y prepara los datos reales en segundo plano.
 *  - «region»: 1920×1920 m con detalle (suelo cada 4 m, edificios en cajas, relieve cada 16 m)
 *    a partir de las teselas vectoriales z14 de OpenFreeMap (OpenStreetMap) y del relieve Terrarium z12.
 *  - «coarse»: una tesela z10 (~30 km) para ver a lo lejos: alturas 65×65 y una textura 256×256.
 * Datos: © colaboradores de OpenStreetMap (ODbL), OpenFreeMap, OpenMapTiles · relieve: Mapzen/Tilezen.
 */
import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { Geo, lat2tile, lon2tile, tile2lat, tile2lon } from './geo';
import { CELL_B, CELL_C, CELL_E, COARSE_N, COARSE_TEX, COARSE_Z, NC, NE, REGION, type WorkIn, type WorkOut } from './streamconst';

/** Clases de suelo (las mismas que src/world/real.ts) */
const K = {
  URBAN: 0, WATER: 1, PARK: 2, FOREST: 3, SAND: 4, ROAD: 5, ROAD_BIG: 6, PATH: 7, RAIL: 8, PITCH: 9,
  PLAZA: 10, PARKING: 11, FIELD: 12, ROCK: 13, GLACIER: 14, SCRUB: 15, INDUSTRIAL: 16, CEMETERY: 17, SEA: 18, COUNTRY: 19,
};
/** Estilos de edificio (S_* de city.ts) */
const S = { OFFICE: 0, GLASS: 1, RESID: 2, INDUST: 3, HOUSE: 5 };

let geo = new Geo(0, 0);
let tplP: Promise<string> | null = null;

async function getRetry(url: string, tries = 3): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
      if (r.status === 404 || r.status === 204) return null;
    } catch {
      /* reintento */
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  throw new Error(`sin respuesta: ${url.split('/')[2]}`);
}

function template() {
  if (!tplP)
    tplP = getRetry('https://tiles.openfreemap.org/planet').then(async (r) => {
      if (!r) throw new Error('OpenFreeMap no responde');
      return ((await r.json()) as { tiles: string[] }).tiles[0];
    });
  return tplP;
}

async function vectorTile(z: number, x: number, y: number): Promise<VectorTile | null> {
  const tpl = await template();
  const r = await getRetry(tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
  if (!r) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  if (!buf.length) return null;
  return new VectorTile(new Pbf(buf));
}

/** Relieve Terrarium decodificado (metros) */
const demCache = new Map<string, Promise<Float32Array | null>>();
function dem(z: number, x: number, y: number) {
  const k = `${z}/${x}/${y}`;
  let p = demCache.get(k);
  if (!p) {
    p = (async () => {
      const r = await getRetry(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${k}.png`);
      if (!r) return null;
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const c = new OffscreenCanvas(256, 256);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, 256, 256).data;
      const out = new Float32Array(256 * 256);
      for (let i = 0; i < out.length; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      return out;
    })().catch(() => null);
    demCache.set(k, p);
    if (demCache.size > 40) demCache.delete(demCache.keys().next().value!);
  }
  return p;
}

/** Altura (m) en un punto con teselas Terrarium de zoom z ya cargadas */
function demAt(tiles: Map<string, Float32Array | null>, z: number, lat: number, lon: number) {
  const fx = lon2tile(lon, z) * 256 - 0.5;
  const fy = lat2tile(lat, z) * 256 - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const ax = fx - ix;
  const ay = fy - iy;
  const px = (X: number, Y: number) => {
    const t = tiles.get(`${Math.floor(X / 256)},${Math.floor(Y / 256)}`);
    if (!t) return 0;
    return t[(((Y % 256) + 256) % 256) * 256 + (((X % 256) + 256) % 256)];
  };
  return (px(ix, iy) * (1 - ax) + px(ix + 1, iy) * ax) * (1 - ay) + (px(ix, iy + 1) * (1 - ax) + px(ix + 1, iy + 1) * ax) * ay;
}

// ---------------------------------------------------------------- Teselas z14 proyectadas
interface Feat {
  /** 0 edificio · 1 área · 2 línea */
  k: 0 | 1 | 2;
  c: number;
  prio: number;
  w: number;
  h: number;
  mh: number;
  seed: number;
  bridge: boolean;
  /** anillos (x, z intercalados); en áreas y edificios el primero es el exterior */
  rings: Float64Array[];
}

const featCache = new Map<string, Promise<Feat[]>>();
function tileFeats(x: number, y: number): Promise<Feat[]> {
  const k = `${x},${y}`;
  let p = featCache.get(k);
  if (!p) {
    p = loadFeats(x, y).catch(() => []);
    featCache.set(k, p);
    if (featCache.size > 36) featCache.delete(featCache.keys().next().value!);
  }
  return p;
}

const ROAD_W: Record<string, number> = { motorway: 22, trunk: 20, primary: 18, secondary: 15, tertiary: 12, minor: 9, service: 5, track: 4, busway: 6, raceway: 8 };

async function loadFeats(tx: number, ty: number): Promise<Feat[]> {
  const z = 14;
  const t = await vectorTile(z, tx, ty);
  if (!t) return [];
  const out: Feat[] = [];
  const proj = (pts: { x: number; y: number }[], ext: number) => {
    const a = new Float64Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      const lon = tile2lon(tx + pts[i].x / ext, z);
      const lat = tile2lat(ty + pts[i].y / ext, z);
      const [wx, wz] = geo.toWorld(lat, lon);
      a[i * 2] = wx;
      a[i * 2 + 1] = wz;
    }
    return a;
  };
  const each = (layer: string, fn: (p: Record<string, unknown>, type: number) => Omit<Feat, 'rings'> | null) => {
    const L = t.layers[layer];
    if (!L) return;
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i);
      const base = fn(f.properties as Record<string, unknown>, f.type);
      if (!base) continue;
      const g = f.loadGeometry();
      if (f.type === 3) {
        for (const poly of classifyRings(g)) out.push({ ...base, rings: poly.map((r) => proj(r, L.extent)) });
      } else if (f.type === 2) {
        for (const line of g) out.push({ ...base, rings: [proj(line, L.extent)] });
      }
    }
  };
  const area = (c: number, prio: number): Omit<Feat, 'rings'> => ({ k: 1, c, prio, w: 0, h: 0, mh: 0, seed: 0, bridge: false });
  const line = (c: number, w: number, bridge = false): Omit<Feat, 'rings'> => ({ k: 2, c, prio: 0, w, h: 0, mh: 0, seed: 0, bridge });
  each('building', (p, ty) => {
    const h = Number(p.render_height);
    if (ty !== 3 || p.hide_3d || !(h >= 2)) return null;
    return { k: 0, c: 0, prio: 0, w: 0, h: Math.min(h, 600), mh: Number(p.render_min_height) || 0, seed: 0, bridge: false };
  });
  each('landuse', (p, ty) => {
    if (ty !== 3) return null;
    const c = String(p.class);
    if (['residential', 'commercial', 'retail', 'neighbourhood', 'suburb', 'quarter', 'hospital', 'school', 'college', 'university', 'kindergarten', 'library'].includes(c)) return area(K.URBAN, 1);
    if (['industrial', 'railway', 'garages', 'quarry', 'dam'].includes(c)) return area(K.INDUSTRIAL, 2);
    if (c === 'cemetery') return area(K.CEMETERY, 5);
    if (c === 'stadium' || c === 'pitch' || c === 'track') return area(K.PITCH, 9);
    if (c === 'playground' || c === 'theme_park' || c === 'zoo') return area(K.PARK, 4);
    return null;
  });
  each('landcover', (p, ty) => {
    if (ty !== 3) return null;
    const c = String(p.class);
    if (c === 'grass') return area(K.PARK, 4);
    if (c === 'wood') return area(K.FOREST, 6);
    if (c === 'farmland') return area(K.FIELD, 3);
    if (c === 'sand') return area(K.SAND, 8);
    if (c === 'ice') return area(K.GLACIER, 8);
    if (c === 'rock') return area(K.ROCK, 7);
    if (c === 'wetland') return area(K.SCRUB, 5);
    return null;
  });
  each('park', (_p, ty) => (ty === 3 ? area(K.PARK, 4) : null));
  each('aeroway', (p, ty) => {
    const c = String(p.class);
    if (ty === 3) return c === 'aerodrome' ? null : area(K.PARKING, 9);
    return c === 'runway' ? line(K.ROAD_BIG, 45) : c === 'taxiway' ? line(K.ROAD, 18) : null;
  });
  each('water', (p, ty) => (ty !== 3 || p.class === 'swimming_pool' ? null : area(p.class === 'ocean' ? K.SEA : K.WATER, p.class === 'ocean' ? 12 : 11)));
  each('waterway', (p, ty) => (ty !== 2 || p.brunnel === 'tunnel' ? null : line(K.WATER, p.class === 'river' || p.class === 'canal' ? 14 : 4)));
  each('transportation', (p, ty) => {
    if (p.brunnel === 'tunnel' || String(p.class).endsWith('_construction')) return null;
    const c = String(p.class);
    const bridge = p.brunnel === 'bridge';
    if (ty === 3) return c === 'path' ? area(K.PLAZA, 10) : null;
    if (c === 'rail') return line(K.RAIL, 4, bridge);
    if (c === 'transit') return p.subclass === 'subway' ? null : line(K.RAIL, 3, bridge);
    if (c === 'path') return line(K.PATH, 2.5, bridge);
    const w = ROAD_W[c];
    return w ? line(w >= 15 ? K.ROAD_BIG : K.ROAD, w, bridge) : null;
  });
  // Semilla de color de cada edificio (por su primer vértice)
  for (const f of out) if (f.k === 0) f.seed = Math.abs(Math.sin(f.rings[0][0] * 12.9898 + f.rings[0][1] * 78.233) * 43758.5453) % 1;
  return out;
}

// ---------------------------------------------------------------- Rasterizado
interface Grid {
  x0: number;
  z0: number;
  cell: number;
  n: number;
}

function fillPoly(rings: Float64Array[], g: Grid, fn: (k: number) => void) {
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  const o = rings[0];
  for (let i = 0; i < o.length; i += 2) {
    minX = Math.min(minX, o[i]);
    maxX = Math.max(maxX, o[i]);
    minZ = Math.min(minZ, o[i + 1]);
    maxZ = Math.max(maxZ, o[i + 1]);
  }
  if (maxX < g.x0 || minX > g.x0 + g.n * g.cell || maxZ < g.z0 || minZ > g.z0 + g.n * g.cell) return;
  const j0 = Math.max(0, Math.floor((minZ - g.z0) / g.cell));
  const j1 = Math.min(g.n - 1, Math.ceil((maxZ - g.z0) / g.cell));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const zc = g.z0 + (j + 0.5) * g.cell;
    xs.length = 0;
    for (const r of rings) {
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const ax = r[i * 2];
        const az = r[i * 2 + 1];
        const k2 = ((i + 1) % n) * 2;
        const bx = r[k2];
        const bz = r[k2 + 1];
        if (az <= zc !== bz <= zc) xs.push(ax + ((zc - az) / (bz - az)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.cell - 0.5));
      const i1 = Math.min(g.n - 1, Math.floor((xs[k + 1] - g.x0) / g.cell - 0.5));
      for (let i = i0; i <= i1; i++) fn(j * g.n + i);
    }
  }
}

function strokeLine(pts: Float64Array, w: number, g: Grid, fn: (k: number) => void) {
  const r = Math.max(g.cell * 0.5, w / 2);
  const lim = g.n * g.cell;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const az = pts[i + 1];
    const bx = pts[i + 2];
    const bz = pts[i + 3];
    if (Math.max(ax, bx) < g.x0 - r || Math.min(ax, bx) > g.x0 + lim + r || Math.max(az, bz) < g.z0 - r || Math.min(az, bz) > g.z0 + lim + r) continue;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const px = ax + ((bx - ax) * s) / steps;
      const pz = az + ((bz - az) * s) / steps;
      const ia = Math.max(0, Math.floor((px - r - g.x0) / g.cell));
      const ib = Math.min(g.n - 1, Math.floor((px + r - g.x0) / g.cell));
      const ja = Math.max(0, Math.floor((pz - r - g.z0) / g.cell));
      const jb = Math.min(g.n - 1, Math.floor((pz + r - g.z0) / g.cell));
      for (let j = ja; j <= jb; j++)
        for (let ii = ia; ii <= ib; ii++) {
          const cx = g.x0 + (ii + 0.5) * g.cell - px;
          const cz = g.z0 + (j + 0.5) * g.cell - pz;
          if (cx * cx + cz * cz <= r * r) fn(j * g.n + ii);
        }
    }
  }
}

function styleFor(h: number) {
  if (h > 70) return S.GLASS;
  if (h > 38) return S.OFFICE;
  if (h < 9) return S.HOUSE;
  return S.RESID;
}

/** Teselas (x, y) de zoom z que cubren una caja de latitud/longitud */
function tilesFor(s: number, w: number, n: number, e: number, z: number) {
  const out: [number, number][] = [];
  for (let x = Math.floor(lon2tile(w, z)); x <= Math.floor(lon2tile(e, z)); x++) for (let y = Math.floor(lat2tile(n, z)); y <= Math.floor(lat2tile(s, z)); y++) out.push([x, y]);
  return out;
}

async function region(rx: number, rz: number): Promise<WorkOut> {
  const x0 = rx * REGION;
  const z0 = rz * REGION;
  let s = 90;
  let n = -90;
  let w = 180;
  let e = -180;
  for (const [fx, fz] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
    const [la, lo] = geo.toLatLon(x0 + fx * REGION, z0 + fz * REGION);
    s = Math.min(s, la);
    n = Math.max(n, la);
    w = Math.min(w, lo);
    e = Math.max(e, lo);
  }
  const m = 0.002;
  // Relieve
  const demZ = 12;
  const demTiles = new Map<string, Float32Array | null>();
  await Promise.all(tilesFor(s - m, w - m, n + m, e + m, demZ).map(async ([x, y]) => demTiles.set(`${x},${y}`, await dem(demZ, x, y))));
  const elev = new Float32Array(NE * NE);
  const rawE = new Float32Array(NE * NE);
  for (let j = 0; j < NE; j++)
    for (let i = 0; i < NE; i++) {
      const [la, lo] = geo.toLatLon(x0 + i * CELL_E, z0 + j * CELL_E);
      rawE[j * NE + i] = demAt(demTiles, demZ, la, lo);
      elev[j * NE + i] = Math.max(0, rawE[j * NE + i]);
    }
  // OpenStreetMap
  const feats = (await Promise.all(tilesFor(s - m, w - m, n + m, e + m, 14).map(([x, y]) => tileFeats(x, y)))).flat();
  const gc: Grid = { x0, z0, cell: CELL_C, n: NC };
  const cls = new Uint8Array(NC * NC).fill(K.COUNTRY);
  const areas = feats.filter((f) => f.k === 1).sort((a, b) => a.prio - b.prio);
  for (const f of areas) fillPoly(f.rings, gc, (k) => (cls[k] = f.c));
  // Mar abierto sin polígono (teselas vacías): donde el relieve está bajo el nivel del mar
  const r = CELL_C / CELL_E;
  for (let j = 0; j < NC; j++)
    for (let i = 0; i < NC; i++) {
      const k = j * NC + i;
      if (cls[k] === K.COUNTRY && rawE[Math.floor(j * r) * NE + Math.floor(i * r)] < -2) cls[k] = K.SEA;
    }
  const lines = feats.filter((f) => f.k === 2);
  // Agua lineal (ríos y arroyos) y vías de tren, luego carreteras
  for (const f of lines) if (f.c === K.WATER || f.c === K.RAIL) strokeLine(f.rings[0], f.w, gc, (k) => (cls[k] = f.c));
  for (const f of lines) {
    if (f.c === K.WATER || f.c === K.RAIL) continue;
    strokeLine(f.rings[0], f.w, gc, (k) => {
      const c = cls[k];
      if (f.c === K.PATH && (c === K.ROAD || c === K.ROAD_BIG || c === K.WATER || c === K.SEA)) return;
      if ((c === K.SEA || c === K.WATER) && !f.bridge && f.w < 40) return;
      cls[k] = f.c;
    });
  }
  // Edificios: celdas de 4 m y cajas por manzanas de 80 m
  const NB = REGION / CELL_B;
  const gb: Grid = { x0, z0, cell: CELL_B, n: NB };
  const bh = new Float32Array(NB * NB);
  const bm = new Float32Array(NB * NB);
  const bs = new Float32Array(NB * NB).fill(-1);
  for (const f of feats) {
    if (f.k !== 0) continue;
    const h = Math.max(4, Math.round(f.h / 4) * 4);
    const mh = Math.round(f.mh / 4) * 4;
    fillPoly(f.rings, gb, (k) => {
      if (bs[k] >= 0 && bh[k] >= h) return;
      bh[k] = h;
      bm[k] = mh;
      bs[k] = f.seed;
    });
  }
  const per = 80 / CELL_B;
  const used = new Uint8Array(NB * NB);
  const rects: number[] = [];
  const same = (a: number, b: number) => bs[b] >= 0 && bh[a] === bh[b] && bm[a] === bm[b];
  for (let j = 0; j < NB; j++)
    for (let i = 0; i < NB; i++) {
      const k = j * NB + i;
      if (used[k] || bs[k] < 0 || bh[k] - bm[k] < 0.5) continue;
      const iMax = (Math.floor(i / per) + 1) * per;
      const jMax = (Math.floor(j / per) + 1) * per;
      let ww = 1;
      while (i + ww < iMax && !used[k + ww] && same(k, k + ww)) ww++;
      let d = 1;
      outer: while (j + d < jMax) {
        for (let a = 0; a < ww; a++) {
          const kk = (j + d) * NB + i + a;
          if (used[kk] || !same(k, kk)) break outer;
        }
        d++;
      }
      for (let b = 0; b < d; b++) for (let a = 0; a < ww; a++) used[(j + b) * NB + i + a] = 1;
      rects.push(x0 + i * CELL_B, z0 + j * CELL_B, x0 + (i + ww) * CELL_B, z0 + (j + d) * CELL_B, bh[k], bm[k], styleFor(bh[k]), bs[k]);
    }
  return { type: 'region', rx, rz, elev, cls, rects: new Float32Array(rects) };
}

// ---------------------------------------------------------------- Teselas lejanas (z10)
async function coarse(x: number, y: number): Promise<WorkOut> {
  const z = COARSE_Z;
  const [d, vt] = await Promise.all([dem(z, x, y), vectorTile(z, x, y).catch(() => null)]);
  const T = COARSE_TEX;
  const el = d ?? new Float32Array(256 * 256);
  const at = (px: number, py: number) => el[Math.min(255, Math.max(0, py)) * 256 + Math.min(255, Math.max(0, px))];
  const N = COARSE_N;
  const raw = new Float32Array(N * N);
  const low = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const px = Math.round((i / (N - 1)) * 255);
      const py = Math.round((j / (N - 1)) * 255);
      raw[j * N + i] = Math.max(0, at(px, py));
      // Por debajo de lo que dibuja el detalle: mínimo del entorno
      let mn = Infinity;
      for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) mn = Math.min(mn, at(px + a, py + b));
      low[j * N + i] = Math.max(0, mn) - 14;
    }
  // Textura: color por altura con sombreado del relieve y encima bosques, ciudades y agua
  const c = new OffscreenCanvas(T, T);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.createImageData(T, T);
  for (let py = 0; py < T; py++)
    for (let px = 0; px < T; px++) {
      const e = at(px, py);
      let col: [number, number, number];
      if (e <= 0.5) col = [44, 98, 168];
      else if (e < 250) col = [104, 146, 74];
      else if (e < 700) col = [112, 142, 78];
      else if (e < 1400) col = [126, 134, 84];
      else if (e < 2100) col = [128, 118, 96];
      else if (e < 2700) col = [138, 134, 130];
      else col = [236, 240, 248];
      const sh = e <= 0.5 ? 1 : Math.min(1.35, Math.max(0.6, 1 + ((at(px - 1, py) - at(px + 1, py)) * 0.7 + (at(px, py - 1) - at(px, py + 1))) * 0.006));
      const o = (py * T + px) * 4;
      img.data[o] = Math.min(255, col[0] * sh);
      img.data[o + 1] = Math.min(255, col[1] * sh);
      img.data[o + 2] = Math.min(255, col[2] * sh);
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  if (vt) {
    const draw = (layer: string, style: (p: Record<string, unknown>, type: number) => { fill?: string; stroke?: string; w?: number } | null) => {
      const L = vt.layers[layer];
      if (!L) return;
      const k = T / L.extent;
      for (let i = 0; i < L.length; i++) {
        const f = L.feature(i);
        const st = style(f.properties as Record<string, unknown>, f.type);
        if (!st) continue;
        ctx.beginPath();
        for (const ring of f.loadGeometry()) {
          ring.forEach((p, n) => (n ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)));
          if (f.type === 3) ctx.closePath();
        }
        if (st.fill && f.type === 3) {
          ctx.fillStyle = st.fill;
          ctx.fill('evenodd');
        }
        if (st.stroke) {
          ctx.strokeStyle = st.stroke;
          ctx.lineWidth = st.w ?? 1;
          ctx.stroke();
        }
      }
    };
    draw('landcover', (p) => {
      const c2 = p.class;
      if (c2 === 'wood') return { fill: 'rgba(42, 96, 46, 0.82)' };
      if (c2 === 'grass') return { fill: 'rgba(112, 166, 82, 0.5)' };
      if (c2 === 'farmland') return { fill: 'rgba(186, 176, 108, 0.45)' };
      if (c2 === 'ice') return { fill: 'rgba(240, 244, 250, 0.95)' };
      if (c2 === 'rock') return { fill: 'rgba(140, 134, 128, 0.7)' };
      if (c2 === 'sand') return { fill: 'rgba(222, 206, 150, 0.9)' };
      return null;
    });
    draw('landuse', (p) => {
      const c2 = String(p.class);
      if (['residential', 'suburb', 'neighbourhood', 'quarter', 'commercial', 'retail'].includes(c2)) return { fill: 'rgba(150, 144, 138, 0.88)' };
      if (['industrial', 'railway', 'garages', 'quarry'].includes(c2)) return { fill: 'rgba(138, 136, 148, 0.88)' };
      return null;
    });
    draw('water', (p) => (p.class === 'swimming_pool' ? null : { fill: 'rgb(44, 98, 168)' }));
    draw('waterway', (p, ty) => (ty === 2 && (p.class === 'river' || p.class === 'canal') ? { stroke: 'rgb(52, 108, 178)', w: 1.2 } : null));
    draw('transportation', (p, ty) => (ty === 2 && (p.class === 'motorway' || p.class === 'trunk') ? { stroke: 'rgba(70, 70, 78, 0.85)', w: 0.9 } : null));
    draw('aeroway', (p, ty) => (ty === 2 && p.class === 'runway' ? { stroke: 'rgb(60, 60, 66)', w: 1.5 } : null));
  }
  const rgba = ctx.getImageData(0, 0, T, T).data;
  return { type: 'coarse', x, y, raw, low, rgba };
}

// ---------------------------------------------------------------- Mensajes
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (ev: MessageEvent<WorkIn>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    geo = new Geo(msg.lat0, msg.lon0);
    featCache.clear();
    return;
  }
  try {
    if (msg.type === 'region') {
      const r = (await region(msg.rx, msg.rz)) as Extract<WorkOut, { type: 'region' }>;
      scope.postMessage(r, [r.elev.buffer, r.cls.buffer, r.rects.buffer]);
    } else {
      const r = (await coarse(msg.x, msg.y)) as Extract<WorkOut, { type: 'coarse' }>;
      scope.postMessage(r, [r.raw.buffer, r.low.buffer, r.rgba.buffer]);
    }
  } catch (e) {
    const err = (e as Error).message || 'error';
    if (msg.type === 'region') scope.postMessage({ type: 'region', rx: msg.rx, rz: msg.rz, elev: new Float32Array(0), cls: new Uint8Array(0), rects: new Float32Array(0), error: err });
    else scope.postMessage({ type: 'coarse', x: msg.x, y: msg.y, raw: new Float32Array(0), low: new Float32Array(0), rgba: new Uint8ClampedArray(0), error: err });
  }
};
