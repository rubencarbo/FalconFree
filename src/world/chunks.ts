import * as THREE from 'three';
import type { Stage } from '../stages';
import { CHUNK, CityGen, PERIOD, ROAD, hexToInt, type Box } from './city';
import { hash2 } from './noise';

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
}

type RGB = [number, number, number];
function rgb(hex: string): RGB {
  const v = hexToInt(hex);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function createBuildingMaterial(stage: Stage): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uWindow = { value: new THREE.Color(stage.palette.window) };
  const uNight = { value: stage.night ? 1 : 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindow = uWindow;
    shader.uniforms.uNight = uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  mat4 fbModel = modelMatrix * instanceMatrix;
#else
  mat4 fbModel = modelMatrix;
#endif
  vWPos = (fbModel * vec4(transformed, 1.0)).xyz;
  vWN = normalize(mat3(fbModel) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
varying vec3 vWN;
uniform vec3 uWindow;
uniform float uNight;
float fbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float fbWin = 0.0;
  float fbLit = 0.0;
  if (abs(vWN.y) < 0.5) {
    float u = abs(vWN.x) > 0.5 ? vWPos.z : vWPos.x;
    vec2 cell = vec2(u / 3.2, vWPos.y / 3.5);
    vec2 f = fract(cell);
    fbWin = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.84);
    fbWin *= step(4.0, vWPos.y);
    float hh = fbHash(floor(cell) + floor(vWN.xz * 3.0) * 17.0);
    fbLit = step(0.5, hh);
    vec3 wc = mix(uWindow * (0.75 + 0.5 * hh), diffuseColor.rgb * 0.35, uNight);
    diffuseColor.rgb = mix(diffuseColor.rgb, wc, fbWin);
    diffuseColor.rgb *= mix(0.62, 1.0, clamp(vWPos.y / 25.0, 0.0, 1.0));
  } else if (vWN.y > 0.5) {
    diffuseColor.rgb *= 0.86;
  }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += uWindow * (0.6 + 0.6 * fbLit) * fbWin * fbLit * uNight;`,
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
    };
  }

  /** Llamar cada frame con la posición del jugador */
  update(x: number, z: number, budgetMs = 6) {
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
    for (let j = 0; j < TEX; j++) {
      const z = z0 + CHUNK - (j + 0.5) * PX;
      for (let i = 0; i < TEX; i++) {
        const x = x0 + (i + 0.5) * PX;
        const c = this.groundColor(x, z);
        const o = (j * TEX + i) * 4;
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    const mat = new THREE.MeshLambertMaterial({ map: tex });
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
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const b = this.gen.block(b0 + i, bz0 + j);
        for (const box of b.buildings) buildings.push(box);
        for (const t of b.trees) props.push(t);
      }
    }
    const clouds = this.gen.cloudsForChunk(cx, cz);

    const chunk: Chunk = { cx, cz, group, ground, tex, mat };
    if (buildings.length) {
      chunk.buildings = this.instanced(buildings, this.buildingMat);
      group.add(chunk.buildings);
    }
    if (props.length) {
      chunk.props = this.instanced(props, this.propMat);
      group.add(chunk.props);
    }
    if (clouds.length) {
      chunk.clouds = this.instanced(clouds, this.cloudMat);
      group.add(chunk.clouds);
    }
    this.scene.add(group);
    this.chunks.set(`${cx},${cz}`, chunk);
    this.onChunkAdded?.(cx, cz);
  }

  private instanced(boxes: Box[], mat: THREE.Material) {
    const mesh = new THREE.InstancedMesh(unitBox, mat, boxes.length);
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
    const g = this.gen;
    const C = this.colors;
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
        // Barandillas del puente
        const edge = roadX && !roadZ ? lx < 2 || lx >= ROAD - 2 : !roadX && roadZ ? lz < 2 || lz >= ROAD - 2 : false;
        if (edge) return C.rail;
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
      // Línea central discontinua
      if (along >= 7 && along < 9 && Math.floor(lengthAbs / 8) % 2 === 0) return C.line;
      if (along < 2 || along >= ROAD - 2) return C.roadEdge;
      return C.road;
    }

    if (water) return this.waterColor(level - wv, x, z);
    if (wv - level < 0.012) return C.sand;

    // Acera alrededor de la manzana
    if (lx < ROAD + 2 || lx >= PERIOD - 2 || lz < ROAD + 2 || lz >= PERIOD - 2) return C.sidewalk;

    const block = g.block(bx, bz);
    const n = hash2(Math.floor(x / 6), Math.floor(z / 6), g.stage.seed + 3);
    if (block.park) return n < 0.5 ? C.grass[0] : C.grass[1];
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
    ch.buildings?.dispose();
    ch.props?.dispose();
    ch.clouds?.dispose();
    this.onChunkRemoved?.(ch.cx, ch.cz);
  }

  dispose() {
    for (const ch of this.chunks.values()) this.disposeChunk(ch);
    this.chunks.clear();
    this.pending = [];
    this.buildingMat.dispose();
    this.propMat.dispose();
    this.cloudMat.dispose();
  }
}

function shade(c: RGB, k: number): RGB {
  return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
}
