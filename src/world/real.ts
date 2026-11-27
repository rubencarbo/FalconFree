import { gunzipSync } from 'fflate';

/** Clases de suelo de los mapas reales (deben coincidir con tools/realmaps/build.mjs) */
export const RC = {
  URBAN: 0,
  WATER: 1,
  PARK: 2,
  FOREST: 3,
  SAND: 4,
  ROAD: 5,
  ROAD_BIG: 6,
  PATH: 7,
  RAIL: 8,
  PITCH: 9,
  PLAZA: 10,
  PARKING: 11,
  FIELD: 12,
  ROCK: 13,
  GLACIER: 14,
  SCRUB: 15,
  INDUSTRIAL: 16,
  CEMETERY: 17,
  SEA: 18,
  /** fuera del mapa */
  OUT: 255,
} as const;

export interface RealHeader {
  v: number;
  id: string;
  center: [number, number];
  x0: number;
  z0: number;
  w: number;
  h: number;
  rot: number;
  scale: number;
  base: number;
  elev: { cell: number; nx: number; nz: number };
  cls: { cell: number; nx: number; nz: number };
  bld: { cell: number; n: number };
  trees: number;
  attribution: string;
}

/** Caja de edificio en coordenadas del mundo (sin la base del terreno) */
export interface RealRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** altura total y altura mínima (m) sobre el suelo */
  h: number;
  minH: number;
  style: number;
  seed: number;
}

const PERIOD = 80;
const key = (bx: number, bz: number) => (bx + 32768) * 65536 + (bz + 32768);

/** Mapa real descargado: relieve, clases de suelo, edificios y árboles */
export class RealMap {
  readonly elev: Int16Array;
  readonly cls: Uint8Array;
  private rects: RealRect[] = [];
  private byBlock = new Map<number, number[]>();
  private treeBlock = new Map<number, number[]>();
  private trees: Int16Array;

  constructor(
    readonly hd: RealHeader,
    buf: ArrayBuffer,
    offset: number,
  ) {
    let o = offset;
    const take = <T>(make: (b: ArrayBuffer, o: number, n: number) => T, n: number, bytes: number) => {
      const v = make(buf, o, n);
      o += Math.ceil((n * bytes) / 4) * 4;
      return v;
    };
    const ne = hd.elev.nx * hd.elev.nz;
    this.elev = take((b, oo, n) => new Int16Array(b, oo, n), ne, 2);
    this.cls = take((b, oo, n) => new Uint8Array(b, oo, n), hd.cls.nx * hd.cls.nz, 1);
    const nR = hd.bld.n;
    const rI = take((b, oo, n) => new Uint16Array(b, oo, n), nR * 4, 2);
    const rH = take((b, oo, n) => new Uint16Array(b, oo, n), nR * 2, 2);
    const rS = take((b, oo, n) => new Uint8Array(b, oo, n), nR, 1);
    const rSeed = take((b, oo, n) => new Uint16Array(b, oo, n), nR, 2);
    this.trees = take((b, oo, n) => new Int16Array(b, oo, n), hd.trees * 2, 2);
    const c = hd.bld.cell;
    for (let n = 0; n < nR; n++) {
      const x0 = hd.x0 + rI[n * 4] * c;
      const z0 = hd.z0 + rI[n * 4 + 1] * c;
      const r: RealRect = { x0, z0, x1: x0 + rI[n * 4 + 2] * c, z1: z0 + rI[n * 4 + 3] * c, h: rH[n * 2] / 10, minH: rH[n * 2 + 1] / 10, style: rS[n], seed: rSeed[n] / 65536 };
      this.rects.push(r);
      // En todas las manzanas que toca (para los choques)
      const bx0 = Math.floor((r.x0 + 0.01) / PERIOD), bx1 = Math.floor((r.x1 - 0.01) / PERIOD);
      const bz0 = Math.floor((r.z0 + 0.01) / PERIOD), bz1 = Math.floor((r.z1 - 0.01) / PERIOD);
      for (let i = bx0; i <= bx1; i++)
        for (let j = bz0; j <= bz1; j++) {
          const k = key(i, j);
          let l = this.byBlock.get(k);
          if (!l) this.byBlock.set(k, (l = []));
          l.push(n);
        }
    }
    for (let n = 0; n < hd.trees; n++) {
      const k = key(Math.floor(this.trees[n * 2] / 2 / PERIOD), Math.floor(this.trees[n * 2 + 1] / 2 / PERIOD));
      let l = this.treeBlock.get(k);
      if (!l) this.treeBlock.set(k, (l = []));
      l.push(n);
    }
  }

