import * as THREE from 'three';
import { PERIOD, type Box, type CityGen } from './world/city';
import { mulberry32 } from './world/noise';
import type { Flight } from './jet';
import type { Fx } from './fx';
import type { Target } from './combat';
import type { RadarItem } from './nav';
import { store } from './settings';

/** Tamaño de cada zona del mapa con un elemento (m) */
const CELL = 1300;
const CELL_RADIUS = 2;
export const LEGEND_TOTAL = 20;
const LEGEND_PER_STAGE: Record<string, number> = { metropolis: 7, archipelago: 7, dusk: 6 };

export interface SkyFunHooks {
  trick: (name: string, pts: number) => void;
  reward: (credits: number) => void;
  toast: (text: string, ms?: number) => void;
  big: (text: string) => void;
  sound: (kind: 'pop' | 'whoosh' | 'pickup' | 'win' | 'hit' | 'fail') => void;
  damage: (n: number) => void;
  sparks: (pos: THREE.Vector3, n: number) => void;
  stat: (k: 'legendPieces' | 'balloonClusters' | 'impossiblePasses', v: number, max?: boolean) => void;
  /** Montañas flotantes: reparar, recargar y recompensa del nido */
  repair: () => void;
  refill: () => void;
  power: () => string;
}

interface Feature {
  kind: 'tunnel' | 'balloons' | 'ramp' | 'gap';
  group: THREE.Group;
  update(dt: number, time: number, f: Flight, prev: THREE.Vector3): void;
  radar(items: RadarItem[], me: THREE.Vector3): void;
  dispose(): void;
}

const disposeGroup = (g: THREE.Object3D) =>
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat.dispose();
  });

/**
 * Elementos del vuelo libre: túneles de viento, globos, pasos imposibles,
 * bandadas de pájaros, rampas con islas flotantes y piezas del avión legendario.
 */
export class SkyFun {
  private cells = new Map<string, Feature | null>();
  private flocks: Flock[] = [];
  private pieces: Piece[] = [];
  /** Racimo de globos activo (cuenta atrás) */
  activeBalloons: Balloons | null = null;
  banner: { text: string; kind: 'good' | 'warn' | 'info' | 'bad' } | null = null;
  private prev = new THREE.Vector3();
  private seed: number;

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
    private fx: Fx,
    private hooks: SkyFunHooks,
  ) {
    this.seed = gen.stage.seed;
    for (let i = 0; i < 3; i++) this.flocks.push(new Flock(scene, i));
    this.placePieces();
  }

  // ------------------------------------------------------------ Piezas legendarias
  private placePieces() {
    const st = this.gen.stage.id;
    const n = LEGEND_PER_STAGE[st] ?? 6;
    const rand = mulberry32(this.seed * 977 + 31);
    const got = collectedPieces();
    let placed = 0;
    for (let attempt = 0; attempt < 3000 && placed < n; attempt++) {
      const a = rand() * Math.PI * 2;
      const r = 500 + rand() * 2600;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Sitio difícil: a ras de calle, con edificios altos muy cerca
      if (this.gen.heightAt(x, z) > 1) continue;
      if (this.gen.maxHeightNear(x, z, 40) < 85) continue;
      if (this.gen.maxHeightNear(x, z, 10) > 1) continue;
      const id = `${st}:${placed}`;
      const y = 26 + rand() * 22;
      if (!got.has(id)) this.pieces.push(new Piece(this.scene, id, new THREE.Vector3(x, y, z)));
      placed++;
    }
  }

  get piecesHere() {
    return this.pieces.length;
  }

  // ------------------------------------------------------------ Zonas
  private cellFeature(cx: number, cz: number): Feature | null {
    const rand = mulberry32(((cx * 73856093) ^ (cz * 19349663) ^ (this.seed * 83492791)) >>> 0);
    rand();
    // Una zona de cada cuatro se queda vacía para no saturar el cielo
    if (rand() < 0.25) return null;
    const pick = rand();
    const center = new THREE.Vector3((cx + 0.2 + rand() * 0.6) * CELL, 0, (cz + 0.2 + rand() * 0.6) * CELL);
    if (pick < 0.3) return new WindTunnel(this.scene, this.gen, center, rand, this.hooks);
    if (pick < 0.55) return new Balloons(this.scene, this.gen, center, rand, this.hooks, this);
    if (pick < 0.75) return new Ramp(this.scene, this.gen, center, rand, this.hooks);
    return Gap.find(this.scene, this.gen, center, rand, this.hooks);
  }

  update(dt: number, time: number, f: Flight, alive: boolean) {
    const pcx = Math.floor(f.pos.x / CELL);
    const pcz = Math.floor(f.pos.z / CELL);
    const keep = new Set<string>();
    for (let i = -CELL_RADIUS; i <= CELL_RADIUS; i++) {
      for (let j = -CELL_RADIUS; j <= CELL_RADIUS; j++) {
        const k = `${pcx + i},${pcz + j}`;
        keep.add(k);
        if (!this.cells.has(k)) this.cells.set(k, this.cellFeature(pcx + i, pcz + j));
      }
    }
    for (const [k, ft] of this.cells) {
      if (keep.has(k)) continue;
      if (ft && ft === (this.activeBalloons as unknown as Feature)) continue;
      ft?.dispose();
      this.cells.delete(k);
    }
    if (!this.prev.lengthSq()) this.prev.copy(f.pos);
    this.banner = null;
    for (const ft of this.cells.values()) if (ft) ft.update(dt, time, f, alive ? this.prev : f.pos);
    for (const fl of this.flocks) fl.update(dt, time, f, alive, this.hooks);
    // Piezas legendarias
    for (const p of [...this.pieces]) {
      p.update(time, f.pos);
      if (alive && p.pos.distanceTo(f.pos) < 14) {
        const got = collectedPieces();
        got.add(p.id);
        saveCollected(got);
        p.dispose();
        this.pieces.splice(this.pieces.indexOf(p), 1);
        this.hooks.sparks(p.pos, 80);
        this.hooks.sound('win');
        this.hooks.reward(50);
        this.hooks.stat('legendPieces', got.size, true);
        this.hooks.big(`PIEZA LEGENDARIA ${got.size}/${LEGEND_TOTAL}`);
        if (got.size >= LEGEND_TOTAL) this.hooks.toast('¡Has reunido el avión legendario Aurora! Míralo en el hangar', 4000);
      }
    }
    if (this.activeBalloons) {
      const b = this.activeBalloons;
      this.banner = { text: `Globos ${b.popped}/${b.total} · ${Math.ceil(b.timeLeft)} s`, kind: b.timeLeft < 4 ? 'warn' : 'info' };
    }
    this.prev.copy(f.pos);
  }

  /** Globos que se pueden reventar a tiros */
  targets(): Target[] {
    const out: Target[] = [];
    for (const ft of this.cells.values()) if (ft instanceof Balloons) out.push(...ft.targets());
    return out;
  }

  hitBalloon(id: string) {
    for (const ft of this.cells.values()) if (ft instanceof Balloons && ft.pop(id)) return true;
    return false;
  }

  radar(items: RadarItem[], me: THREE.Vector3) {
    for (const ft of this.cells.values()) ft?.radar(items, me);
    for (const p of this.pieces) if (p.pos.distanceTo(me) < 450) items.push({ pos: p.pos, kind: 'power', color: '#ffd76a', label: '?' });
  }

  dispose() {
    for (const ft of this.cells.values()) ft?.dispose();
    this.cells.clear();
    for (const fl of this.flocks) fl.dispose();
    for (const p of this.pieces) p.dispose();
    this.pieces = [];
  }

  /** Para las demás piezas del juego */
  get fxRef() {
    return this.fx;
  }
}

