import { fbm, hash2 } from './noise';
import type { BlockData, Box, CityGen } from './city';

/**
 * Escenarios naturales y zona de guerra.
 * Todo sigue siendo un mundo de cajas sobre la cuadrícula de manzanas (PERIOD = 80 m), así que
 * colisiones, carreras, retos y multijugador funcionan igual que en la ciudad.
 */

/** Estilos nuevos del sombreador de edificios */
export const S_ROCK = 8;
export const S_LEAF = 9;
export const S_SNOWROCK = 10;
export const S_ICE = 11;
export const S_RUIN = 12;
export const S_STONE = 13;
export const S_TRUNK = 14;
/** Roca con la cima cubierta de selva (tepuyes) */
export const S_MESA = 15;
/** Fachada oscura con franjas de neón (cyberpunk) */
export const S_NEON = 16;
/** Cartel holográfico animado */
export const S_HOLO = 17;

const P = 80;
const CELL = 20;

const hex = (h: string) => parseInt(h.slice(1), 16);
const pick = <T>(list: T[], r: number) => list[Math.floor(r * list.length) % list.length];

// =================================================================== Selva amazónica
const LEAVES = ['#2f7a2a', '#26692a', '#3a8a30', '#2a5e26', '#46953a', '#357f34'].map(hex);
const BLOOM = ['#d070c0', '#f0c030', '#e85a5a', '#b890e0'].map(hex);
const TRUNK = ['#5a4030', '#4a3626', '#6a4a36'].map(hex);
const TEMPLE = ['#8a8a78', '#9a9480', '#7c7a6a'].map(hex);

const TEPUI_T = 0.715;
/** Desplazamiento del ruido: el punto de salida queda en plena selva, con un tepuy a lo lejos */
const TEPUI_OFF = 18000;
/** Meseta selvática (tepuy): 0 fuera, altura en metros dentro */
export function tepuiH(gen: CityGen, x: number, z: number) {
  const s = gen.stage.seed;
  const t = fbm((x + TEPUI_OFF) / 4200, z / 4200, s + 31, 3);
  if (t < TEPUI_T) return 0;
  const k = Math.min(1, (t - TEPUI_T) / 0.03);
  const top = 150 + fbm(x / 900, z / 900, s + 32, 2) * 90;
  return Math.round((k < 1 ? top * (0.3 + 0.5 * k) : top) / 15) * 15;
}

/** Claro en la selva (explanadas con aldeas) */
export function jungleClearing(gen: CityGen, x: number, z: number) {
  return fbm(x / 650, z / 650, gen.stage.seed + 21, 2) > 0.63;
}