  static async load(id: string): Promise<RealMap> {
    const base = import.meta.env.BASE_URL || './';
    // En el artefacto de prueba los mapas se publican como .wasm (el visor no sirve .dat)
    const ext = import.meta.env.VITE_ARTIFACT === '1' ? 'wasm' : 'dat';
    const r = await fetch(`${base}real/${id}.${ext}`);
    if (!r.ok) throw new Error(`No se pudo descargar el mapa (${r.status})`);
    const gz = new Uint8Array(await r.arrayBuffer());
    // El servidor puede haberlo descomprimido ya (Content-Encoding): gzip empieza por 1f 8b
    const raw = gz[0] === 0x1f && gz[1] === 0x8b ? gunzipSync(gz) : gz;
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const len = new DataView(buf).getUint32(0, true);
    const hd = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)).replace(/\0+$/, '')) as RealHeader;
    return new RealMap(hd, buf, 4 + len);
  }

  /** Latitud/longitud -> posición en el mundo del juego (x, z) */
  toWorld(lat: number, lon: number): [number, number] {
    const [lat0, lon0] = this.hd.center;
    const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
    const e = (lon - lon0) * kx;
    const n = (lat - lat0) * 110574;
    const r = (-this.hd.rot * Math.PI) / 180;
    const u = e * Math.cos(r) - n * Math.sin(r);
    const v = e * Math.sin(r) + n * Math.cos(r);
    return [u * this.hd.scale, -v * this.hd.scale];
  }

  /** ¿Dentro del mapa (con margen en metros)? */
  inside(x: number, z: number, margin = 0) {
    const h = this.hd;
    return x >= h.x0 - margin && x <= h.x0 + h.w + margin && z >= h.z0 - margin && z <= h.z0 + h.h + margin;
  }

  /** Distancia (m) fuera del borde del mapa (0 si está dentro) */
  outside(x: number, z: number) {
    const h = this.hd;
    const dx = Math.max(h.x0 - x, 0, x - (h.x0 + h.w));
    const dz = Math.max(h.z0 - z, 0, z - (h.z0 + h.h));
    return Math.hypot(dx, dz);
  }

  /** Altura del terreno (m) con interpolación bilineal; fuera del mapa baja suavemente */
  ground(x: number, z: number): number {
    const e = this.hd.elev;
    const fx = Math.min(e.nx - 1.0001, Math.max(0, (x - this.hd.x0) / e.cell));
    const fz = Math.min(e.nz - 1.0001, Math.max(0, (z - this.hd.z0) / e.cell));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const ax = fx - i;
    const az = fz - j;
    const a = this.elev;
    const n = e.nx;
    const v = ((a[j * n + i] * (1 - ax) + a[j * n + i + 1] * ax) * (1 - az) + (a[(j + 1) * n + i] * (1 - ax) + a[(j + 1) * n + i + 1] * ax) * az) / 4;
    const out = this.outside(x, z);
    return out > 0 ? v * Math.max(0, 1 - out / 1500) : v;
  }

  /** Clase de suelo en (x, z) */
  clsAt(x: number, z: number): number {
    const c = this.hd.cls;
    const i = Math.floor((x - this.hd.x0) / c.cell);
    const j = Math.floor((z - this.hd.z0) / c.cell);
    if (i < 0 || j < 0 || i >= c.nx || j >= c.nz) return RC.OUT;
    return this.cls[j * c.nx + i];
  }

  /** Edificios que tocan una manzana de 80 m */
  rectsIn(bx: number, bz: number): RealRect[] {
    const l = this.byBlock.get(key(bx, bz));
    return l ? l.map((n) => this.rects[n]) : [];
  }

  /** Árboles (de OpenStreetMap) de una manzana */
  treesIn(bx: number, bz: number): [number, number][] {
    const l = this.treeBlock.get(key(bx, bz));
    return l ? l.map((n) => [this.trees[n * 2] / 2, this.trees[n * 2 + 1] / 2]) : [];
  }
}

/** Mapas reales ya descargados (por id) */
const cache = new Map<string, RealMap>();
const pending = new Map<string, Promise<RealMap>>();

export function realMap(id: string): RealMap | null {
  return cache.get(id) ?? null;
}

export function loadRealMap(id: string): Promise<RealMap> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(id);
  if (!p) {
    p = RealMap.load(id).then(
      (m) => {
        cache.set(id, m);
        pending.delete(id);
        return m;
      },
      (e) => {
        pending.delete(id);
        throw e;
      },
    );
    pending.set(id, p);
  }
  return p;
}