// ------------------------------------------------------------ Almacén de piezas
export function collectedPieces(): Set<string> {
  try {
    const l = JSON.parse(store.get('legend') ?? '[]') as string[];
    return new Set(Array.isArray(l) ? l : []);
  } catch {
    return new Set();
  }
}

function saveCollected(s: Set<string>) {
  store.set('legend', JSON.stringify([...s]));
}

// ------------------------------------------------------------ Túnel de viento
class WindTunnel implements Feature {
  kind = 'tunnel' as const;
  group = new THREE.Group();
  private curve: THREE.CatmullRomCurve3;
  private samples: THREE.Vector3[] = [];
  private len: number;
  private streaks: THREE.InstancedMesh;
  private streakU: Float32Array;
  private streakA: Float32Array;
  private streakR: Float32Array;
  private riding = false;
  private rideFrom = 0;
  private best = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private t = new THREE.Vector3();
  private p = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    gen: CityGen,
    center: THREE.Vector3,
    rand: () => number,
    private hooks: SkyFunHooks,
  ) {
    const yaw = rand() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const pts: THREE.Vector3[] = [];
    const n = 6;
    const length = 900 + rand() * 400;
    const baseY = 150 + rand() * 120;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1) - 0.5;
      const p = center.clone().addScaledVector(dir, k * length).addScaledVector(side, Math.sin(i * 1.3 + rand()) * 140);
      p.y = Math.max(baseY + Math.sin(i * 0.9) * 60, gen.maxHeightNear(p.x, p.z, 60) + 45);
      pts.push(p);
    }
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.len = this.curve.getLength();
    for (let i = 0; i <= 80; i++) this.samples.push(this.curve.getPointAt(i / 80));
    // Aros guía (translúcidos, sin brillo)
    const ringGeo = new THREE.TorusGeometry(26, 0.7, 6, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0.35, depthWrite: false });
    const rings = Math.floor(this.len / 70);
    for (let i = 0; i <= rings; i++) {
      const u = i / rings;
      const r = new THREE.Mesh(ringGeo, ringMat);
      this.curve.getPointAt(u, r.position);
      this.curve.getTangentAt(u, this.t);
      r.lookAt(r.position.clone().add(this.t));
      this.group.add(r);
    }
    // Boca de entrada más visible
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(30, 1.8, 8, 40), new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.75 }));
    this.curve.getPointAt(0, mouth.position);
    this.curve.getTangentAt(0, this.t);
    mouth.lookAt(mouth.position.clone().add(this.t));
    this.group.add(mouth);
    // Corrientes: trazos que fluyen en espiral
    const N = 90;
    this.streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 9), new THREE.MeshBasicMaterial({ color: 0xe6f6ff, transparent: true, opacity: 0.55, depthWrite: false }), N);
    this.streaks.frustumCulled = false;
    this.streakU = new Float32Array(N);
    this.streakA = new Float32Array(N);
    this.streakR = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.streakU[i] = rand();
      this.streakA[i] = rand() * Math.PI * 2;
      this.streakR[i] = 6 + rand() * 16;
    }
    this.group.add(this.streaks);
    scene.add(this.group);
  }

  private nearest(pos: THREE.Vector3) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const d = this.samples[i].distanceToSquared(pos);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return { u: bi / (this.samples.length - 1), d: Math.sqrt(bd) };
  }

  update(dt: number, time: number, f: Flight) {
    // Animación de las corrientes
    for (let i = 0; i < this.streakU.length; i++) {
      this.streakU[i] = (this.streakU[i] + (dt * 160) / this.len) % 1;
      const u = this.streakU[i];
      this.curve.getPointAt(u, this.p);
      this.curve.getTangentAt(u, this.t);
      const a = this.streakA[i] + u * 18 + time * 0.8;
      const side = new THREE.Vector3(this.t.z, 0, -this.t.x).normalize();
      const up = new THREE.Vector3().crossVectors(side, this.t).normalize();
      this.p.addScaledVector(side, Math.cos(a) * this.streakR[i]).addScaledVector(up, Math.sin(a) * this.streakR[i]);
      this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.t);
      this.m.compose(this.p, this.q, new THREE.Vector3(1, 1, 1));
      this.streaks.setMatrixAt(i, this.m);
    }
    this.streaks.instanceMatrix.needsUpdate = true;
    // ¿Dentro del túnel y en su sentido?
    if (f.pos.distanceToSquared(this.samples[40]) > 1200 * 1200) return;
    const { u, d } = this.nearest(f.pos);
    this.curve.getTangentAt(u, this.t);
    const along = f.forward().dot(this.t);
    const inside = d < 30 && along > 0.35 && u < 0.995;
    if (inside) {
      if (!this.riding) {
        this.riding = true;
        this.rideFrom = u;
        this.best = u;
        this.hooks.sound('whoosh');
        this.hooks.toast('¡Túnel de viento!', 900);
      }
      this.best = Math.max(this.best, u);
      // El viento empuja y guía suavemente por el túnel
      f.burst = Math.max(f.burst, 0.3);
      const yaw = Math.atan2(-this.t.x, -this.t.z);
      let dy = yaw - f.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      f.yaw += dy * Math.min(1, dt * 2.5);
      const pitch = Math.asin(THREE.MathUtils.clamp(this.t.y, -1, 1));
      f.pitch += (pitch - f.pitch) * Math.min(1, dt * 2.5);
      // y hacia el eje
      this.curve.getPointAt(u, this.p);
      f.pos.lerp(this.p, Math.min(1, dt * 0.8));
    } else if (this.riding) {
      this.riding = false;
      const covered = this.best - this.rideFrom;
      if (covered > 0.6) {
        this.hooks.trick('Túnel de viento', 200);
        this.hooks.reward(10);
      }
    }
  }

  radar(items: RadarItem[], me: THREE.Vector3) {
    const m = this.samples[0];
    if (m.distanceTo(me) < 2600) items.push({ pos: m, kind: 'power', color: '#9fe0ff', label: 'V' });
  }

  dispose() {
    this.scene.remove(this.group);
    disposeGroup(this.group);
  }
}