export function genJungleBlock(gen: CityGen, bx: number, bz: number, rand: () => number, out: BlockData) {
  const x0 = bx * P;
  const z0 = bz * P;
  const cx = x0 + P / 2;
  const cz = z0 + P / 2;
  const push = (b: Box) => {
    out.buildings.push(b);
    out.maxH = Math.max(out.maxH, b.y0 + b.h);
  };
  // Tepuy: columnas de roca con la cima cubierta de selva y alguna cascada
  const th = tepuiH(gen, cx, cz);
  if (th > 0) {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const x = x0 + i * CELL;
        const z = z0 + j * CELL;
        const h = tepuiH(gen, x + CELL / 2, z + CELL / 2);
        if (h <= 0) continue;
        push({ x0: x, z0: z, x1: x + CELL, z1: z + CELL, y0: 0, h, color: hex('#7a6a58'), style: S_MESA, seed: rand() });
        if (rand() < 0.7) out.trees.push({ x0: x + 4, z0: z + 4, x1: x + 14, z1: z + 14, y0: h, h: 6 + rand() * 6, color: pick(LEAVES, rand()) });
        // Cascada por la pared (si el vecino es más bajo)
        if (rand() < 0.12 && tepuiH(gen, x + CELL * 1.5, z + CELL / 2) < h - 40) {
          out.trees.push({ x0: x + CELL + 0.2, z0: z + 6, x1: x + CELL + 2.2, z1: z + 13, y0: 0, h: h - 2, color: hex('#cfe8ff') });
        }
      }
    return;
  }
  const dry = (x: number, z: number) => !gen.isWater(x, z);
  // Templo escalonado entre los árboles
  if (hash2(bx, bz, gen.stage.seed + 77) < 0.012 && dry(cx, cz) && dry(x0 + 6, z0 + 6) && dry(x0 + P - 6, z0 + P - 6)) {
    const tiers = 5 + Math.floor(rand() * 2);
    let half = 32;
    let y = 0;
    const col = pick(TEMPLE, rand());
    for (let t = 0; t < tiers; t++) {
      const hh = 7;
      push({ x0: cx - half, z0: cz - half, x1: cx + half, z1: cz + half, y0: 0, h: y + hh, color: col, style: S_STONE, seed: rand() });
      y += hh;
      half -= 5;
    }
    push({ x0: cx - 6, z0: cz - 6, x1: cx + 6, z1: cz + 6, y0: 0, h: y + 9, color: hex('#6e6a5c'), style: S_STONE, seed: rand() });
    // Escalinata
    push({ x0: cx - 4, z0: cz - 34, x1: cx + 4, z1: cz - 20, y0: 0, h: 10, color: col, style: S_STONE, seed: 0.5 });
    out.kind = 'plaza';
    return;
  }
  const clearing = jungleClearing(gen, cx, cz);
  // Aldea en el claro: chozas con techo de paja
  if (clearing && dry(cx, cz) && hash2(bx, bz, gen.stage.seed + 78) < 0.35) {
    const n = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rand() * 0.4;
      const hx = cx + Math.cos(a) * 20;
      const hz = cz + Math.sin(a) * 20;
      if (!dry(hx, hz)) continue;
      push({ x0: hx - 4, z0: hz - 4, x1: hx + 4, z1: hz + 4, y0: 0, h: 4, color: hex('#a07850'), style: 5, seed: rand() });
      push({ x0: hx - 5, z0: hz - 5, x1: hx + 5, z1: hz + 5, y0: 0, h: 6.5, color: hex('#c8a860'), style: 7, seed: 0.4 });
    }
    out.kind = 'park';
    return;
  }
  // Selva: árboles gigantes (tronco + copa + corona) sobre celdas de 40 m
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      const tx = x0 + i * 40 + 8 + rand() * 24;
      const tz = z0 + j * 40 + 8 + rand() * 24;
      if (!dry(tx, tz)) continue;
      if (clearing && rand() < 0.8) {
        if (rand() < 0.5) out.trees.push(smallTree(tx, tz, rand));
        continue;
      }
      if (rand() > 0.88) {
        out.trees.push(smallTree(tx, tz, rand));
        continue;
      }
      const giant = rand() < 0.09;
      const H = giant ? 50 + rand() * 18 : 20 + rand() * 20;
      const tw = giant ? 5 : 2.5 + rand() * 1.5;
      push({ x0: tx - tw / 2, z0: tz - tw / 2, x1: tx + tw / 2, z1: tz + tw / 2, y0: 0, h: H - 6, color: pick(TRUNK, rand()), style: S_TRUNK, seed: rand() });
      const cw = (giant ? 30 : 18 + rand() * 12) / 2;
      const cc = giant && rand() < 0.35 ? pick(BLOOM, rand()) : pick(LEAVES, rand());
      const ch = giant ? 14 : 9 + rand() * 4;
      push({ x0: tx - cw, z0: tz - cw, x1: tx + cw, z1: tz + cw, y0: H - ch, h: ch, color: cc, style: S_LEAF, seed: rand() });
      const k = cw * 0.6;
      push({ x0: tx - k, z0: tz - k, x1: tx + k, z1: tz + k, y0: H - 2, h: 5 + rand() * 3, color: cc, style: S_LEAF, seed: rand() });
      // Sotobosque
      if (rand() < 0.6) out.trees.push(smallTree(tx + (rand() - 0.5) * 30, tz + (rand() - 0.5) * 30, rand));
    }
}

function smallTree(x: number, z: number, rand: () => number): Box {
  const s = 4 + rand() * 5;
  return { x0: x - s / 2, z0: z - s / 2, x1: x + s / 2, z1: z + s / 2, y0: 0.5, h: s * (1 + rand() * 0.5), color: pick(LEAVES, rand()) };
}

