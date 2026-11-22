import type { Stage } from '../stages';
import { fbm, hash2, hash3, mulberry32 } from './noise';

/** Ancho de calle (m) */
export const ROAD = 16;
/** Periodo de la cuadrícula: calle + manzana (m) */
export const PERIOD = 80;
export const BLOCK = PERIOD - ROAD;
export const CHUNK_BLOCKS = 4;
/** Tamaño de un chunk (m) */
export const CHUNK = PERIOD * CHUNK_BLOCKS;
/** Cada cuántas calles hay una avenida principal (con puente sobre el agua) */
export const AVENUE_EVERY = 5;

/** Estilos de edificio (el shader dibuja fachada y tejado según el estilo) */
export const S_OFFICE = 0;
export const S_GLASS = 1;
export const S_RESID = 2;
export const S_INDUST = 3;
export const S_DETAIL = 4;
export const S_HOUSE = 5;
export const S_DECO = 6;
export const S_ROOF = 7;

/** Caja apoyada en el suelo (y de 0 a h) o flotante si y0 > 0 */
export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  h: number;
  color: number;
  /** Estilo de edificio (S_*) */
  style?: number;
  /** Aleatorio 0..1 propio del edificio */
  seed?: number;
}

export type BlockKind = 'buildings' | 'park' | 'plaza' | 'parking' | 'sports';

export interface BlockData {
  kind: BlockKind;
  park: boolean;
  buildings: Box[];
  trees: Box[];
  /** Balizas rojas (antenas y azoteas muy altas) */
  lights: { x: number; y: number; z: number }[];
  maxH: number;
}

export type RingKind = 'normal' | 'ammo' | 'repair' | 'missile' | 'turbo' | 'gold' | 'sea';