// ------------------------------------------------------------ Globos
const BALLOON_COLORS = [0xe84a4a, 0xf0b030, 0x3a9ae8, 0x58c060, 0xc060e0, 0xf07ab0];

export class Balloons implements Feature {
  kind = 'balloons' as const;
  group = new THREE.Group();
  total: number;
  popped = 0;
  timeLeft = 15;
  private list: { id: string; mesh: THREE.Group; base: THREE.Vector3; target: Target; alive: boolean; phase: number }[] = [];
  private started = false;
  private done = false;
  private center: THREE.Vector3;

  constructor(
    private scene: THREE.Scene,
    gen: CityGen,
    center: THREE.Vector3,
    rand: () => number,
    private hooks: SkyFunHooks,
    private owner: SkyFun,
  ) {
    this.center = center.clone();
    this.center.y = Math.max(140 + rand() * 120, gen.maxHeightNear(center.x, center.z, 120) + 50);
    this.total = 6 + Math.floor(rand() * 3);
    const geo = new THREE.SphereGeometry(5, 12, 10);
    geo.scale(1, 1.2, 1);
    const knotGeo = new THREE.ConeGeometry(1, 1.6, 6);
    const strGeo = new THREE.BoxGeometry(0.15, 9, 0.15);
    const strMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    for (let i = 0; i < this.total; i++) {
      const a = (i / this.total) * Math.PI * 2 + rand();
      const r = 30 + rand() * 70;
      const base = this.center.clone().add(new THREE.Vector3(Math.cos(a) * r, (rand() - 0.5) * 50, Math.sin(a) * r));
      const color = BALLOON_COLORS[i % BALLOON_COLORS.length];
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.25) });
      g.add(new THREE.Mesh(geo, mat));
      const knot = new THREE.Mesh(knotGeo, mat);
      knot.position.y = -6.4;
      knot.rotation.x = Math.PI;
      const str = new THREE.Mesh(strGeo, strMat);
      str.position.y = -11.5;
      g.add(knot, str);
      g.position.copy(base);
      this.group.add(g);
      const id = `bal-${Math.round(center.x)}-${Math.round(center.z)}-${i}`;
      this.list.push({ id, mesh: g, base, target: { id, name: 'Globo', pos: g.position, vel: new THREE.Vector3(), radius: 6, alive: true }, alive: true, phase: rand() * 10 });
    }
    scene.add(this.group);
  }

  targets() {
    return this.list.filter((b) => b.alive).map((b) => b.target);
  }

  pop(id: string) {
    const b = this.list.find((x) => x.id === id && x.alive);
    if (!b || this.done) return false;
    b.alive = false;
    b.target.alive = false;
    b.mesh.visible = false;
    this.popped++;
    this.hooks.sparks(b.mesh.position, 25);
    this.hooks.sound('pop');
    this.hooks.reward(3);
    if (!this.started) {
      this.started = true;
      this.owner.activeBalloons = this;
      this.hooks.toast(`¡Revienta los ${this.total} globos en ${this.timeLeft} s!`, 1600);
    }
    if (this.popped >= this.total) {
      this.done = true;
      this.owner.activeBalloons = null;
      this.hooks.trick('Racimo completo', 300);
      this.hooks.reward(80);
      this.hooks.stat('balloonClusters', 1);
      this.hooks.big('¡RACIMO COMPLETO! +80');
    }
    return true;
  }

  update(dt: number, time: number, f: Flight) {
    for (const b of this.list) {
      if (!b.alive) continue;
      b.mesh.position.set(b.base.x + Math.sin(time * 0.6 + b.phase) * 3, b.base.y + Math.sin(time * 0.9 + b.phase) * 4, b.base.z);
      if (b.mesh.position.distanceTo(f.pos) < 10) this.pop(b.id);
    }
    if (this.started && !this.done) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.done = true;
        this.owner.activeBalloons = null;
        this.hooks.sound('fail');
        this.hooks.toast(`Se escaparon los globos · ${this.popped}/${this.total}`, 1800);
        for (const b of this.list) if (b.alive) b.base.y += 2000;
      }
    }
  }

  radar(items: RadarItem[], me: THREE.Vector3) {
    if (this.done || this.center.distanceTo(me) > 2200) return;
    items.push({ pos: this.center, kind: 'power', color: '#f07ab0', label: 'G' });
  }

  dispose() {
    if (this.owner.activeBalloons === this) this.owner.activeBalloons = null;
    this.scene.remove(this.group);
    disposeGroup(this.group);
  }
}