// =================================================================== Cañones del desierto
/** Altura del terreno de mesetas (0 = suelo del cañón o llanura) */
export function canyonH(gen: CityGen, x: number, z: number) {
  const s = gen.stage.seed;
  const plain = fbm(x / 2600, z / 2600, s + 13, 2);
  if (plain < 0.36) return 0;
  const n = fbm(x / 1500, z / 1500, s + 11, 3);
  const c = Math.abs(n - 0.5);
  if (c < 0.04) return 0;
  const wall = Math.min(1, (c - 0.04) / 0.045);
  const base = 70 + fbm(x / 800, z / 800, s + 12, 2) * 200;
  let h = base * (wall < 1 ? 0.3 + 0.7 * wall : 1);
  if (plain < 0.44) h *= (plain - 0.36) / 0.08;
  h = Math.round(h / 24) * 24;
  return h < 24 ? 0 : h;
}

/** El fondo del cañón (para el color del suelo) */
export function canyonFloor(gen: CityGen, x: number, z: number) {
  const n = fbm(x / 1500, z / 1500, gen.stage.seed + 11, 3);
  return Math.abs(n - 0.5) < 0.04 && fbm(x / 2600, z / 2600, gen.stage.seed + 13, 2) >= 0.36;
}

const ROCKS = ['#b8643c', '#c2704a', '#a85a36', '#c88050', '#b06a44'].map(hex);
const BASALT = ['#3a302c', '#2e2624', '#463a34'].map(hex);

/** Zona volcánica de los cañones: basalto oscuro y ríos de lava */
export function volcanic(gen: CityGen, x: number, z: number) {
  return fbm(x / 3400, z / 3400, gen.stage.seed + 71, 2) > 0.6;
}

/** Grietas profundas del glaciar (cañones de hielo por los que se puede volar) */
export function iceCrevasse(gen: CityGen, x: number, z: number) {
  return Math.abs(fbm(x / 760, z / 760, gen.stage.seed + 63, 2) - 0.5) < 0.03;
}

