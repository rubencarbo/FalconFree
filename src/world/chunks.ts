import * as THREE from 'three';
import type { Stage } from '../stages';
import { CHUNK, CityGen, PERIOD, ROAD, hexToInt, type Box } from './city';
import { fbm, hash2 } from './noise';
import { canyonFloor, canyonH, jungleClearing, nunatakH, tepuiH } from './biomes';

/** Metros por píxel de la textura del suelo (look pixelado) */
const PX = 2;
const TEX = CHUNK / PX;

const unitBox = new THREE.BoxGeometry(1, 1, 1);
unitBox.translate(0, 0.5, 0);

interface Chunk {
  cx: number;
  cz: number;
  group: THREE.Group;
  ground: THREE.Mesh;
  tex: THREE.DataTexture;
  mat: THREE.MeshLambertMaterial;
  buildings?: THREE.InstancedMesh;
  props?: THREE.InstancedMesh;
  clouds?: THREE.InstancedMesh;
  beacons?: THREE.InstancedMesh;
  smoke?: THREE.InstancedMesh;
  fires?: THREE.InstancedMesh;
  ltex?: THREE.DataTexture;
}

type RGB = [number, number, number];
function rgb(hex: string): RGB {
  const v = hexToInt(hex);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function createBuildingMaterial(stage: Stage): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uWindow = { value: new THREE.Color(stage.night ? '#2a3548' : stage.palette.window) };
  const uNight = { value: stage.night ? 1 : 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindow = uWindow;
    shader.uniforms.uNight = uNight;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aInfo;
varying vec3 vWPos;
varying vec3 vWN;
varying vec3 vInfo;
varying vec2 vUv2;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  mat4 fbModel = modelMatrix * instanceMatrix;
#else
  mat4 fbModel = modelMatrix;
#endif
  vWPos = (fbModel * vec4(transformed, 1.0)).xyz;
  vWN = normalize(mat3(fbModel) * objectNormal);
  vInfo = aInfo;
  vUv2 = uv;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
varying vec3 vWN;
varying vec3 vInfo;
varying vec2 vUv2;
uniform vec3 uWindow;
uniform float uNight;
float fbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  int fbStyle = int(vInfo.x + 0.5);
  float fbSeed = vInfo.y;
  float fbH = vInfo.z;
  float fbWin = 0.0;
  float fbLit = 0.0;
  float fbCrown = 0.0;
  float fbShop = 0.0;
  float fbPad = 0.0;
  float fbRoofEdge = 0.0;
  vec3 fbLitCol = vec3(1.0, 0.8, 0.5);
  vec2 fbCell = vec2(0.0);
  float fbU = abs(vWN.x) > 0.5 ? vWPos.z : vWPos.x;
  float fbY = vWPos.y;
  if (abs(vWN.y) < 0.5) {
    vec2 f;
    if (fbStyle == 1) {
      // Cristal: muros cortina con montantes finos y reflejo del cielo
      fbCell = vec2(fbU / 1.6, fbY / 3.5);
      f = fract(fbCell);
      fbWin = step(0.07, f.x) * step(f.x, 0.93) * step(0.14, f.y) * step(f.y, 0.92);
      vec3 glass = diffuseColor.rgb * (1.05 + 0.15 * sin(fbY * 0.04 + fbSeed * 6.0)) + vec3(0.05, 0.08, 0.11);
      diffuseColor.rgb = mix(diffuseColor.rgb * 0.5, glass, fbWin);
    } else if (fbStyle == 2) {
      // Viviendas: ventanas pequeñas y balcones
      fbCell = vec2(fbU / 4.0, fbY / 3.0);
      f = fract(fbCell);
      fbWin = step(0.3, f.x) * step(f.x, 0.7) * step(0.38, f.y) * step(f.y, 0.8);
      float balc = step(0.1, f.y) * step(f.y, 0.24) * step(0.22, f.x) * step(f.x, 0.78) * step(0.45, fbHash(vec2(floor(fbCell.x), fbSeed * 13.0)));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + 0.05, balc);
      diffuseColor.rgb = mix(diffuseColor.rgb, uWindow * 0.9, fbWin);
    } else if (fbStyle == 3) {
      // Nave industrial: chapa ondulada y franja de ventanas alta
      fbCell = vec2(fbU / 3.0, 1.0);
      diffuseColor.rgb *= 0.9 + 0.1 * step(0.5, fract(fbU / 0.9));
      fbWin = step(fbH - 3.2, fbY) * step(fbY, fbH - 1.6) * step(0.12, fract(fbU / 3.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, uWindow, fbWin);
    } else if (fbStyle == 5) {
      fbCell = vec2(fbU / 3.0, fbY / 3.0);
      f = fract(fbCell);
      fbWin = step(0.35, f.x) * step(f.x, 0.65) * step(0.35, f.y) * step(f.y, 0.75);
      diffuseColor.rgb = mix(diffuseColor.rgb, uWindow * 0.8, fbWin);
    } else if (fbStyle == 0 || fbStyle == 6) {
      // Oficinas (rejilla) y art déco (ranuras verticales)
      float cw = fbStyle == 6 ? 2.2 : 3.2;
      fbCell = vec2(fbU / cw, fbY / 3.5);
      f = fract(fbCell);
      fbWin = fbStyle == 6
        ? step(0.32, f.x) * step(f.x, 0.68) * step(0.12, f.y) * step(f.y, 0.92)
        : step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.84);
      diffuseColor.rgb = mix(diffuseColor.rgb, uWindow * (0.85 + 0.3 * fbHash(floor(fbCell))), fbWin);
    } else if (fbStyle == 8 || fbStyle == 10 || fbStyle == 15) {
      // Roca estratificada (nevada en el glaciar)
      float band = fbHash(vec2(floor(fbY / 6.0), fbSeed * 17.0 + floor(fbU / 40.0)));
      float line = step(0.86, fract(fbY / 6.0));
      float grain = fbHash(floor(vec2(fbU, fbY) * 0.7));
      diffuseColor.rgb *= (0.78 + 0.32 * band) * (1.0 - 0.18 * line) * (0.94 + 0.1 * grain);
      if (fbStyle == 10) {
        float cap = step(fbH - 4.0 - 4.0 * fbHash(vec2(floor(fbU / 3.0), fbSeed)), fbY);
        float streak = step(0.8, fbHash(vec2(floor(fbU / 2.0), 7.0))) * step(fbH - 20.0, fbY);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), max(cap, streak * 0.7));
      }
    } else if (fbStyle == 9) {
      // Copas de árbol: hojas a manchas
      float leaf = fbHash(floor(vec2(fbU, fbY) * 0.6) + fbSeed * 11.0);
      diffuseColor.rgb *= 0.72 + 0.4 * leaf;
    } else if (fbStyle == 11) {
      // Hielo: vetas verticales y azul más intenso abajo
      float v = fbHash(vec2(floor(fbU / 1.5), fbSeed * 5.0));
      diffuseColor.rgb *= 0.9 + 0.14 * v;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.72, 0.95), clamp(1.0 - fbY / max(fbH, 1.0), 0.0, 1.0) * 0.35);
    } else if (fbStyle == 12) {
      // Ruinas: huecos de ventana negros y hollín
      fbCell = vec2(fbU / 3.2, fbY / 3.5);
      f = fract(fbCell);
      float hole = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.85) * step(0.3, fbHash(floor(fbCell) + fbSeed * 3.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.045, 0.04), hole * step(3.5, fbY));
      float soot = smoothstep(fbH * 0.55, fbH, fbY) * 0.5 + step(0.82, fbHash(floor(vec2(fbU / 5.0, fbY / 6.0)) + fbSeed)) * 0.35;
      diffuseColor.rgb *= 1.0 - soot;
    } else if (fbStyle == 13) {
      // Sillares de piedra con musgo
      vec2 sc = vec2(fbU / 2.4 + 0.5 * step(0.5, fract(fbY / 2.4)), fbY / 1.2);
      f = fract(sc);
      float mortar = max(step(f.x, 0.06), step(f.y, 0.1));
      diffuseColor.rgb *= (1.0 - 0.3 * mortar) * (0.9 + 0.15 * fbHash(floor(sc)));
      float moss = step(0.55, fbHash(floor(sc * 0.5) + 3.0)) * (1.0 - clamp(fbY / 30.0, 0.0, 1.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.42, 0.2), moss * 0.6);
    } else if (fbStyle == 14) {
      // Corteza
      diffuseColor.rgb *= 0.75 + 0.3 * fbHash(vec2(floor(fbU * 2.0), floor(fbY / 4.0)));
    }
    fbWin *= step(4.0, fbY);
    // Bajos comerciales
    if (fbStyle <= 2 || fbStyle == 6) {
      fbShop = step(0.6, fbY) * step(fbY, 3.2);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.2, 0.22), fbShop * 0.6);
    }
    // Luces nocturnas: fracción encendida distinta por edificio y plantas enteras
    float litFrac = mix(0.06, 0.3, fbSeed);
    float cellRnd = fbHash(floor(fbCell) + vec2(fbSeed * 31.0, floor(vWN.x * 3.0 + vWN.z * 7.0)));
    fbLit = step(cellRnd, litFrac);
    if (fbStyle <= 1 || fbStyle == 6) fbLit = max(fbLit, step(fbHash(vec2(floor(fbY / 3.5), fbSeed * 97.0)), 0.05));
    float cc = fbHash(floor(fbCell) * 1.7 + fbSeed * 5.0);
    fbLitCol = cc < 0.6 ? vec3(1.0, 0.76, 0.42) : cc < 0.9 ? vec3(0.78, 0.86, 1.0) : vec3(0.45, 0.9, 1.0);
    if (fbStyle == 1) fbLitCol = mix(fbLitCol, vec3(0.8, 0.9, 1.0), 0.6);
    // Corona luminosa en lo alto de los rascacielos
    if ((fbStyle == 0 || fbStyle == 1 || fbStyle == 6) && fbH > 70.0) fbCrown = step(fbH - 3.0, fbY);
    diffuseColor.rgb *= mix(0.62, 1.0, clamp(fbY / 25.0, 0.0, 1.0));
  } else if (vWN.y > 0.5) {
    // Tejados distintos por tipo: se leen bien desde arriba
    vec2 r = vUv2;
    float edge = min(min(r.x, 1.0 - r.x), min(r.y, 1.0 - r.y));
    float speck = fbHash(floor(vWPos.xz * 1.5));
    vec3 roof = diffuseColor.rgb * (0.72 + 0.12 * speck);
    if (fbStyle == 1) {
      roof = vec3(0.2, 0.22, 0.25) * (0.9 + 0.2 * speck);
      if (fbSeed < 0.5 && fbH > 50.0) {
        vec2 c = r - 0.5;
        float d = length(c);
        float ring = step(0.25, d) * step(d, 0.31);
        float legs = step(0.07, abs(c.x)) * step(abs(c.x), 0.12) * step(abs(c.y), 0.15);
        float bar = step(abs(c.y), 0.025) * step(abs(c.x), 0.08);
        roof = mix(roof, mix(vec3(0.95, 0.8, 0.15), vec3(0.35, 0.32, 0.2), uNight), ring);
        roof = mix(roof, mix(vec3(0.95), vec3(0.4), uNight), max(legs, bar));
        // Balizas en las cuatro esquinas del helipuerto (de noche)
        vec2 q = abs(c) - vec2(0.36);
        fbPad = step(length(q), 0.035);
      }
    } else if (fbStyle == 2) {
      if (fbSeed < 0.3) roof = mix(vec3(0.3, 0.52, 0.24), vec3(0.38, 0.62, 0.3), speck);
      else if (fbSeed < 0.55) {
        vec2 sp = fract(vWPos.xz / vec2(2.2, 1.4));
        float panel = step(0.08, sp.x) * step(sp.x, 0.92) * step(0.1, sp.y) * step(sp.y, 0.9) * step(0.12, edge);
        roof = mix(roof * 0.85, vec3(0.1, 0.16, 0.34), panel);
      } else roof = mix(roof, vec3(0.6, 0.55, 0.5), 0.45);
    } else if (fbStyle == 3) {
      float st = fract(abs(vWPos.x) / 6.0);
      roof = vec3(0.6, 0.61, 0.63) * (0.8 + 0.25 * st);
      roof = mix(roof, vec3(0.42, 0.58, 0.74), step(0.8, st));
    } else if (fbStyle == 6) {
      roof = diffuseColor.rgb * 0.8;
    } else if (fbStyle == 7) {
      roof = diffuseColor.rgb * (0.85 + 0.12 * speck);
    } else if (fbStyle == 0) {
      roof = mix(vec3(0.45, 0.46, 0.48), diffuseColor.rgb, 0.35) * (0.85 + 0.2 * speck);
    } else if (fbStyle == 8) {
      roof = diffuseColor.rgb * (0.95 + 0.15 * speck) + vec3(0.05, 0.03, 0.0);
    } else if (fbStyle == 10 || fbStyle == 11) {
      roof = vec3(0.93, 0.96, 1.0) * (0.94 + 0.07 * speck);
    } else if (fbStyle == 9) {
      float leaf = fbHash(floor(vWPos.xz * 0.5) + fbSeed * 7.0);
      roof = diffuseColor.rgb * (0.85 + 0.45 * leaf);
    } else if (fbStyle == 12) {
      roof = mix(diffuseColor.rgb * 0.6, vec3(0.35, 0.32, 0.28), speck * 0.6);
    } else if (fbStyle == 13 || fbStyle == 14) {
      roof = diffuseColor.rgb * (0.85 + 0.2 * speck);
    } else if (fbStyle == 15) {
      roof = mix(vec3(0.16, 0.36, 0.13), vec3(0.24, 0.48, 0.18), speck);
    }
    if (fbStyle < 7 && fbStyle != 5 && fbStyle != 4) {
      fbRoofEdge = step(edge, 0.035);
      roof = mix(roof, diffuseColor.rgb * 1.08 + 0.04, fbRoofEdge);
    }
    diffuseColor.rgb = roof;
  } else {
    // Cara inferior (copas de árbol, arcos, losas caídas): en sombra
    diffuseColor.rgb *= 0.55;
  }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  if (uNight > 0.5) {
    totalEmissiveRadiance += fbLitCol * fbWin * fbLit * 0.62;
    float cs = fract(fbSeed * 7.31);
    vec3 crownCol = cs < 0.25 ? vec3(0.3, 0.9, 1.4) : cs < 0.5 ? vec3(1.4, 0.4, 1.1) : cs < 0.75 ? vec3(1.5, 1.1, 0.4) : vec3(1.3);
    totalEmissiveRadiance += crownCol * fbCrown;
    totalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * fbShop * 0.8 * step(0.35, fbHash(vec2(floor(fbU / 5.0), fbSeed * 9.0)));
    totalEmissiveRadiance += vec3(0.5, 1.4, 0.6) * fbPad;
    totalEmissiveRadiance += diffuseColor.rgb * fbRoofEdge * 0.35;
  }`,
      );
  };
  return mat;
}

export class ChunkManager {
  private chunks = new Map<string, Chunk>();
  private pending: { cx: number; cz: number; d: number }[] = [];
  private lastCx = Infinity;
  private lastCz = Infinity;
  private buildingMat: THREE.MeshLambertMaterial;
  private propMat: THREE.MeshLambertMaterial;
  private cloudMat: THREE.MeshLambertMaterial;
  private beaconMat: THREE.MeshBasicMaterial;
  private smokeMat: THREE.MeshLambertMaterial;
  private fireMat: THREE.MeshBasicMaterial;
  private night: boolean;
  private biome: string;
  /** Luz del último píxel calculado (solo de noche) */
  private px: RGB | null = null;
  private colors: {
    water: RGB[];
    grass: RGB[];
    road: RGB;
    roadEdge: RGB;
    sidewalk: RGB;
    sand: RGB;
    lot: RGB;
    lotDark: RGB;
    line: RGB;
    white: RGB;
    rail: RGB;
    path: RGB;
    paveA: RGB;
    paveB: RGB;
    parking: RGB;
    track: RGB;
    pitchA: RGB;
    pitchB: RGB;
  };
  private tmpM = new THREE.Matrix4();
  private tmpC = new THREE.Color();

  onChunkAdded?: (cx: number, cz: number) => void;
  onChunkRemoved?: (cx: number, cz: number) => void;

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
    public radius: number,
  ) {
    const st = gen.stage;
    this.buildingMat = createBuildingMaterial(st);
    this.propMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.cloudMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(st.palette.cloud).multiplyScalar(st.night ? 0.25 : 0.55),
      transparent: true,
      opacity: 0.92,
    });
    this.beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.15) });
    this.smokeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false });
    this.fireMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.45, 0.1) });
    this.night = st.night;
    this.biome = st.biome ?? 'city';
    const p = st.palette;
    const lot = rgb(p.lot);
    this.colors = {
      water: p.water.map(rgb),
      grass: p.grass.map(rgb),
      road: rgb(p.road),
      roadEdge: shade(rgb(p.road), 1.35),
      sidewalk: rgb(p.sidewalk),
      sand: rgb(p.sand),
      lot,
      lotDark: shade(lot, 0.88),
      line: st.night ? [200, 170, 60] : [235, 200, 40],
      white: st.night ? [150, 150, 150] : [235, 235, 235],
      rail: st.night ? [90, 90, 100] : [150, 150, 150],
      path: st.night ? [80, 74, 70] : [214, 196, 160],
      paveA: st.night ? [78, 74, 82] : [206, 200, 188],
      paveB: st.night ? [66, 62, 70] : [184, 176, 164],
      parking: st.night ? [34, 35, 40] : [70, 72, 78],
      track: st.night ? [110, 60, 50] : [190, 92, 70],
      pitchA: st.night ? [40, 90, 50] : [74, 160, 64],
      pitchB: st.night ? [34, 80, 44] : [64, 146, 56],
    };
  }

  /** Cambia la distancia de dibujado (calidad gráfica) */
  setRadius(r: number) {
    if (r === this.radius) return;
    this.radius = r;
    this.lastCx = this.lastCz = Infinity;
  }

  /** Llamar cada frame con la posición del jugador */
  update(x: number, z: number, budgetMs = 6) {
    // Balizas rojas parpadeantes
    const blink = Math.sin(performance.now() * 0.004) > 0.55 ? 3 : 0.25;
    this.beaconMat.color.setRGB(blink, blink * 0.07, blink * 0.05);
    // Llamas que titilan (zona de guerra)
    const fl = 0.8 + 0.2 * Math.sin(performance.now() * 0.023) * Math.sin(performance.now() * 0.0071);
    this.fireMat.color.setRGB(fl, 0.42 * fl, 0.08);
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    if (cx !== this.lastCx || cz !== this.lastCz) {
      this.lastCx = cx;
      this.lastCz = cz;
      this.replan(cx, cz);
    }
    const t0 = performance.now();
    while (this.pending.length && performance.now() - t0 < budgetMs) {
      const next = this.pending.shift()!;
      const key = `${next.cx},${next.cz}`;
      if (!this.chunks.has(key)) this.build(next.cx, next.cz);
    }
  }

  /** Genera de forma síncrona los chunks más cercanos (al iniciar) */
  warmup(x: number, z: number, count: number) {
    this.update(x, z, 0);
    for (let i = 0; i < count && this.pending.length; i++) {
      const next = this.pending.shift()!;
      if (!this.chunks.has(`${next.cx},${next.cz}`)) this.build(next.cx, next.cz);
    }
  }

  *loaded(): Generator<[number, number]> {
    for (const ch of this.chunks.values()) yield [ch.cx, ch.cz];
  }

  get loadingCount() {
    return this.pending.length;
  }

  private replan(cx: number, cz: number) {
    const r = this.radius;
    for (const [key, ch] of this.chunks) {
      const d = Math.hypot(ch.cx - cx, ch.cz - cz);
      if (d > r + 1.5) {
        this.disposeChunk(ch);
        this.chunks.delete(key);
      }
    }
    this.pending = [];
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const d = Math.hypot(i, j);
        if (d > r + 0.5) continue;
        const key = `${cx + i},${cz + j}`;
        if (!this.chunks.has(key)) this.pending.push({ cx: cx + i, cz: cz + j, d });
      }
    }
    this.pending.sort((a, b) => a.d - b.d);
  }

  private build(cx: number, cz: number) {
    const group = new THREE.Group();
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;

    // Suelo: textura pixelada generada
    const data = new Uint8Array(TEX * TEX * 4);
    const ldata = this.night ? new Uint8Array(TEX * TEX * 4) : null;
    for (let j = 0; j < TEX; j++) {
      const z = z0 + CHUNK - (j + 0.5) * PX;
      for (let i = 0; i < TEX; i++) {
        const x = x0 + (i + 0.5) * PX;
        this.px = null;
        const c = this.groundColor(x, z);
        const o = (j * TEX + i) * 4;
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
        if (ldata) {
          const l = this.px;
          ldata[o] = l ? l[0] : 0;
          ldata[o + 1] = l ? l[1] : 0;
          ldata[o + 2] = l ? l[2] : 0;
          ldata[o + 3] = 255;
        }
      }
    }
    const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    let ltex: THREE.DataTexture | undefined;
    if (ldata) {
      ltex = new THREE.DataTexture(ldata, TEX, TEX, THREE.RGBAFormat);
      ltex.colorSpace = THREE.SRGBColorSpace;
      ltex.magFilter = THREE.NearestFilter;
      ltex.minFilter = THREE.LinearMipmapLinearFilter;
      ltex.generateMipmaps = true;
      ltex.needsUpdate = true;
    }
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: ltex ?? null, emissive: ltex ? new THREE.Color(1.8, 1.8, 1.8) : new THREE.Color(0) });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK, CHUNK), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(x0 + CHUNK / 2, 0, z0 + CHUNK / 2);
    group.add(ground);

    // Edificios y árboles/nubes
    const b0 = Math.floor(x0 / PERIOD);
    const bz0 = Math.floor(z0 / PERIOD);
    const n = CHUNK / PERIOD;
    const buildings: Box[] = [];
    const props: Box[] = [];
    const beacons: Box[] = [];
    const smoke: Box[] = [];
    const fires: Box[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const b = this.gen.block(b0 + i, bz0 + j);
        for (const box of b.buildings) buildings.push(box);
        for (const t of b.trees) props.push(t);
        for (const l of b.lights) beacons.push({ x0: l.x - 0.7, z0: l.z - 0.7, x1: l.x + 0.7, z1: l.z + 0.7, y0: l.y - 0.7, h: 1.4, color: 0xffffff });
        // Columnas de humo con fuego en la base (zona de guerra)
        for (const src of b.smoke ?? []) {
          const seed = hash2(Math.floor(src.x), Math.floor(src.z), 99);
          for (let k = 0; k < 13; k++) {
            const sz = 6 + k * 2.4;
            const x = src.x + k * k * 0.4 + (hash2(k, Math.floor(src.x), 5) - 0.5) * 6;
            const z = src.z + (hash2(k, Math.floor(src.z), 6) - 0.5) * 6 + seed * k;
            const shade = Math.min(1, 0.22 + k * 0.035);
            const g = Math.round(255 * shade);
            smoke.push({ x0: x - sz / 2, z0: z - sz / 2, x1: x + sz / 2, z1: z + sz / 2, y0: src.y + k * 11, h: sz * 0.9, color: (g << 16) | (Math.round(g * 0.95) << 8) | Math.round(g * 0.9) });
          }
          for (let k = 0; k < 3; k++) {
            const fx = src.x + (hash2(k, 1, Math.floor(src.x)) - 0.5) * 8;
            const fz = src.z + (hash2(k, 2, Math.floor(src.z)) - 0.5) * 8;
            const fs = 2.5 + k;
            fires.push({ x0: fx - fs / 2, z0: fz - fs / 2, x1: fx + fs / 2, z1: fz + fs / 2, y0: src.y - 1, h: fs * 1.2, color: 0xffffff });
          }
        }
      }
    }
    const clouds = this.gen.cloudsForChunk(cx, cz);

    const chunk: Chunk = { cx, cz, group, ground, tex, mat, ltex };
    if (buildings.length) {
      chunk.buildings = this.instanced(buildings, this.buildingMat, true);
      group.add(chunk.buildings);
    }
    if (beacons.length) {
      chunk.beacons = this.instanced(beacons, this.beaconMat);
      group.add(chunk.beacons);
    }
    if (props.length) {
      chunk.props = this.instanced(props, this.propMat);
      group.add(chunk.props);
    }
    if (clouds.length) {
      chunk.clouds = this.instanced(clouds, this.cloudMat);
      group.add(chunk.clouds);
    }
    if (smoke.length) {
      chunk.smoke = this.instanced(smoke, this.smokeMat);
      chunk.smoke.renderOrder = 2;
      group.add(chunk.smoke);
    }
    if (fires.length) {
      chunk.fires = this.instanced(fires, this.fireMat);
      group.add(chunk.fires);
    }
    this.scene.add(group);
    this.chunks.set(`${cx},${cz}`, chunk);
    this.onChunkAdded?.(cx, cz);
  }

  private instanced(boxes: Box[], mat: THREE.Material, withInfo = false) {
    let geo = unitBox;
    if (withInfo) {
      // Atributo por instancia: estilo, aleatorio y altura (para el shader)
      geo = unitBox.clone();
      const info = new Float32Array(boxes.length * 3);
      boxes.forEach((b, i) => {
        info[i * 3] = b.style ?? 0;
        info[i * 3 + 1] = b.seed ?? hash2(Math.floor(b.x0), Math.floor(b.z0), 7);
        info[i * 3 + 2] = b.h;
      });
      geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 3));
    }
    const mesh = new THREE.InstancedMesh(geo, mat, boxes.length);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const q = new THREE.Quaternion();
    boxes.forEach((b, i) => {
      pos.set((b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2);
      scl.set(b.x1 - b.x0, b.h, b.z1 - b.z0);
      this.tmpM.compose(pos, q, scl);
      mesh.setMatrixAt(i, this.tmpM);
      this.tmpC.setHex(b.color);
      mesh.setColorAt(i, this.tmpC);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    return mesh;
  }

  private groundColor(x: number, z: number): RGB {
    switch (this.biome) {
      case 'jungle':
        return this.jungleGround(x, z);
      case 'canyon':
        return this.canyonGround(x, z);
      case 'ice':
        return this.iceGround(x, z);
      case 'war':
        return this.warGround(x, z);
    }
    return this.cityGround(x, z);
  }

  // ---------------------------------------------------------------- Suelos de los biomas
  private jungleGround(x: number, z: number): RGB {
    const g = this.gen;
    const wv = g.waterValue(x, z);
    const level = g.stage.waterLevel;
    const n = hash2(Math.floor(x / 4), Math.floor(z / 4), g.stage.seed + 3);
    if (wv < level) {
      if (hash2(Math.floor(x / 2), Math.floor(z / 2), 11) > 0.996) return [220, 236, 220];
      const d = level - wv;
      return d < 0.006 ? [110, 120, 80] : d < 0.018 ? [74, 104, 70] : [58, 88, 60];
    }
    if (wv - level < 0.008) return n < 0.5 ? [122, 92, 60] : [108, 82, 54];
    const bx = Math.floor(x / PERIOD);
    const bz = Math.floor(z / PERIOD);
    const block = g.block(bx, bz);
    const lx = x - bx * PERIOD - PERIOD / 2;
    const lz = z - bz * PERIOD - PERIOD / 2;
    if (block.kind === 'plaza') {
      const tile = (Math.floor(x / 3) + Math.floor(z / 3)) % 2 === 0;
      return Math.hypot(lx, lz) < 40 ? (tile ? [150, 146, 126] : [134, 130, 112]) : n < 0.5 ? [60, 108, 46] : [52, 96, 40];
    }
    if (block.kind === 'park' && Math.hypot(lx, lz) < 30) return Math.hypot(lx, lz) < 3 ? [70, 60, 50] : n < 0.6 ? [168, 140, 96] : [150, 124, 84];
    if (tepuiH(g, x, z) > 0) return [96, 84, 70];
    if (jungleClearing(g, x, z)) return n < 0.5 ? [96, 150, 62] : [86, 138, 56];
    const m = fbm(x / 60, z / 60, g.stage.seed + 4, 2);
    return m > 0.6 ? [56, 104, 44] : n < 0.5 ? [38, 82, 32] : [32, 72, 28];
  }

  private canyonGround(x: number, z: number): RGB {
    const g = this.gen;
    const wv = g.waterValue(x, z);
    const level = g.stage.waterLevel;
    const n = hash2(Math.floor(x / 3), Math.floor(z / 3), g.stage.seed + 3);
    if (wv < level) {
      if (hash2(Math.floor(x / 2), Math.floor(z / 2), 11) > 0.996) return [230, 245, 240];
      return level - wv < 0.01 ? [90, 170, 160] : [42, 120, 130];
    }
    if (wv - level < 0.02) return n < 0.5 ? [86, 140, 60] : [74, 124, 52];
    if (canyonH(g, x, z) > 0) return n < 0.5 ? [176, 98, 60] : [160, 88, 54];
    if (canyonFloor(g, x, z)) return n < 0.12 ? [120, 90, 70] : n < 0.55 ? [180, 116, 76] : [166, 104, 68];
    // Dunas
    const rip = Math.sin((x * 0.8 + z * 0.45) / 7 + fbm(x / 320, z / 320, g.stage.seed + 9, 2) * 14);
    return rip > 0.4 ? [236, 196, 136] : rip > -0.3 ? [222, 180, 120] : [204, 162, 106];
  }

  private iceGround(x: number, z: number): RGB {
    const g = this.gen;
    const wv = g.waterValue(x, z);
    const level = g.stage.waterLevel;
    const n = hash2(Math.floor(x / 4), Math.floor(z / 4), g.stage.seed + 3);
    if (wv < level) {
      const d = level - wv;
      const floe = fbm(x / 70, z / 70, g.stage.seed + 61, 2);
      if (d < 0.1 && floe > 0.62) return floe > 0.66 ? [230, 240, 250] : [190, 214, 236];
      if (d < 0.012) return [60, 130, 170];
      return d < 0.05 ? [24, 64, 110] : [14, 40, 78];
    }
    if (nunatakH(g, x, z) > 0) return [90, 94, 104];
    const cr = Math.abs(fbm(x / 260, z / 260, g.stage.seed + 62, 2) - 0.5);
    if (cr < 0.006) return [70, 110, 170];
    const sas = Math.sin((x * 0.3 - z * 0.9) / 5) > 0.7;
    return sas ? [214, 228, 244] : n < 0.5 ? [232, 240, 250] : [224, 234, 248];
  }

  private warGround(x: number, z: number): RGB {
    const g = this.gen;
    let c = this.cityGround(x, z);
    if (g.isWater(x, z)) return c;
    // Cráteres de bomba
    const cs = 36;
    const ix = Math.floor(x / cs);
    const iz = Math.floor(z / cs);
    if (hash2(ix, iz, g.stage.seed + 71) < 0.22) {
      const ccx = (ix + 0.25 + hash2(ix, iz, 72) * 0.5) * cs;
      const ccz = (iz + 0.25 + hash2(ix, iz, 73) * 0.5) * cs;
      const r = 5 + hash2(ix, iz, 74) * 9;
      const d = Math.hypot(x - ccx, z - ccz);
      if (d < r * 0.7) return hash2(Math.floor(x), Math.floor(z), 75) < 0.5 ? [40, 34, 28] : [52, 44, 36];
      if (d < r) return [104, 92, 76];
    }
    // Zonas quemadas y escombros sueltos
    if (fbm(x / 130, z / 130, g.stage.seed + 76, 2) > 0.6) c = [c[0] * 0.55, c[1] * 0.52, c[2] * 0.5];
    if (hash2(Math.floor(x / 2), Math.floor(z / 2), g.stage.seed + 77) > 0.975) return [128, 122, 112];
    return c;
  }

  private cityGround(x: number, z: number): RGB {
    const g = this.gen;
    const C = this.colors;
    const N = this.night;
    const bx = Math.floor(x / PERIOD);
    const bz = Math.floor(z / PERIOD);
    const lx = x - bx * PERIOD;
    const lz = z - bz * PERIOD;
    const wv = g.waterValue(x, z);
    const level = g.stage.waterLevel;
    const water = wv < level;
    const roadX = lx < ROAD;
    const roadZ = lz < ROAD;

    if (roadX || roadZ) {
      // Solo hay puentes en avenidas y sobre aguas poco profundas (canales)
      const bridge = ((roadX && g.isAvenue(bx)) || (roadZ && g.isAvenue(bz))) && level - wv < 0.05;
      if (water && !bridge) return this.waterColor(level - wv, x, z);
      if (water && bridge) {
        const edge = roadX && !roadZ ? lx < 2 || lx >= ROAD - 2 : !roadX && roadZ ? lz < 2 || lz >= ROAD - 2 : false;
        if (edge) {
          if (N && Math.floor((roadX ? z : x) / 12) % 2 === 0) this.px = LAMP;
          return C.rail;
        }
      }
      if (roadX && roadZ) return C.road; // cruce
      const along = roadX ? lx : lz; // posición transversal
      const lengthPos = roadX ? lz : lx; // posición a lo largo de la manzana
      const lengthAbs = roadX ? z : x;
      // Pasos de cebra junto a los cruces
      if (lengthPos < ROAD + 5 || lengthPos > PERIOD - 5) {
        if (along > 2 && along < ROAD - 2 && Math.floor(along / 2) % 2 === 0) return C.white;
        return C.road;
      }
      // Coches: dos carriles por sentido
      const lane = along >= 3 && along < 7 ? 0 : along >= 9 && along < 13 ? 1 : -1;
      if (lane >= 0) {
        const slot = Math.floor(lengthAbs / 7);
        const hv = hash2(slot, (roadX ? bx : bz) * 4 + lane + (roadX ? 0 : 2), g.stage.seed + 41);
        const inCar = lengthAbs - slot * 7 < 4.5 && (lane === 0 ? along < 6 : along >= 10);
        if (hv < 0.16 && inCar) {
          if (N) {
            const front = (lengthAbs - slot * 7 < 2) === (lane === 0);
            this.px = front ? [255, 245, 210] : [255, 40, 30];
            return [40, 40, 46];
          }
          return CARS[Math.floor(hv * 1000) % CARS.length];
        }
      }
      // Línea central discontinua
      if (along >= 7 && along < 9 && Math.floor(lengthAbs / 8) % 2 === 0) return C.line;
      if (along < 2 || along >= ROAD - 2) return C.roadEdge;
      return C.road;
    }

    if (water) return this.waterColor(level - wv, x, z);
    if (wv - level < 0.012) return C.sand;

    // Acera alrededor de la manzana, con farolas
    if (lx < ROAD + 2 || lx >= PERIOD - 2 || lz < ROAD + 2 || lz >= PERIOD - 2) {
      if (N) {
        const pos = lx < ROAD + 2 || lx >= PERIOD - 2 ? lz : lx;
        if (Math.floor(pos / 2) % 8 === 0) this.px = LAMP;
        else this.px = LAMP_DIM;
      }
      return C.sidewalk;
    }

    const block = g.block(bx, bz);
    const n = hash2(Math.floor(x / 6), Math.floor(z / 6), g.stage.seed + 3);
    const ux = lx - ROAD;
    const uz = lz - ROAD;
    const BL = PERIOD - ROAD;
    const dcx = ux - BL / 2;
    const dcz = uz - BL / 2;
    switch (block.kind) {
      case 'park':
        if (Math.abs(dcx) < 1.5 || Math.abs(dcz) < 1.5) {
          if (N && (Math.floor(ux / 2) + Math.floor(uz / 2)) % 6 === 0) this.px = LAMP_DIM;
          return C.path;
        }
        return n < 0.5 ? C.grass[0] : C.grass[1];
      case 'plaza': {
        const d = Math.hypot(dcx, dcz);
        if (d < 5) {
          if (N && d < 3.5) this.px = [40, 120, 160];
          return d < 3.5 ? C.water[2] : C.white;
        }
        // Ocho farolas puntuales alrededor de la plaza
        if (N && d > 17 && d < 19.5) {
          const a = Math.atan2(dcz, dcx) / (Math.PI / 4);
          if (Math.abs(a - Math.round(a)) < 0.07) this.px = LAMP;
        }
        const tile = (Math.floor(ux / 4) + Math.floor(uz / 4)) % 2 === 0;
        return tile ? C.paveA : C.paveB;
      }
      case 'parking': {
        const row = Math.floor(uz / 12);
        const inRow = uz - row * 12;
        if (inRow < 5.5 || inRow > 6.5) {
          const stall = Math.floor(ux / 3);
          if (ux - stall * 3 < 0.8) return C.white;
          const hv = hash2(stall, row, g.stage.seed + 77);
          if (hv < 0.55 && ux - stall * 3 > 1 && (inRow < 4.5 || inRow > 7.5)) return N ? [40, 40, 46] : CARS[Math.floor(hv * 997) % CARS.length];
        }
        if (N && Math.floor(ux / 2) % 8 === 0 && inRow >= 5.5 && inRow <= 6.5) this.px = LAMP;
        return C.parking;
      }
      case 'sports': {
        const track = Math.abs(dcx) > 26 || Math.abs(dcz) > 22;
        if (track) return Math.abs(dcx) > 28 || Math.abs(dcz) > 24 ? C.sidewalk : C.track;
        if (N) this.px = FIELD_LIGHT;
        const line = Math.abs(Math.abs(dcx) - 24) < 1 || Math.abs(Math.abs(dcz) - 20) < 1 || Math.abs(dcx) < 0.6 || Math.abs(Math.hypot(dcx, dcz) - 7) < 0.8;
        if (line) return C.white;
        return Math.floor(ux / 4) % 2 === 0 ? C.pitchA : C.pitchB;
      }
    }
    // Solares: hormigón con algo de césped
    const lotHash = hash2(Math.floor(x / 22), Math.floor(z / 22), g.stage.seed + 5);
    if (lotHash < 0.35) return n < 0.5 ? C.grass[0] : C.grass[1];
    return n < 0.5 ? C.lot : C.lotDark;
  }

  private waterColor(depth: number, x: number, z: number): RGB {
    const W = this.colors.water;
    // Pequeños destellos
    if (hash2(Math.floor(x / 2), Math.floor(z / 2), 11) > 0.995) return [240, 248, 255];
    if (depth < 0.02) return W[2];
    if (depth < 0.07) return W[1];
    return W[0];
  }

  private disposeChunk(ch: Chunk) {
    this.scene.remove(ch.group);
    ch.ground.geometry.dispose();
    ch.mat.dispose();
    ch.tex.dispose();
    if (ch.buildings) {
      ch.buildings.geometry.dispose();
      ch.buildings.dispose();
    }
    ch.beacons?.dispose();
    ch.ltex?.dispose();
    ch.props?.dispose();
    ch.clouds?.dispose();
    ch.smoke?.dispose();
    ch.fires?.dispose();
    this.onChunkRemoved?.(ch.cx, ch.cz);
  }

  dispose() {
    for (const ch of this.chunks.values()) this.disposeChunk(ch);
    this.chunks.clear();
    this.pending = [];
    this.buildingMat.dispose();
    this.propMat.dispose();
    this.cloudMat.dispose();
    this.beaconMat.dispose();
    this.smokeMat.dispose();
    this.fireMat.dispose();
  }
}

const LAMP: RGB = [255, 190, 110];
const LAMP_DIM: RGB = [120, 84, 46];
const FIELD_LIGHT: RGB = [70, 110, 70];
const CARS: RGB[] = [
  [200, 40, 40],
  [240, 240, 240],
  [30, 30, 36],
  [40, 90, 180],
  [230, 190, 40],
  [150, 155, 160],
  [60, 140, 80],
];

function shade(c: RGB, k: number): RGB {
  return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
}