// ------------------------------------------------------------ Rampa e islas flotantes
class Ramp implements Feature {
  kind = 'ramp' as const;
  group = new THREE.Group();
  private rings: { pos: THREE.Vector3; mesh: THREE.Mesh; taken: boolean }[] = [];
  private dir: THREE.Vector3;
  private start: THREE.Vector3;
  private islandsCenter: THREE.Vector3;

  constructor(
    private scene: THREE.Scene,
    gen: CityGen,
    center: THREE.Vector3,
    rand: () => number,
    private hooks: SkyFunHooks,
  ) {
    const yaw = rand() * Math.PI * 2;
    this.dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.start = center.clone();
    this.start.y = Math.max(140, gen.maxHeightNear(center.x, center.z, 100) + 60);
    const ringGeo = new THREE.TorusGeometry(17, 2, 8, 28);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.95, 0.55) });
    const n = 6;
    for (let i = 0; i < n; i++) {
      const p = this.start.clone().addScaledVector(this.dir, i * 85);
      p.y += i * i * 9 + i * 30;
      const m = new THREE.Mesh(ringGeo, ringMat);
      m.position.copy(p);
      const next = this.start.clone().addScaledVector(this.dir, (i + 1) * 85);
      next.y += (i + 1) * (i + 1) * 9 + (i + 1) * 30;
      m.lookAt(next);
      this.group.add(m);
      this.rings.push({ pos: p, mesh: m, taken: false });
    }
    // Montañas flotantes por encima de las nubes (al final de la rampa)
    const last = this.rings[n - 1].pos;
    this.islandsCenter = last.clone().addScaledVector(this.dir, 500);
    this.islandsCenter.y = last.y + 480;
    this.realm = new FloatingRealm(this.group, this.islandsCenter, this.dir, rand, gen.stage.night, hooks);
    scene.add(this.group);
  }

  private realm: FloatingRealm;

  update(dt: number, time: number, f: Flight, prev: THREE.Vector3) {
    void prev;
    for (const [i, r] of this.rings.entries()) {
      r.mesh.rotation.z += dt * 0.8;
      if (!r.taken && r.pos.distanceTo(f.pos) < 19) {
        r.taken = true;
        f.burst = Math.max(f.burst, 2.5);
        f.pitch = Math.max(f.pitch, 0.35 + i * 0.07);
        this.hooks.sound('whoosh');
        if (i === this.rings.length - 1) {
          f.pitch = Math.max(f.pitch, 0.75);
          f.burst = 4.5;
          this.hooks.trick('¡Lanzado!', 150);
          this.hooks.big('¡LANZADO! Islas flotantes arriba');
        }
        // los aros vuelven a estar disponibles al cabo de un rato
        setTimeout(() => (r.taken = false), 8000);
      }
    }
    this.realm.update(dt, time, f);
  }

  radar(items: RadarItem[], me: THREE.Vector3) {
    if (this.start.distanceTo(me) < 2600) items.push({ pos: this.start, kind: 'power', color: '#7ff09a', label: 'R' });
    if (this.islandsCenter.distanceTo(me) < 3500) items.push({ pos: this.islandsCenter, kind: 'power', color: '#7fe8d0', label: 'M' });
  }

  dispose() {
    this.scene.remove(this.group);
    disposeGroup(this.group);
  }
}

// ------------------------------------------------------------ Montañas flotantes
/**
 * Montañas de roca suspendidas en el aire, con lianas, cascadas que caen al vacío,
 * arcos de piedra, neblina y plantas que brillan de noche. Cada elemento sirve para algo:
 * cascada = reparación, arcos = recarga de munición, nido = recompensa, corriente = subida.
 */
class FloatingRealm {
  private falls: { pos: THREE.Vector3; w: number; h: number; mesh: THREE.Mesh; cool: number }[] = [];
  private arches: { center: THREE.Vector3; normal: THREE.Vector3; r: number; cool: number }[] = [];
  private nest: { pos: THREE.Vector3; orb: THREE.Group; respawn: number } | null = null;
  private orbs: { mesh: THREE.Mesh; taken: boolean }[] = [];
  private updraft: { pos: THREE.Vector3; r: number; h: number; streaks: THREE.InstancedMesh; u: Float32Array } | null = null;
  private glowMats: THREE.MeshBasicMaterial[] = [];
  private hinted = false;
  private m4 = new THREE.Matrix4();