export function genCanyonBlock(gen: CityGen, bx: number, bz: number, rand: () => number, out: BlockData) {
  const x0 = bx * P;
  const z0 = bz * P;
  const push = (b: Box) => {
    out.buildings.push(b);
    out.maxH = Math.max(out.maxH, b.y0 + b.h);
  };
  const volc = volcanic(gen, x0 + P / 2, z0 + P / 2);
  const col = volc ? pick(BASALT, hash2(bx, bz, 7)) : pick(ROCKS, hash2(Math.floor(bx / 6), Math.floor(bz / 6), gen.stage.seed + 5));
  let any = false;
  // Cascadas: desde lo alto de una pared hacia el río del cañón
  if (!volc)
    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 4; i++) {
        const x = x0 + i * CELL;
        const z = z0 + j * CELL;
        const h = canyonH(gen, x + CELL / 2, z + CELL / 2);
        if (h < 72 || hash2(Math.floor(x / CELL), Math.floor(z / CELL), gen.stage.seed + 41) > 0.1) continue;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + CELL / 2 + dx * CELL;
          const nz = z + CELL / 2 + dz * CELL;
          if (canyonH(gen, nx, nz) !== 0 || !gen.isWater(nx + dx * 20, nz + dz * 20)) continue;
          const fx = dx > 0 ? x + CELL : dx < 0 ? x - 2 : x + 6;
          const fz = dz > 0 ? z + CELL : dz < 0 ? z - 2 : z + 6;
          const w = dx !== 0 ? [2, 8] : [8, 2];
          out.trees.push({ x0: fx, z0: fz, x1: fx + w[0], z1: fz + w[1], y0: 0, h: h - 1, color: hex('#d8ecff') });
          out.trees.push({ x0: fx - 4 + dx * 6, z0: fz - 4 + dz * 6, x1: fx + 6 + dx * 6, z1: fz + 6 + dz * 6, y0: 0, h: 4, color: hex('#f0f8ff') });
          break;
        }
      }
  // Columnas de 20 m (las iguales seguidas se juntan en una sola caja)
  for (let j = 0; j < 4; j++) {
    let run: Box | null = null;
    for (let i = 0; i < 4; i++) {
      const x = x0 + i * CELL;
      const z = z0 + j * CELL;
      const h = canyonH(gen, x + CELL / 2, z + CELL / 2);
      if (h > 0) any = true;
      if (run && run.h === h && h > 0) {
        run.x1 = x + CELL;
        continue;
      }
      if (run) push(run);
      run = h > 0 ? { x0: x, z0: z, x1: x + CELL, z1: z + CELL, y0: 0, h, color: col, style: S_ROCK, seed: hash2(bx, bz, 3) } : null;
    }
    if (run) push(run);
  }
  const cx = x0 + P / 2;
  const cz = z0 + P / 2;
  // Arco de roca natural sobre el cañón
  if (canyonH(gen, cx, cz) === 0 && canyonFloor(gen, cx, cz) && hash2(bx, bz, gen.stage.seed + 91) < 0.08) {
    // El arco cruza el cañón de pared a pared (eje con paredes altas a ambos lados)
    const tx = Math.min(canyonH(gen, x0 - 30, cz), canyonH(gen, x0 + P + 30, cz));
    const tz = Math.min(canyonH(gen, cx, z0 - 30), canyonH(gen, cx, z0 + P + 30));
    const alongX = tx >= tz;
    const top = Math.max(tx, tz);
    if (top >= 60) {
      const y0 = top - 34;
      push(alongX ? { x0: x0 - 12, z0: cz - 9, x1: x0 + P + 12, z1: cz + 9, y0, h: 16, color: col, style: S_ROCK, seed: 0.3, arch: true } : { x0: cx - 9, z0: z0 - 12, x1: cx + 9, z1: z0 + P + 12, y0, h: 16, color: col, style: S_ROCK, seed: 0.3, arch: true });
    }
  }
  if (any || volc) return;
  // Llanura: chimeneas de hadas, cactus y palmeras junto a los oasis
  for (let k = 0; k < 2; k++) {
    const x = x0 + 10 + rand() * 60;
    const z = z0 + 10 + rand() * 60;
    if (gen.isWater(x, z)) continue;
    const r = rand();
    if (r < 0.06) {
      const h = 25 + rand() * 40;
      push({ x0: x - 3, z0: z - 3, x1: x + 3, z1: z + 3, y0: 0, h, color: col, style: S_ROCK, seed: rand() });
      push({ x0: x - 5, z0: z - 5, x1: x + 5, z1: z + 5, y0: h - 1, h: 5, color: pick(ROCKS, rand()), style: S_ROCK, seed: rand() });
    } else if (r < 0.4) {
      out.trees.push({ x0: x - 0.8, z0: z - 0.8, x1: x + 0.8, z1: z + 0.8, y0: 0, h: 4 + rand() * 4, color: hex('#4a8a3a') });
    }
  }
  if (gen.waterValue(cx, cz) < gen.stage.waterLevel + 0.03 && !gen.isWater(cx, cz)) {
    for (let k = 0; k < 4; k++) {
      const x = x0 + rand() * P;
      const z = z0 + rand() * P;
      if (gen.isWater(x, z)) continue;
      out.trees.push({ x0: x - 0.6, z0: z - 0.6, x1: x + 0.6, z1: z + 0.6, y0: 0, h: 10, color: hex('#7a5a3a') });
      out.trees.push({ x0: x - 4, z0: z - 4, x1: x + 4, z1: z + 4, y0: 9, h: 2.5, color: hex('#3a9a3a') });
    }
  }
}

// =================================================================== Glaciar polar
/** Montañas de roca nevada que asoman del hielo (nunataks) */
export function nunatakH(gen: CityGen, x: number, z: number) {
  const m = fbm(x / 1300, z / 1300, gen.stage.seed + 41, 3);
  if (m < 0.62) return 0;
  return Math.round(((m - 0.62) * 1100) / 15) * 15;
}

const ICE = ['#e8f4ff', '#d6ecfa', '#c4e2f6', '#f4fbff'].map(hex);

