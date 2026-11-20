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

/** Caja apoyada en el suelo (y de 0 a h) o flotante si y0 > 0 */
export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  h: number;
  color: number;
}

export interface BlockData {
  park: boolean;
  buildings: Box[];
  trees: Box[];
  maxH: number;
}

export interface RingSpawn {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export class CityGen {
  private blockCache = new Map<number, BlockData>();
  private colors: number[];
  private treeColors: number[];

  constructor(public readonly stage: Stage) {
    this.colors = stage.palette.buildings.map(hexToInt);
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
    return clamp01((v - 0.48) / 0.2);
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
    let maxH = 0;

    const park = rand() < st.parkChance;
    if (park) {
      const n = 10 + Math.floor(rand() * 14);
      for (let i = 0; i < n; i++) {
        const tx = x0 + 4 + rand() * (BLOCK - 8);
        const tz = z0 + 4 + rand() * (BLOCK - 8);
        if (this.isWater(tx, tz)) continue;
        trees.push(this.tree(tx, tz, rand));
      }
      return { park, buildings, trees, maxH };
    }

    const dt = this.downtown(x0 + BLOCK / 2, z0 + BLOCK / 2);
    const r = rand();
    const n = dt > 0.6 && r < 0.35 ? 1 : r < 0.55 ? 2 : 3;
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
        if (rand() < 0.08) {
          for (let k = 0; k < 3; k++) {
            trees.push(this.tree(lx0 + 4 + rand() * (lot - 8), lz0 + 4 + rand() * (lot - 8), rand));
          }
          continue;
        }
        const shrinkX = rand() * (lot * 0.2);
        const shrinkZ = rand() * (lot * 0.2);
        const bx0 = lx0 + inset + shrinkX * rand();
        const bz0 = lz0 + inset + shrinkZ * rand();
        const bx1 = lx0 + lot - inset - shrinkX * rand();
        const bz1 = lz0 + lot - inset - shrinkZ * rand();

        let h = 6 + rand() * 20 + dt * Math.pow(rand(), 1.6) * 230;
        h *= st.heightMul;
        h = Math.max(4, Math.round(h / 3.5) * 3.5);
        const color = this.colors[Math.floor(rand() * this.colors.length)];
        buildings.push({ x0: bx0, z0: bz0, x1: bx1, z1: bz1, y0: 0, h, color });
        maxH = Math.max(maxH, h);

        // Torre escalonada encima de los edificios altos
        if (h > 50 && rand() < 0.6) {
          const w = (bx1 - bx0) * 0.22;
          const d = (bz1 - bz0) * 0.22;
          const h2 = Math.round((h * (1.15 + rand() * 0.35)) / 3.5) * 3.5;
          const c2 = rand() < 0.5 ? color : this.colors[Math.floor(rand() * this.colors.length)];
          buildings.push({ x0: bx0 + w, z0: bz0 + d, x1: bx1 - w, z1: bz1 - d, y0: 0, h: h2, color: c2 });
          maxH = Math.max(maxH, h2);
          if (h2 > 120 && rand() < 0.6) {
            const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
            const ah = h2 + 15 + rand() * 25;
            buildings.push({ x0: cx - 0.8, z0: cz - 0.8, x1: cx + 0.8, z1: cz + 0.8, y0: 0, h: ah, color: 0xdddddd });
            maxH = Math.max(maxH, ah);
          }
        } else if (h < 40 && rand() < 0.35) {
          // Equipos en la azotea
          const cx = bx0 + (bx1 - bx0) * (0.25 + rand() * 0.5);
          const cz = bz0 + (bz1 - bz0) * (0.25 + rand() * 0.5);
          const s = 2 + rand() * 3;
          buildings.push({ x0: cx - s, z0: cz - s, x1: cx + s, z1: cz + s, y0: 0, h: h + 2 + rand() * 2, color: 0x8a8f96 });
        }
      }
    }
    return { park, buildings, trees, maxH };
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

  /** Altura máxima aproximada en un radio (por manzanas) */
  maxHeightNear(x: number, z: number, radius: number): number {
    const b0x = Math.floor((x - radius) / PERIOD), b1x = Math.floor((x + radius) / PERIOD);
    const b0z = Math.floor((z - radius) / PERIOD), b1z = Math.floor((z + radius) / PERIOD);
    let h = 0;
    for (let i = b0x; i <= b1x; i++) for (let j = b0z; j <= b1z; j++) h = Math.max(h, this.block(i, j).maxH);
    return h;
  }

  /** Anillo (o ninguno) asociado a un chunk */
  ringForChunk(cx: number, cz: number): RingSpawn | null {
    const seed = this.stage.seed + 555;
    if (hash2(cx, cz, seed) > 0.3) return null;
    const x = (cx + 0.15 + hash3(cx, cz, 1, seed) * 0.7) * CHUNK;
    const z = (cz + 0.15 + hash3(cx, cz, 2, seed) * 0.7) * CHUNK;
    const base = 90 + hash3(cx, cz, 3, seed) * 520;
    const y = Math.max(base, this.maxHeightNear(x, z, 40) + 60);
    const yaw = hash3(cx, cz, 4, seed) * Math.PI * 2;
    return { id: `${cx},${cz}`, x, y, z, yaw };
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

export function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