  constructor(
    private group: THREE.Group,
    private center: THREE.Vector3,
    dir: THREE.Vector3,
    rand: () => number,
    private night: boolean,
    private hooks: SkyFunHooks,
  ) {
    const rock = new THREE.MeshLambertMaterial({ color: 0x7c7466, flatShading: true });
    const rockDark = new THREE.MeshLambertMaterial({ color: 0x5a544a, flatShading: true });
    const grass = new THREE.MeshLambertMaterial({ color: 0x4f9a3c });
    const moss = new THREE.MeshLambertMaterial({ color: 0x3c7a34 });
    const vine = new THREE.MeshLambertMaterial({ color: 0x2f6a2c });
    const glowA = new THREE.MeshBasicMaterial({ color: night ? new THREE.Color(0.35, 0.95, 0.9) : new THREE.Color(0.55, 0.8, 0.5) });
    const glowB = new THREE.MeshBasicMaterial({ color: night ? new THREE.Color(0.75, 0.45, 1) : new THREE.Color(0.85, 0.6, 0.9) });
    this.glowMats.push(glowA, glowB);
    const side = new THREE.Vector3(dir.z, 0, -dir.x);

    // Tres montañas: una grande y dos menores
    const mounts: { c: THREE.Vector3; r: number; h: number }[] = [
      { c: center.clone(), r: 70, h: 170 },
      { c: center.clone().addScaledVector(side, 230).addScaledVector(dir, 60).add(new THREE.Vector3(0, -40 + rand() * 30, 0)), r: 46, h: 115 },
      { c: center.clone().addScaledVector(side, -210).addScaledVector(dir, -40).add(new THREE.Vector3(0, 30 + rand() * 40, 0)), r: 40, h: 100 },
    ];
    for (const [k, mt] of mounts.entries()) {
      const g = new THREE.Group();
      g.position.copy(mt.c);
      // Cuerpo: capas de roca que se estrechan hacia abajo como una raíz colgante
      const layers = 9;
      for (let l = 0; l < layers; l++) {
        const t = l / (layers - 1);
        const rr = mt.r * (1 - t * 0.85) * (0.9 + rand() * 0.2);
        const hh = mt.h / layers;
        const geo = new THREE.CylinderGeometry(rr, rr * 0.82, hh, 7);
        const b = new THREE.Mesh(geo, l % 3 === 1 ? rockDark : rock);
        b.position.set((rand() - 0.5) * mt.r * 0.12, -hh / 2 - l * hh, (rand() - 0.5) * mt.r * 0.12);
        b.rotation.y = rand() * Math.PI;
        g.add(b);
      }
      // Picos en la cima
      for (let q = 0; q < 3; q++) {
        const pr = mt.r * (0.25 + rand() * 0.2);
        const peak = new THREE.Mesh(new THREE.ConeGeometry(pr, mt.r * (0.5 + rand() * 0.5), 6), rock);
        const a = rand() * Math.PI * 2;
        peak.position.set(Math.cos(a) * mt.r * 0.35, mt.r * 0.25, Math.sin(a) * mt.r * 0.35);
        g.add(peak);
      }
      // Manto verde y árboles
      const top = new THREE.Mesh(new THREE.CylinderGeometry(mt.r * 1.02, mt.r * 0.98, 5, 7), grass);
      top.position.y = 1;
      g.add(top);
      for (let q = 0; q < 6 + k * 2; q++) {
        const a = rand() * Math.PI * 2;
        const d = rand() * mt.r * 0.8;
        const h = 10 + rand() * 14;
        const trunk = new THREE.Mesh(new THREE.BoxGeometry(2.2, h, 2.2), rockDark);
        trunk.position.set(Math.cos(a) * d, 3 + h / 2, Math.sin(a) * d);
        const crown = new THREE.Mesh(new THREE.BoxGeometry(10 + rand() * 6, 7, 10 + rand() * 6), moss);
        crown.position.set(trunk.position.x, 3 + h + 2, trunk.position.z);
        g.add(trunk, crown);
      }
      // Lianas colgando del borde
      for (let q = 0; q < 14; q++) {
        const a = (q / 14) * Math.PI * 2 + rand() * 0.3;
        const len = 25 + rand() * mt.h * 0.6;
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.9, len, 0.9), vine);
        v.position.set(Math.cos(a) * mt.r * 0.95, -len / 2, Math.sin(a) * mt.r * 0.95);
        g.add(v);
      }
      // Plantas luminosas (de noche brillan)
      for (let q = 0; q < 16; q++) {
        const a = rand() * Math.PI * 2;
        const d = rand() * mt.r * 0.9;
        const pl = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 1.6), q % 2 ? glowA : glowB);
        pl.position.set(Math.cos(a) * d, 4.5, Math.sin(a) * d);
        g.add(pl);
      }
      // Neblina bajo la montaña
      const mistMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false });
      for (let q = 0; q < 5; q++) {
        const mist = new THREE.Mesh(new THREE.SphereGeometry(mt.r * (0.5 + rand() * 0.4), 8, 6), mistMat);
        mist.scale.y = 0.35;
        mist.position.set((rand() - 0.5) * mt.r, -mt.h * (0.5 + rand() * 0.5), (rand() - 0.5) * mt.r);
        g.add(mist);
      }
      this.group.add(g);
      // Tesoro dorado en cada montaña
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.84, 0.35) }));
      orb.position.copy(mt.c).add(new THREE.Vector3(0, -mt.h * 0.45, mt.r * 1.25));
      this.group.add(orb);
      this.orbs.push({ mesh: orb, taken: false });
    }

    // Cascada que cae de la montaña grande al vacío (repara el avión)
    const big = mounts[0];
    for (const sgn of [1, -1]) {
      const fpos = big.c.clone().addScaledVector(dir, sgn * big.r * 0.98);
      const h = 220;
      const w = 16;
      const fallMat = new THREE.MeshBasicMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 1, 8), fallMat);
      fall.position.copy(fpos).add(new THREE.Vector3(0, -h / 2 + 3, 0)).addScaledVector(dir, sgn * 2);
      fall.lookAt(fall.position.clone().addScaledVector(dir, sgn));
      this.group.add(fall);
      const spray = new THREE.Mesh(new THREE.SphereGeometry(22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
      spray.scale.y = 0.5;
      spray.position.copy(fpos).add(new THREE.Vector3(0, -h + 10, 0)).addScaledVector(dir, sgn * 4);
      this.group.add(spray);
      this.falls.push({ pos: fpos.clone().add(new THREE.Vector3(0, -h / 2, 0)).addScaledVector(dir, sgn * 2), w, h, mesh: fall, cool: 0 });
    }

    // Arcos de piedra entre montañas (recargan munición y misiles)
    for (const other of [mounts[1], mounts[2]]) {
      const mid = big.c.clone().lerp(other.c, 0.5);
      mid.y = Math.min(big.c.y, other.c.y) - 30;
      const normal = other.c.clone().sub(big.c).setY(0).normalize();
      const flyDir = new THREE.Vector3(normal.z, 0, -normal.x);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(30, 6, 6, 14), rock);
      arch.position.copy(mid);
      arch.lookAt(mid.clone().add(flyDir));
      this.group.add(arch);
      for (let q = 0; q < 6; q++) {
        const a = -Math.PI / 2 + (q - 2.5) * 0.35;
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.8, 14 + rand() * 10, 0.8), vine);
        const right = new THREE.Vector3().crossVectors(flyDir, new THREE.Vector3(0, 1, 0)).normalize();
        v.position.copy(mid).addScaledVector(right, Math.sin(a + Math.PI / 2) * 30).add(new THREE.Vector3(0, 30 * Math.cos(a + Math.PI / 2) - 8, 0));
        this.group.add(v);
      }
      // Cadenas de rocas que unen el arco a las montañas
      for (const end of [big.c, other.c]) {
        for (let q = 1; q < 6; q++) {
          const pt = mid.clone().lerp(end, q / 6);
          pt.y = mid.y + Math.sin((q / 6) * Math.PI) * 12 + (end.y - mid.y) * (q / 6) * 0.6;
          const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(3 + rand() * 3, 0), rockDark);
          rk.position.copy(pt);
          this.group.add(rk);
        }
      }
      this.arches.push({ center: mid, normal: flyDir, r: 26, cool: 0 });
    }

    // Nido en la cima de la montaña grande (recompensa que reaparece)
    const nestPos = big.c.clone().add(new THREE.Vector3(0, 14, 0));
    const nestG = new THREE.Group();
    for (let q = 0; q < 10; q++) {
      const a = (q / 10) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 3), rockDark);
      st.position.set(Math.cos(a) * 12, 0, Math.sin(a) * 12);
      st.rotation.y = -a;
      nestG.add(st);
    }
    nestG.position.copy(nestPos).add(new THREE.Vector3(0, -6, 0));
    this.group.add(nestG);
    const orbG = new THREE.Group();
    orbG.add(new THREE.Mesh(new THREE.IcosahedronGeometry(5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.95, 1) })));
    orbG.add(new THREE.Mesh(new THREE.TorusGeometry(8, 0.6, 6, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.95, 1) })));
    orbG.position.copy(nestPos);
    this.group.add(orbG);
    this.nest = { pos: nestPos, orb: orbG, respawn: 0 };

    // Corriente ascendente junto a la montaña grande
    const upPos = big.c.clone().addScaledVector(side, big.r + 45);
    upPos.y = big.c.y - 260;
    const N = 70;
    const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 10, 0.6), new THREE.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.45, depthWrite: false }), N);
    streaks.frustumCulled = false;
    const u = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      u[i * 2] = rand();
      u[i * 2 + 1] = rand() * Math.PI * 2;
    }
    this.group.add(streaks);
    this.updraft = { pos: upPos, r: 34, h: 380, streaks, u };
  }

  update(dt: number, time: number, f: Flight) {
    const me = f.pos;
    const near = me.distanceTo(this.center);
    if (!this.hinted && near < 700) {
      this.hinted = true;
      this.hooks.toast('Montañas flotantes: la cascada repara, los arcos recargan, el nido da premio', 4200);
    }
    // Brillo suave de las plantas
    const k = this.night ? 0.85 + 0.15 * Math.sin(time * 1.6) : 1;
    this.glowMats[0].color.setRGB(this.night ? 0.35 * k : 0.55, this.night ? 0.95 * k : 0.8, this.night ? 0.9 * k : 0.5);
    // Cascadas
    for (const fl of this.falls) {
      fl.cool = Math.max(0, fl.cool - dt);
      (fl.mesh.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.1 * Math.sin(time * 6 + fl.pos.x);
      if (fl.cool > 0) continue;
      const dx = Math.hypot(me.x - fl.pos.x, me.z - fl.pos.z);
      if (dx < fl.w * 0.9 && Math.abs(me.y - fl.pos.y) < fl.h / 2) {
        fl.cool = 20;
        this.hooks.repair();
        this.hooks.sparks(me, 40);
        this.hooks.sound('pickup');
        this.hooks.big('💧 CASCADA: AVIÓN REPARADO');
        this.hooks.trick('Cascada', 120);
      }
    }
    // Arcos
    for (const ar of this.arches) {
      ar.cool = Math.max(0, ar.cool - dt);
      if (ar.cool > 0) continue;
      const rel = me.clone().sub(ar.center);
      const along = rel.dot(ar.normal);
      const radial = rel.addScaledVector(ar.normal, -along).length();
      if (Math.abs(along) < 10 && radial < ar.r) {
        ar.cool = 6;
        this.hooks.refill();
        this.hooks.sound('whoosh');
        this.hooks.big('🪨 ARCO DE PIEDRA: MUNICIÓN Y +1 MISIL');
        this.hooks.trick('Arco de piedra', 180);
      }
    }
    // Nido
    const n = this.nest!;
    if (n.respawn > 0) {
      n.respawn -= dt;
      n.orb.visible = n.respawn <= 0;
    } else {
      n.orb.rotation.y = time * 1.4;
      (n.orb.children[1] as THREE.Mesh).rotation.x = time * 2;
      n.orb.position.y = n.pos.y + Math.sin(time * 2) * 2;
      if (n.orb.position.distanceTo(me) < 16) {
        n.respawn = 60;
        n.orb.visible = false;
        const what = this.hooks.power();
        this.hooks.sparks(me, 60);
        this.hooks.sound('win');
        this.hooks.big(`🪺 NIDO: ${what.toUpperCase()}`);
      }
    }
    // Tesoros
    for (const o of this.orbs) {
      if (o.taken) continue;
      o.mesh.rotation.y = time * 1.5;
      if (o.mesh.position.distanceTo(me) < 14) {
        o.taken = true;
        o.mesh.visible = false;
        this.hooks.sparks(o.mesh.position, 40);
        this.hooks.sound('pickup');
        this.hooks.reward(25);
        const left = this.orbs.filter((x) => !x.taken).length;
        if (left === 0) {
          this.hooks.reward(60);
          this.hooks.trick('Explorador de las montañas', 250);
          this.hooks.big('¡TODOS LOS TESOROS! +60');
        } else this.hooks.toast(`Tesoro +25 · quedan ${left}`, 1300);
      }
    }
    // Corriente ascendente
    const up = this.updraft!;
    for (let i = 0; i < up.u.length / 2; i++) {
      up.u[i * 2] = (up.u[i * 2] + dt * 0.25) % 1;
      const a = up.u[i * 2 + 1] + time * 0.6;
      const r = up.r * (0.3 + ((i * 37) % 10) / 14);
      this.m4.makeTranslation(up.pos.x + Math.cos(a) * r, up.pos.y + up.u[i * 2] * up.h, up.pos.z + Math.sin(a) * r);
      up.streaks.setMatrixAt(i, this.m4);
    }
    up.streaks.instanceMatrix.needsUpdate = true;
    if (Math.hypot(me.x - up.pos.x, me.z - up.pos.z) < up.r && me.y > up.pos.y && me.y < up.pos.y + up.h) {
      me.y += 70 * dt;
      f.pitch += (0.5 - f.pitch) * Math.min(1, dt * 1.5);
      f.burst = Math.max(f.burst, 0.2);
    }
  }
}