export function genIceBlock(gen: CityGen, bx: number, bz: number, rand: () => number, out: BlockData) {
  const x0 = bx * P;
  const z0 = bz * P;
  const push = (b: Box) => {
    out.buildings.push(b);
    out.maxH = Math.max(out.maxH, b.y0 + b.h);
  };
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const x = x0 + i * CELL;
      const z = z0 + j * CELL;
      const mx = x + CELL / 2;
      const mz = z + CELL / 2;
      const water = gen.isWater(mx, mz);
      if (!water) {
        const h = nunatakH(gen, mx, mz);
        if (h > 0) {
          push({ x0: x, z0: z, x1: x + CELL, z1: z + CELL, y0: 0, h, color: hex('#4a4e58'), style: S_SNOWROCK, seed: rand() });
          continue;
        }
        // Plataforma de hielo alta; las grietas profundas quedan como cañones de hielo
        if (iceCrevasse(gen, mx, mz)) continue;
        const sheet = 30 + Math.round(fbm(mx / 400, mz / 400, gen.stage.seed + 64, 2) * 3) * 6;
        push({ x0: x, z0: z, x1: x + CELL, z1: z + CELL, y0: 0, h: sheet, color: pick(ICE, hash2(Math.floor(mx / 120), Math.floor(mz / 120), 9)), style: S_ICE, seed: rand() });
        continue;
      }
      // Icebergs en aguas profundas
      if (gen.waterValue(mx, mz) > gen.stage.waterLevel - 0.05) continue;
      const r = rand();
      if (r < 0.02) {
        const w = 10 + rand() * 10;
        const h = 8 + rand() * 16;
        const c = pick(ICE, rand());
        push({ x0: mx - w, z0: mz - w, x1: mx + w, z1: mz + w * 0.8, y0: 0, h, color: c, style: S_ICE, seed: rand() });
        if (rand() < 0.5) push({ x0: mx - w * 0.5 + rand() * 3, z0: mz - w * 0.6, x1: mx + w * 0.4, z1: mz + w * 0.3, y0: 0, h: h + 8 + rand() * 25, color: c, style: S_ICE, seed: rand() });
      } else if (r < 0.0225 && hash2(Math.floor(mx / 400), Math.floor(mz / 400), gen.stage.seed + 52) < 0.3) {
        // Arco de hielo para pasar por debajo
        const c = pick(ICE, rand());
        const top = 45 + rand() * 25;
        push({ x0: mx - 34, z0: mz - 6, x1: mx - 22, z1: mz + 6, y0: 0, h: top, color: c, style: S_ICE, seed: rand() });
        push({ x0: mx + 22, z0: mz - 6, x1: mx + 34, z1: mz + 6, y0: 0, h: top, color: c, style: S_ICE, seed: rand() });
        push({ x0: mx - 34, z0: mz - 6, x1: mx + 34, z1: mz + 6, y0: top - 10, h: 12, color: c, style: S_ICE, seed: rand(), arch: true });
      }
    }
  // Base científica (rara): módulos rojos y una antena con baliza
  const cx = x0 + P / 2;
  const cz = z0 + P / 2;
  if (!out.buildings.length && !gen.isWater(cx, cz) && hash2(bx, bz, gen.stage.seed + 51) < 0.015) {
    const red = [hex('#d04030'), hex('#e06a30'), hex('#c8c8c8')];
    for (let k = 0; k < 4; k++) {
      const x = cx - 24 + k * 13;
      push({ x0: x, z0: cz - 5, x1: x + 10, z1: cz + 5, y0: 0, h: 5 + (k % 2) * 3, color: red[k % 3], style: 3, seed: rand() });
    }
    push({ x0: cx + 30, z0: cz - 1, x1: cx + 32, z1: cz + 1, y0: 0, h: 40, color: 0xcccccc, style: 4, seed: 0.5 });
    out.lights.push({ x: cx + 31, y: 40.6, z: cz });
  }
}

// =================================================================== Zona de guerra
const RUIN_TINT = 0x2e2820;

function mix(a: number, b: number, k: number) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * k) << 16) | (Math.round(ag + (bg - ag) * k) << 8) | Math.round(ab + (bb - ab) * k);
}