export interface RingSpawn {
  id: string;
  kind: RingKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export class CityGen {
  private blockCache = new Map<number, BlockData>();
  private treeColors: number[];

  constructor(public readonly stage: Stage) {
    this.treeColors = stage.palette.tree.map(hexToInt);
  }

  /** Valor bruto del ruido de agua (menor = más profundo) */
  waterValue(x: number, z: number): number {
    const s = this.stage.waterScale;
    // Distorsión ligera para costas más orgánicas
    const wx = x + (fbm(x / 400, z / 400, this.stage.seed + 7, 2) - 0.5) * 300;
    const wz = z + (fbm(x / 400, z / 400, this.stage.seed + 8, 2) - 0.5) * 300;
    return fbm(wx / s, wz / s, this.stage.seed, 4);
  }

  isWater(x: number, z: number): boolean {
    return this.waterValue(x, z) < this.stage.waterLevel;
  }

  /** Factor 0..1 de "centro urbano" (rascacielos) */
  downtown(x: number, z: number): number {
    const v = fbm(x / 2600, z / 2600, this.stage.seed + 99, 3);
    return clamp01((v - 0.52) / 0.2);
  }

  isAvenue(index: number): boolean {
    return ((index % AVENUE_EVERY) + AVENUE_EVERY) % AVENUE_EVERY === 0;
  }

  block(bx: number, bz: number): BlockData {
    const key = (bx + 32768) * 65536 + (bz + 32768);
    let b = this.blockCache.get(key);
    if (b) return b;
    if (this.blockCache.size > 6000) this.blockCache.clear();
    b = this.genBlock(bx, bz);
    this.blockCache.set(key, b);
    return b;
  }

  private genBlock(bx: number, bz: number): BlockData {
    const st = this.stage;
    const rand = mulberry32(Math.floor(hash2(bx, bz, st.seed) * 4294967296));
    const x0 = bx * PERIOD + ROAD;
    const z0 = bz * PERIOD + ROAD;
    const buildings: Box[] = [];
    const trees: Box[] = [];
    const lights: { x: number; y: number; z: number }[] = [];
    const cx = x0 + BLOCK / 2;
    const cz = z0 + BLOCK / 2;
    const dt = this.downtown(cx, cz);
    const out: BlockData = { kind: 'buildings', park: false, buildings, trees, lights, maxH: 0 };

    // Tipo de manzana
    const kr = rand();
    const dry = !this.isWater(cx, cz) && !this.isWater(x0, z0) && !this.isWater(x0 + BLOCK, z0 + BLOCK);
    if (kr < st.parkChance) out.kind = 'park';
    else if (dry && kr < st.parkChance + 0.04 + dt * 0.05) out.kind = 'plaza';
    else if (dry && kr < st.parkChance + 0.1 && dt < 0.5) out.kind = 'parking';
    else if (dry && kr < st.parkChance + 0.13 && dt < 0.3) out.kind = 'sports';
    out.park = out.kind === 'park';

    if (out.kind === 'park') {
      const n = 10 + Math.floor(rand() * 14);
      for (let i = 0; i < n; i++) {
        const tx = x0 + 4 + rand() * (BLOCK - 8);
        const tz = z0 + 4 + rand() * (BLOCK - 8);
        if (this.isWater(tx, tz)) continue;
        trees.push(this.tree(tx, tz, rand));
      }
      return out;
    }
    if (out.kind === 'plaza') {
      // Árboles alineados alrededor de la plaza y un quiosco
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        trees.push(this.tree(cx + Math.cos(a) * 24, cz + Math.sin(a) * 24, rand));
      }
      return out;
    }
    if (out.kind === 'parking') {
      const c = this.styleColor(S_DETAIL, rand);
      buildings.push({ x0: cx - 3, z0: z0 + 4, x1: cx + 3, z1: z0 + 9, y0: 0, h: 3, color: c, style: S_DETAIL, seed: rand() });
      out.maxH = 3;
      return out;
    }
    if (out.kind === 'sports') return out;

    const r = rand();
    const n = dt > 0.6 && r < 0.4 ? 1 : r < 0.55 ? 2 : 3;
    const lot = BLOCK / n;
    const inset = n === 1 ? 5 : 3;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const lx0 = x0 + i * lot;
        const lz0 = z0 + j * lot;
        if (
          this.isWater(lx0, lz0) ||
          this.isWater(lx0 + lot, lz0) ||
          this.isWater(lx0, lz0 + lot) ||
          this.isWater(lx0 + lot, lz0 + lot) ||
          this.isWater(lx0 + lot / 2, lz0 + lot / 2)
        ) {
          continue;
        }
        if (rand() < 0.07) {
          for (let k = 0; k < 3; k++) trees.push(this.tree(lx0 + 4 + rand() * (lot - 8), lz0 + 4 + rand() * (lot - 8), rand));
          continue;
        }
        this.genLot(lx0, lz0, lot, inset, dt, rand, out);
      }
    }
    return out;
  }

  /** Elige un arquetipo y construye el solar */
  private genLot(lx0: number, lz0: number, lot: number, inset: number, dt: number, rand: () => number, out: BlockData) {
    const st = this.stage;
    const t = rand();
    let style: number;
    if (dt > 0.55) style = t < 0.35 ? S_GLASS : t < 0.5 ? S_DECO : t < 0.85 ? S_OFFICE : S_RESID;
    else if (dt > 0.18) style = t < 0.45 ? S_OFFICE : t < 0.6 ? S_GLASS : S_RESID;
    else style = t < 0.42 ? S_RESID : t < 0.62 && lot < 40 ? S_HOUSE : t < 0.78 ? S_INDUST : S_OFFICE;

    const push = (b: Box) => {
      out.buildings.push(b);
      out.maxH = Math.max(out.maxH, b.h);
    };
    const snap = (h: number) => Math.max(4, Math.round(h / 3.5) * 3.5);
    const seed = rand();

    if (style === S_HOUSE) {
      // Cuatro casas con tejado a dos aguas (cuerpo + cumbrera)
      const half = lot / 2;
      for (let a = 0; a < 2; a++)
        for (let b = 0; b < 2; b++) {
          if (rand() < 0.15) continue;
          const hx0 = lx0 + a * half + 3 + rand() * 2;
          const hz0 = lz0 + b * half + 3 + rand() * 2;
          const hx1 = lx0 + (a + 1) * half - 3 - rand() * 2;
          const hz1 = lz0 + (b + 1) * half - 3 - rand() * 2;
          const h = 5 + Math.floor(rand() * 2) * 3;
          const wall = this.styleColor(S_HOUSE, rand);
          const roof = this.roofColor(rand);
          push({ x0: hx0, z0: hz0, x1: hx1, z1: hz1, y0: 0, h, color: wall, style: S_HOUSE, seed: rand() });
          const alongX = hx1 - hx0 > hz1 - hz0;
          const w = alongX ? (hz1 - hz0) * 0.3 : (hx1 - hx0) * 0.3;
          const mx = (hx0 + hx1) / 2;
          const mz = (hz0 + hz1) / 2;
          // Faldones escalonados que simulan el tejado inclinado
          push(alongX
            ? { x0: hx0 - 0.4, z0: hz0 - 0.4, x1: hx1 + 0.4, z1: hz1 + 0.4, y0: 0, h: h + 1, color: roof, style: S_ROOF, seed: 0.2 }
            : { x0: hx0 - 0.4, z0: hz0 - 0.4, x1: hx1 + 0.4, z1: hz1 + 0.4, y0: 0, h: h + 1, color: roof, style: S_ROOF, seed: 0.2 });
          push(alongX
            ? { x0: hx0 - 0.4, z0: mz - w, x1: hx1 + 0.4, z1: mz + w, y0: 0, h: h + 2.6, color: roof, style: S_ROOF, seed: 0.6 }
            : { x0: mx - w, z0: hz0 - 0.4, x1: mx + w, z1: hz1 + 0.4, y0: 0, h: h + 2.6, color: roof, style: S_ROOF, seed: 0.6 });
        }
      return;
    }

    const shrink = style === S_INDUST ? 0 : rand() * lot * 0.18;
    const bx0 = lx0 + inset + shrink * rand();
    const bz0 = lz0 + inset + shrink * rand();
    const bx1 = lx0 + lot - inset - shrink * rand();
    const bz1 = lz0 + lot - inset - shrink * rand();
    const mx = (bx0 + bx1) / 2;
    const mz = (bz0 + bz1) / 2;
    const color = this.styleColor(style, rand);
    let h: number;

    switch (style) {
      case S_GLASS:
        h = snap((32 + dt * Math.pow(rand(), 1.8) * 200) * st.heightMul);
        break;
      case S_DECO:
        h = snap((30 + dt * rand() * 80) * st.heightMul);
        break;
      case S_RESID:
        h = snap((10 + rand() * 24 + dt * rand() * 40) * st.heightMul);
        break;
      case S_INDUST:
        h = snap(6 + rand() * 7);
        break;
      default:
        h = snap((14 + rand() * 26 + dt * Math.pow(rand(), 2) * 120) * st.heightMul);
    }
    push({ x0: bx0, z0: bz0, x1: bx1, z1: bz1, y0: 0, h, color, style, seed });

    const w = bx1 - bx0;
    const d = bz1 - bz0;
    if (style === S_DECO) {
      // Rascacielos escalonado: dos o tres cuerpos más estrechos y una aguja
      let hh = h;
      let k = 0.18;
      const tiers = 2 + Math.floor(rand() * 2);
      for (let tIdx = 0; tIdx < tiers; tIdx++) {
        hh = snap(hh * (1.25 + rand() * 0.2));
        push({ x0: bx0 + w * k, z0: bz0 + d * k, x1: bx1 - w * k, z1: bz1 - d * k, y0: 0, h: hh, color, style: S_DECO, seed });
        k += 0.11;
      }
      const sh = hh + 18 + rand() * 25;
      push({ x0: mx - 0.9, z0: mz - 0.9, x1: mx + 0.9, z1: mz + 0.9, y0: 0, h: sh, color: 0xd8d8d8, style: S_DETAIL, seed });
      out.lights.push({ x: mx, y: sh + 0.6, z: mz });
      return;
    }
    if (style === S_GLASS) {
      if (h > 60 && rand() < 0.5) {
        // Segundo volumen escalonado
        const k = 0.15 + rand() * 0.1;
        const h2 = snap(h * (1.15 + rand() * 0.3));
        push({ x0: bx0 + w * k, z0: bz0 + d * k, x1: bx1 - w * k, z1: bz1 - d * k, y0: 0, h: h2, color, style: S_GLASS, seed });
        h = h2;
      }
      if (h > 110 && rand() < 0.55) {
        const ah = h + 14 + rand() * 22;
        push({ x0: mx - 0.7, z0: mz - 0.7, x1: mx + 0.7, z1: mz + 0.7, y0: 0, h: ah, color: 0xcccccc, style: S_DETAIL, seed });
        out.lights.push({ x: mx, y: ah + 0.6, z: mz });
      } else if (h > 90) {
        out.lights.push({ x: bx0 + 1, y: h + 0.6, z: bz0 + 1 }, { x: bx1 - 1, y: h + 0.6, z: bz1 - 1 });
      }
      return;
    }
    if (style === S_OFFICE || style === S_RESID) {
      // Equipos en la azotea: aire acondicionado, depósitos de agua, casetas
      const n = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const ux = bx0 + 3 + rand() * Math.max(1, w - 6);
        const uz = bz0 + 3 + rand() * Math.max(1, d - 6);
        const s = 1.2 + rand() * 2.2;
        push({ x0: ux - s, z0: uz - s, x1: ux + s, z1: uz + s, y0: 0, h: h + 1.5 + rand() * 2.5, color: rand() < 0.5 ? 0x9aa0a8 : 0x6f7680, style: S_DETAIL, seed: rand() });
      }
      if (style === S_OFFICE && h > 60 && rand() < 0.5) {
        const k = 0.2;
        const h2 = snap(h * (1.1 + rand() * 0.25));
        push({ x0: bx0 + w * k, z0: bz0 + d * k, x1: bx1 - w * k, z1: bz1 - d * k, y0: 0, h: h2, color, style: S_OFFICE, seed });
        if (h2 > 90) out.lights.push({ x: mx, y: h2 + 0.6, z: mz });
      }
    }
  }

  /** Color según el estilo (más oscuro y frío de noche) */
  private styleColor(style: number, rand: () => number): number {
    const pal = STYLE_PALETTES[style] ?? this.stage.palette.buildings;
    const list = style === S_OFFICE ? this.stage.palette.buildings : pal;
    let c = hexToInt(list[Math.floor(rand() * list.length)]);
    if (this.stage.night && style !== S_OFFICE) c = mixInt(c, 0x1a2040, 0.5);
    return c;
  }

  private roofColor(rand: () => number): number {
    const list = ['#b04a3a', '#8a3a2e', '#6a6a72', '#4a5a6a', '#9a5a3a', '#3e4a3a'];
    let c = hexToInt(list[Math.floor(rand() * list.length)]);
    if (this.stage.night) c = mixInt(c, 0x1a2040, 0.5);
    return c;
  }

  private tree(x: number, z: number, rand: () => number): Box {
    const s = 2.5 + rand() * 3;
    return {
      x0: x - s / 2,
      z0: z - s / 2,
      x1: x + s / 2,
      z1: z + s / 2,
      y0: 0.5 + rand(),
      h: s * (1 + rand() * 0.6),
      color: this.treeColors[Math.floor(rand() * this.treeColors.length)],
    };
  }

  /** Altura del obstáculo más alto en (x, z). 0 = suelo/agua. */
  heightAt(x: number, z: number): number {
    const bx = Math.floor(x / PERIOD);
    const bz = Math.floor(z / PERIOD);
    const lx = x - bx * PERIOD;
    const lz = z - bz * PERIOD;
    if (lx < ROAD || lz < ROAD) return 0;
    const b = this.block(bx, bz);
    let h = 0;
    for (const box of b.buildings) {
      if (x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1 && box.h > h) h = box.h;
    }
    return h;
  }

  /** Caja (edificio) más alta que contiene el punto (x, z) */
  boxAt(x: number, z: number): Box | null {
    const bx = Math.floor(x / PERIOD);
    const bz = Math.floor(z / PERIOD);
    const lx = x - bx * PERIOD;
    const lz = z - bz * PERIOD;
    if (lx < ROAD || lz < ROAD) return null;
    let best: Box | null = null;
    for (const box of this.block(bx, bz).buildings) {
      if (x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1 && (!best || box.h > best.h)) best = box;
    }
    return best;
  }

  /** Altura máxima aproximada en un radio (por manzanas) */
  maxHeightNear(x: number, z: number, radius: number): number {
    const b0x = Math.floor((x - radius) / PERIOD), b1x = Math.floor((x + radius) / PERIOD);
    const b0z = Math.floor((z - radius) / PERIOD), b1z = Math.floor((z + radius) / PERIOD);
    let h = 0;
    for (let i = b0x; i <= b1x; i++) for (let j = b0z; j <= b1z; j++) h = Math.max(h, this.block(i, j).maxH);
    return h;
  }

  /** Anillo (o ninguno) asociado a un chunk */
  ringsForChunk(cx: number, cz: number): RingSpawn[] {
    const seed = this.stage.seed + 555;
    const out: RingSpawn[] = [];
    if (hash2(cx, cz, seed) < 0.34) {
      const x = (cx + 0.15 + hash3(cx, cz, 1, seed) * 0.7) * CHUNK;
      const z = (cz + 0.15 + hash3(cx, cz, 2, seed) * 0.7) * CHUNK;
      const base = 90 + hash3(cx, cz, 3, seed) * 520;
      const y = Math.max(base, this.maxHeightNear(x, z, 40) + 60);
      const yaw = hash3(cx, cz, 4, seed) * Math.PI * 2;
      const k = hash3(cx, cz, 5, seed);
      const kind: RingKind = k < 0.52 ? 'normal' : k < 0.63 ? 'ammo' : k < 0.74 ? 'repair' : k < 0.83 ? 'missile' : k < 0.93 ? 'turbo' : 'gold';
      out.push({ id: `${cx}_${cz}`, kind, x, y, z, yaw });
    }
    // Aros marinos gigantes, medio sumergidos en aguas abiertas
    if (hash2(cx, cz, seed + 9) < 0.5) {
      for (let t = 0; t < 4; t++) {
        const x = (cx + 0.2 + hash3(cx, cz, 10 + t, seed) * 0.6) * CHUNK;
        const z = (cz + 0.2 + hash3(cx, cz, 20 + t, seed) * 0.6) * CHUNK;
        if (this.waterValue(x, z) < this.stage.waterLevel - 0.05 && this.maxHeightNear(x, z, 90) === 0) {
          out.push({ id: `s${cx}_${cz}`, kind: 'sea', x, y: 8, z, yaw: hash3(cx, cz, 30, seed) * Math.PI * 2 });
          break;
        }
      }
    }
    return out;
  }

  /** Cubos de nubes de un chunk */
  cloudsForChunk(cx: number, cz: number): Box[] {
    const seed = this.stage.seed + 777;
    const out: Box[] = [];
    if (hash2(cx, cz, seed) > 0.4) return out;
    const rand = mulberry32(Math.floor(hash2(cx, cz, seed + 1) * 4294967296));
    const color = hexToInt(this.stage.palette.cloud);
    const clusters = 1 + Math.floor(rand() * 2);
    for (let c = 0; c < clusters; c++) {
      const ccx = (cx + rand()) * CHUNK;
      const ccz = (cz + rand()) * CHUNK;
      const ccy = 700 + rand() * 700;
      const count = 8 + Math.floor(rand() * 18);
      const spread = 50 + rand() * 70;
      for (let i = 0; i < count; i++) {
        const s = 18 + rand() * 30;
        const x = ccx + (rand() - 0.5) * spread * 2;
        const z = ccz + (rand() - 0.5) * spread * 2;
        const y = ccy + (rand() - 0.3) * s * 0.8;
        out.push({ x0: x - s, z0: z - s * 0.8, x1: x + s, z1: z + s * 0.8, y0: y, h: s * 0.9, color });
      }
    }
    return out;
  }
}

const STYLE_PALETTES: Record<number, string[]> = {
  [S_GLASS]: ['#5d8fb8', '#4a7fa8', '#6fa9c9', '#3d6f8f', '#7fb3c8', '#4f9a9a', '#8aa6c0', '#5a7a9a'],
  [S_RESID]: ['#c86b4f', '#d9a066', '#e8d8b8', '#b5654a', '#f2e2c4', '#c9b28a', '#9c5a45', '#e0c090', '#a8b8a0'],
  [S_INDUST]: ['#9aa0a6', '#7d858c', '#b0b4b8', '#8a8070', '#a09888'],
  [S_DECO]: ['#d8cfb8', '#c8b890', '#e6e0d0', '#b8a888', '#c0b8b0'],
  [S_HOUSE]: ['#f0e6d2', '#e8d0b0', '#f5f0e6', '#dcc8a8', '#e8e0f0', '#d8e8e0'],
  [S_DETAIL]: ['#8a9098', '#6f7680', '#a0a6ae'],
};

function mixInt(a: number, b: number, k: number) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * k) << 16) | (Math.round(ag + (bg - ag) * k) << 8) | Math.round(ab + (bb - ab) * k);
}

export function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