// ------------------------------------------------------------ Paso imposible
class Gap implements Feature {
  kind = 'gap' as const;
  group = new THREE.Group();
  private cooldown = 0;

  /** Busca dos torres con un hueco estrecho entre ellas */
  static find(scene: THREE.Scene, gen: CityGen, center: THREE.Vector3, rand: () => number, hooks: SkyFunHooks): Gap | null {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = center.x + (rand() - 0.5) * 900;
      const z = center.z + (rand() - 0.5) * 900;
      const b = gen.block(Math.floor(x / PERIOD), Math.floor(z / PERIOD));
      const tall = b.buildings.filter((bb) => bb.h > 70 && bb.y0 === 0);
      for (const A of tall) {
        for (const B of tall) {
          if (A === B) continue;
          // separados en X, solapados en Z
          const gx = B.x0 - A.x1;
          const oz0 = Math.max(A.z0, B.z0);
          const oz1 = Math.min(A.z1, B.z1);
          if (gx >= 11 && gx <= 34 && oz1 - oz0 > 14) return new Gap(scene, 'x', A.x1, B.x0, (oz0 + oz1) / 2, Math.min(A.h, B.h), hooks);
          const gz = B.z0 - A.z1;
          const ox0 = Math.max(A.x0, B.x0);
          const ox1 = Math.min(A.x1, B.x1);
          if (gz >= 11 && gz <= 34 && ox1 - ox0 > 14) return new Gap(scene, 'z', A.z1, B.z0, (ox0 + ox1) / 2, Math.min(A.h, B.h), hooks);
        }
      }
    }
    return null;
  }

  /**
   * axis 'x': el hueco va de a a b en X y se cruza atravesando el plano z = c
   * axis 'z': el hueco va de a a b en Z y se cruza atravesando el plano x = c
   */
  private constructor(
    private scene: THREE.Scene,
    private axis: 'x' | 'z',
    private a: number,
    private b: number,
    private c: number,
    private top: number,
    private hooks: SkyFunHooks,
  ) {
    const y0 = 14;
    const y1 = top - 8;
    // Postes con franjas de aviso y barra superior
    const stripeA = new THREE.MeshBasicMaterial({ color: 0xf0c020 });
    const stripeB = new THREE.MeshBasicMaterial({ color: 0x202020 });
    const h = y1 - y0;
    for (const at of [a + 0.8, b - 0.8]) {
      for (let k = 0; k < Math.floor(h / 8); k++) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 8, 1.4), k % 2 ? stripeA : stripeB);
        const y = y0 + 4 + k * 8;
        if (axis === 'x') seg.position.set(at, y, c);
        else seg.position.set(c, y, at);
        this.group.add(seg);
      }
    }
    const bar = new THREE.Mesh(axis === 'x' ? new THREE.BoxGeometry(b - a, 1.2, 1.2) : new THREE.BoxGeometry(1.2, 1.2, b - a), stripeA);
    if (axis === 'x') bar.position.set((a + b) / 2, y1, c);
    else bar.position.set(c, y1, (a + b) / 2);
    this.group.add(bar);
    // Rótulo
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 64;
    const g = cv.getContext('2d')!;
    g.fillStyle = 'rgba(20,20,20,0.75)';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#f0c020';
    g.font = '900 30px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PASO IMPOSIBLE', 128, 34);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    label.scale.set(40, 10, 1);
    if (axis === 'x') label.position.set((a + b) / 2, y1 + 10, c);
    else label.position.set(c, y1 + 10, (a + b) / 2);
    this.group.add(label);
    this.scene.add(this.group);
  }

  update(dt: number, _time: number, f: Flight, prev: THREE.Vector3) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0) return;
    const p = f.pos;
    // ¿Cruza el plano del hueco entre los dos postes y por debajo de la barra?
    const crossed =
      this.axis === 'x'
        ? (prev.z - this.c) * (p.z - this.c) <= 0 && p.x > this.a && p.x < this.b
        : (prev.x - this.c) * (p.x - this.c) <= 0 && p.z > this.a && p.z < this.b;
    if (!crossed || p.y < 10 || p.y > this.top - 6) return;
    this.cooldown = 3;
    const knife = Math.abs(Math.sin(f.roll)) > 0.85;
    const pts = Math.round((knife ? 450 : 250) * (0.6 + Math.min(1, f.speedKmh / 1200) * 0.6));
    this.hooks.trick(knife ? 'Paso en cuchillo' : 'Paso imposible', pts);
    this.hooks.reward(knife ? 30 : 15);
    this.hooks.stat('impossiblePasses', 1);
    this.hooks.big(knife ? `¡PASO EN CUCHILLO! +${pts}` : `¡PASO IMPOSIBLE! +${pts}`);
    this.hooks.sound('win');
  }

  radar(items: RadarItem[], me: THREE.Vector3) {
    const pos = this.axis === 'x' ? new THREE.Vector3((this.a + this.b) / 2, this.top / 2, this.c) : new THREE.Vector3(this.c, this.top / 2, (this.a + this.b) / 2);
    if (pos.distanceTo(me) < 1800) items.push({ pos, kind: 'power', color: '#f0c020', label: '!' });
  }

  dispose() {
    this.scene.remove(this.group);
    disposeGroup(this.group);
  }
}