/** Convierte una manzana de ciudad en ruinas: edificios partidos, escombros, esqueletos y losas caídas */
export function ruinBlock(gen: CityGen, bx: number, bz: number, rand: () => number, out: BlockData) {
  const src = out.buildings;
  const res: Box[] = [];
  let maxH = 0;
  const push = (b: Box) => {
    res.push(b);
    maxH = Math.max(maxH, b.y0 + b.h);
  };
  for (const b of src) {
    const st = b.style ?? 0;
    const color = mix(b.color, RUIN_TINT, 0.35);
    if (st === 4 || st === 7 || b.h < 8) {
      // detalles y tejados: la mitad desaparece
      if (rand() < 0.5) push({ ...b, color });
      continue;
    }
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const r = rand();
    if (r < 0.32) {
      // Partido: planta superior irregular
      const top = Math.max(6, Math.round(b.h * (0.35 + rand() * 0.4)));
      push({ ...b, h: top, color, style: S_RUIN });
      const n = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const fx = rand() * 0.6;
        const fz = rand() * 0.6;
        push({ x0: b.x0 + w * fx, z0: b.z0 + d * fz, x1: b.x0 + w * (fx + 0.2 + rand() * 0.25), z1: b.z0 + d * (fz + 0.2 + rand() * 0.25), y0: 0, h: top + 3 + rand() * 14, color, style: S_RUIN, seed: rand() });
      }
    } else if (r < 0.46) {
      // Montón de escombros
      const n = 4 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        const fx = rand() * 0.75;
        const fz = rand() * 0.75;
        push({ x0: b.x0 + w * fx, z0: b.z0 + d * fz, x1: b.x0 + w * (fx + 0.2), z1: b.z0 + d * (fz + 0.2), y0: 0, h: 2 + rand() * 7, color: mix(color, 0x605850, 0.4), style: S_RUIN, seed: rand() });
      }
      out.smoke ??= [];
      if (rand() < 0.35) out.smoke.push({ x: (b.x0 + b.x1) / 2, y: 4, z: (b.z0 + b.z1) / 2 });
    } else if (r < 0.55 && b.h > 40 && w > 18 && d > 18) {
      // Esqueleto: pilares en las esquinas y forjados cada 24 m (se puede cruzar por dentro)
      const pw = 2.5;
      for (const [px, pz] of [
        [b.x0, b.z0],
        [b.x1 - pw, b.z0],
        [b.x0, b.z1 - pw],
        [b.x1 - pw, b.z1 - pw],
      ])
        push({ x0: px, z0: pz, x1: px + pw, z1: pz + pw, y0: 0, h: b.h * (0.75 + rand() * 0.25), color, style: S_RUIN, seed: rand() });
      for (let y = 24; y < b.h * 0.8; y += 24) push({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, y0: y, h: 2, color, style: S_RUIN, seed: rand(), arch: true });
    } else {
      push({ ...b, color, style: rand() < 0.75 ? S_RUIN : st });
      if (rand() < 0.08) {
        out.smoke ??= [];
        out.smoke.push({ x: (b.x0 + b.x1) / 2, y: b.h, z: (b.z0 + b.z1) / 2 });
      }
    }
  }
  // Losa caída sobre la calle: arco para pasar por debajo
  if (hash2(bx, bz, gen.stage.seed + 61) < 0.14 && res.length) {
    const alongX = rand() < 0.5;
    const y0 = 16 + rand() * 26;
    const x0 = bx * P;
    const z0 = bz * P;
    const a = 16 + 4 + rand() * 30;
    const col = mix(0x8a8478, RUIN_TINT, 0.3);
    if (alongX) {
      push({ x0: x0 - 3, z0: z0 + a, x1: x0 + 30, z1: z0 + a + 12, y0, h: 7, color: col, style: S_RUIN, seed: rand(), arch: true });
      push({ x0: x0 + 20, z0: z0 + a, x1: x0 + 30, z1: z0 + a + 12, y0: 0, h: y0, color: col, style: S_RUIN, seed: rand() });
    } else {
      push({ x0: x0 + a, z0: z0 - 3, x1: x0 + a + 12, z1: z0 + 30, y0, h: 7, color: col, style: S_RUIN, seed: rand(), arch: true });
      push({ x0: x0 + a, z0: z0 + 20, x1: x0 + a + 12, z1: z0 + 30, y0: 0, h: y0, color: col, style: S_RUIN, seed: rand() });
    }
  }
  out.buildings = res;
  out.maxH = maxH;
  if (out.smoke && out.smoke.length) out.smoke = hash2(bx, bz, gen.stage.seed + 62) < 0.3 ? [out.smoke[0]] : [];
  // Árboles quemados
  for (const t of out.trees) t.color = mix(t.color, 0x3a3020, 0.6);
}


// =================================================================== Ciudad cyberpunk
/** Tonos de neón (se eligen en el sombreador a partir del «seed» del edificio) */
export function cyberBlock(gen: CityGen, bx: number, bz: number, rand: () => number, out: BlockData) {
  const res: Box[] = [];
  let maxH = 0;
  const push = (b: Box) => {
    res.push(b);
    maxH = Math.max(maxH, b.y0 + b.h);
  };
  const dt = gen.downtown(bx * P + P / 2, bz * P + P / 2);
  for (const b of out.buildings) {
    const st = b.style ?? 0;
    if (st === 4 || st === 7 || b.h < 12) {
      push(b);
      continue;
    }
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    let h = b.h;
    // Megatorres en el centro
    if (dt > 0.45 && rand() < 0.12 && w > 20 && d > 20) h = Math.max(h, 220 + rand() * 220);
    const neon = rand() < 0.7;
    push({ ...b, h, style: neon ? S_NEON : st, color: neon ? pick([0x1c1e2c, 0x222536, 0x181a26, 0x2a2440, 0x1a2230], rand()) : b.color, seed: rand() });
    // Corona escalonada y antena en las torres altas
    if (h > 120) {
      const k = 0.2 + rand() * 0.1;
      push({ x0: b.x0 + w * k, z0: b.z0 + d * k, x1: b.x1 - w * k, z1: b.z1 - d * k, y0: 0, h: h + 12 + rand() * 20, color: 0x1a1c28, style: S_NEON, seed: rand() });
      if (rand() < 0.6) {
        const mx = (b.x0 + b.x1) / 2;
        const mz = (b.z0 + b.z1) / 2;
        const ah = h + 40 + rand() * 40;
        push({ x0: mx - 0.8, z0: mz - 0.8, x1: mx + 0.8, z1: mz + 0.8, y0: 0, h: ah, color: 0x9aa0b0, style: 4, seed: 0.5 });
        out.lights.push({ x: mx, y: ah + 0.6, z: mz });
      }
    }
    // Cartel holográfico pegado a la fachada
    if (h > 40 && rand() < 0.45) {
      const side = Math.floor(rand() * 4);
      const bw = (side < 2 ? w : d) * (0.45 + rand() * 0.35);
      const bh = 14 + rand() * 22;
      const y0 = Math.min(h - bh - 4, 18 + rand() * (h * 0.6));
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const t = 1.2;
      const sign: Box =
        side === 0
          ? { x0: cx - bw / 2, z0: b.z0 - t - 0.6, x1: cx + bw / 2, z1: b.z0 - 0.6, y0, h: bh, color: 0xffffff, style: S_HOLO, seed: rand() }
          : side === 1
            ? { x0: cx - bw / 2, z0: b.z1 + 0.6, x1: cx + bw / 2, z1: b.z1 + t + 0.6, y0, h: bh, color: 0xffffff, style: S_HOLO, seed: rand() }
            : side === 2
              ? { x0: b.x0 - t - 0.6, z0: cz - bw / 2, x1: b.x0 - 0.6, z1: cz + bw / 2, y0, h: bh, color: 0xffffff, style: S_HOLO, seed: rand() }
              : { x0: b.x1 + 0.6, z0: cz - bw / 2, x1: b.x1 + t + 0.6, z1: cz + bw / 2, y0, h: bh, color: 0xffffff, style: S_HOLO, seed: rand() };
      if (y0 > 6) push(sign);
    }
    // Letrero vertical en la azotea
    if (h > 30 && h < 160 && rand() < 0.25) {
      const sx = b.x0 + 3 + rand() * Math.max(1, w - 10);
      const sz = b.z0 + 3 + rand() * Math.max(1, d - 4);
      push({ x0: sx, z0: sz, x1: sx + 6, z1: sz + 1, y0: h, h: 10 + rand() * 8, color: 0xffffff, style: S_HOLO, seed: rand() });
    }
  }
  // Pasarela aérea sobre la calle (se puede pasar por debajo)
  if (hash2(bx, bz, gen.stage.seed + 81) < 0.18 && maxH > 70) {
    const alongX = rand() < 0.5;
    const y0 = 45 + rand() * Math.min(120, maxH - 60);
    const a = 16 + 6 + rand() * 40;
    const x0 = bx * P;
    const z0 = bz * P;
    push(
      alongX
        ? { x0: x0 - 4, z0: z0 + a, x1: x0 + 24, z1: z0 + a + 7, y0, h: 4, color: 0x22263a, style: S_NEON, seed: rand(), arch: true }
        : { x0: x0 + a, z0: z0 - 4, x1: x0 + a + 7, z1: z0 + 24, y0, h: 4, color: 0x22263a, style: S_NEON, seed: rand(), arch: true },
    );
  }
  out.buildings = res;
  out.maxH = maxH;
  for (const t of out.trees) t.color = 0x1a4a3a;
}