// ------------------------------------------------------------ Bandadas de pájaros
class Flock {
  group = new THREE.Group();
  private birds: { g: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh; off: THREE.Vector3; pos: THREE.Vector3; vel: THREE.Vector3; hit: boolean }[] = [];
  private center = new THREE.Vector3();
  private heading = 0;
  private placed = false;
  private passCool = 0;
  private passArmed = false;
  private hitThisPass = false;

  constructor(
    private scene: THREE.Scene,
    private index: number,
  ) {
    const body = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 2.4), body));
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), dark);
      head.position.set(0, 0.2, -1.3);
      g.add(head);
      const wingL = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 1.2), body);
      wingL.geometry.translate(-1.3, 0, 0);
      const wingR = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 1.2), body);
      wingR.geometry.translate(1.3, 0, 0);
      g.add(wingL, wingR);
      g.scale.setScalar(2.3);
      this.group.add(g);
      const off = new THREE.Vector3((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 40);
      this.birds.push({ g, wingL, wingR, off, pos: new THREE.Vector3(), vel: new THREE.Vector3(), hit: false });
    }
    scene.add(this.group);
  }

  private place(f: Flight) {
    const ang = f.yaw + (Math.random() - 0.5) * 1.6 + this.index * 0.7;
    const d = 900 + Math.random() * 900;
    this.center.set(f.pos.x - Math.sin(ang) * d, Math.max(120, f.pos.y + (Math.random() - 0.5) * 120), f.pos.z - Math.cos(ang) * d);
    this.heading = Math.random() * Math.PI * 2;
    for (const b of this.birds) {
      b.pos.copy(this.center).add(b.off);
      b.vel.set(0, 0, 0);
    }
    this.placed = true;
  }

  update(dt: number, time: number, f: Flight, alive: boolean, hooks: SkyFunHooks) {
    if (!this.placed || this.center.distanceTo(f.pos) > 3000) this.place(f);
    this.passCool = Math.max(0, this.passCool - dt);
    // La bandada avanza despacio y gira
    this.heading += dt * 0.12 * (this.index % 2 ? 1 : -1);
    this.center.x += -Math.sin(this.heading) * 22 * dt;
    this.center.z += -Math.cos(this.heading) * 22 * dt;
    this.center.y = Math.max(this.center.y, 110);
    const toPlayer = f.pos.distanceTo(this.center);
    for (const b of this.birds) {
      const goal = this.center.clone().add(b.off);
      const steer = goal.sub(b.pos).multiplyScalar(0.8);
      // Huir del avión cuando se acerca
      const away = b.pos.clone().sub(f.pos);
      const d = away.length();
      if (d < 70) steer.addScaledVector(away.normalize(), (70 - d) * 6);
      b.vel.lerp(steer, Math.min(1, dt * 2));
      b.pos.addScaledVector(b.vel, dt);
      b.g.position.copy(b.pos);
      if (b.vel.lengthSq() > 4) b.g.lookAt(b.pos.clone().add(b.vel));
      const flap = Math.sin(time * 14 + b.off.x) * 0.7;
      b.wingL.rotation.z = flap;
      b.wingR.rotation.z = -flap;
      if (alive && d < 4.5 && !b.hit) {
        b.hit = true;
        this.hitThisPass = true;
        hooks.damage(4);
        hooks.sparks(b.pos, 12);
        hooks.sound('hit');
        hooks.toast('¡Pájaro! Vuela entre ellos sin tocarlos', 1200);
        setTimeout(() => (b.hit = false), 3000);
      }
    }
    // Pasada limpia por el centro de la bandada
    if (toPlayer < 40 && !this.passArmed && this.passCool <= 0) {
      this.passArmed = true;
      this.hitThisPass = false;
    }
    if (this.passArmed && toPlayer > 90) {
      this.passArmed = false;
      this.passCool = 6;
      if (!this.hitThisPass && alive) {
        hooks.trick('Vuelo limpio entre pájaros', 120);
        hooks.reward(5);
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    disposeGroup(this.group);
  }
}

// ------------------------------------------------------------ Pieza legendaria
class Piece {
  group = new THREE.Group();

  constructor(
    private scene: THREE.Scene,
    public id: string,
    public pos: THREE.Vector3,
  ) {
    const gold = new THREE.MeshLambertMaterial({ color: 0xffc84a, emissive: 0x6a4a10 });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(4, 0), gold);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.8, 6, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.4) }));
    this.group.add(core, ring);
    this.group.position.copy(pos);
    scene.add(this.group);
  }

  update(time: number, me: THREE.Vector3) {
    this.group.rotation.y = time * 1.2;
    (this.group.children[1] as THREE.Mesh).rotation.x = time * 1.7;
    this.group.position.y = this.pos.y + Math.sin(time * 2) * 1.5;
    this.group.visible = this.pos.distanceTo(me) < 900;
  }

  dispose() {
    this.scene.remove(this.group);
    disposeGroup(this.group);
  }
}

void (null as unknown as Box);
