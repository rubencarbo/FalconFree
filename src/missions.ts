import * as THREE from 'three';
import { mulberry32 } from './world/noise';
import type { CityGen } from './world/city';

/**
 * Cadena de retos: al completar uno aparece el siguiente, cada vez más difícil,
 * y cada pocos niveles se desbloquea un evento (frenesí ×3, aves de luz, turbo, aurora…).
 * En multijugador el reto es del equipo: el estado vive en rooms/{code}/mission/{equipo}
 * y cualquiera del equipo suma progreso.
 *
 * También gestiona los obstáculos del cielo (minas flotantes y barreras láser), que
 * crecen con el nivel de reto y con el tiempo de partida.
 */

export type MissionKind = 'blink' | 'colors' | 'slalom' | 'low' | 'speed' | 'orb';

/** Estado del reto (se comparte tal cual por la red) */
export interface MissionNet {
  lvl: number;
  kind: MissionKind;
  prog: number;
  goal: number;
  seed: number;
  /** punto de anclaje y rumbo de quien abrió el reto */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** quién completó el anterior */
  bn?: string;
  /** aros ya cogidos (aros relámpago) */
  taken?: Record<string, boolean>;
}

export type MissionAction = { lvl: number; type: 'ring'; idx: number } | { lvl: number; type: 'secs'; v: number } | { lvl: number; type: 'reset' };

export const MISSION_INFO: Record<MissionKind, { title: string; icon: string; desc: (m: MissionNet) => string }> = {
  blink: { title: 'Aros relámpago', icon: '⚡', desc: (m) => `Atraviesa ${m.goal} aros · si parpadean, ×3` },
  colors: { title: 'Arcoíris', icon: '🌈', desc: (m) => `Pasa ${m.goal} aros de colores en orden` },
  slalom: { title: 'Slalom', icon: '〰️', desc: (m) => `Encadena ${m.goal} aros sin dejar que se apague el tiempo` },
  low: { title: 'Rasante', icon: '🏙️', desc: (m) => `Vuela por debajo de 70 m durante ${m.goal} s` },
  speed: { title: 'Supersónico', icon: '💨', desc: (m) => `Supera los 950 km/h durante ${m.goal} s` },
  orb: { title: 'Caza la chispa', icon: '✨', desc: (m) => `Atrapa ${m.goal} chispas que huyen` },
};

const KINDS: MissionKind[] = ['blink', 'colors', 'slalom', 'orb', 'low', 'speed'];
const COLORS = [0xff4a4a, 0xffb020, 0x40e070, 0x40a0ff, 0xb060ff, 0xff60c0];
const RING_R = 22;
/** Ciclo de parpadeo de los aros relámpago (s) y parte en la que parpadean (×3) */
const BLINK_CYCLE = 9;
const BLINK_ON = 3.5;
/** Ventana de tiempo entre aros del slalom (s) */
export const SLALOM_WINDOW = (lvl: number) => Math.max(4.5, 8 - lvl * 0.35);
export const LOW_AGL = 70;
export const FAST_KMH = 950;

/** Crea el reto de un nivel (determinista: mismo resultado en todos los clientes) */
export function makeMission(lvl: number, seed: number, at: { x: number; y: number; z: number }, yaw: number, prev?: MissionKind, bn?: string): MissionNet {
  const r = mulberry32(seed);
  let kind = KINDS[Math.floor(r() * KINDS.length)];
  if (lvl === 1) kind = 'blink';
  if (kind === prev) kind = KINDS[(KINDS.indexOf(kind) + 1 + Math.floor(r() * (KINDS.length - 1))) % KINDS.length];
  const L = lvl;
  const goal =
    kind === 'blink' ? Math.min(4 + L, 10)
    : kind === 'colors' ? Math.min(3 + Math.floor(L / 2), 6)
    : kind === 'slalom' ? Math.min(5 + L, 12)
    : kind === 'orb' ? Math.min(2 + Math.floor(L / 2), 5)
    : kind === 'low' ? Math.min(6 + 2 * L, 22)
    : Math.min(5 + L, 15);
  const m: MissionNet = { lvl, kind, prog: 0, goal, seed, x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z), yaw: Math.round(yaw * 1000) / 1000 };
  if (bn) m.bn = bn.slice(0, 16);
  return m;
}

/**
 * Aplica una acción al reto. Devuelve el estado nuevo, o undefined si no cambia nada
 * (acción vieja, aro repetido, orden incorrecto…). Se usa igual en local y dentro de la
 * transacción de Firebase.
 */
export function advanceMission(cur: MissionNet, a: MissionAction, me: { x: number; y: number; z: number; yaw: number; name: string }, newSeed: number): MissionNet | undefined {
  if (!cur || cur.lvl !== a.lvl) return undefined;
  const m: MissionNet = { ...cur, taken: { ...(cur.taken ?? {}) } };
  if (a.type === 'reset') {
    if (m.kind !== 'slalom' || m.prog === 0) return undefined;
    m.prog = 0;
  } else if (a.type === 'secs') {
    if (m.kind !== 'low' && m.kind !== 'speed') return undefined;
    m.prog = Math.min(m.goal, Math.round((m.prog + a.v) * 10) / 10);
  } else {
    if (m.kind === 'blink') {
      if (m.taken![a.idx]) return undefined;
      m.taken![a.idx] = true;
      m.prog++;
    } else if (m.kind === 'colors' || m.kind === 'slalom' || m.kind === 'orb') {
      if (a.idx !== m.prog) return undefined;
      m.prog++;
    } else return undefined;
  }
  if (!Object.keys(m.taken!).length) delete m.taken;
  if (m.prog >= m.goal) return makeMission(cur.lvl + 1, newSeed, me, me.yaw, cur.kind, me.name);
  return m;
}

/** Evento que se desbloquea al completar un nivel */
export type MissionReward = 'frenzy' | 'birds' | 'turbo' | 'aurora' | 'shield' | 'credits';
export function rewardFor(lvl: number): MissionReward {
  const list: MissionReward[] = ['credits', 'frenzy', 'birds', 'turbo', 'aurora', 'shield', 'frenzy', 'credits'];
  return list[(lvl - 1) % list.length];
}

export interface MissionHooks {
  /** se ha cogido un aro / chispa (para puntos y sonido); x3 si parpadeaba o hay frenesí */
  ring(x3: boolean, label: string): void;
  /** reto completado (por mí o por el equipo) */
  complete(done: MissionNet, next: MissionNet, byName: string | null): void;
  /** aviso corto */
  toast(text: string, ms?: number): void;
  /** envía una acción (local o transacción en red) */
  act(a: MissionAction): void;
  /** ¿hay roca (isla flotante) en ese punto? */
  blocked?(p: THREE.Vector3): boolean;
}

interface RingObj {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  pos: THREE.Vector3;
  base: THREE.Color;
}

/** Reto activo: dibuja aros / chispa y detecta progreso */
export class Missions {
  state: MissionNet | null = null;
  private group = new THREE.Group();
  private rings: RingObj[] = [];
  private orb: THREE.Group | null = null;
  private orbMat: THREE.MeshBasicMaterial | null = null;
  private torus = new THREE.TorusGeometry(RING_R, 1.7, 8, 40);
  private builtKey = '';
  private secsAcc = 0;
  private flushT = 0;
  /** tiempo restante del slalom para el aro siguiente */
  slalomLeft = 0;
  /** frenesí: todo vale ×3 */
  frenzy = 0;
  /** posición actual de la chispa */
  orbPos = new THREE.Vector3();
  /** aro mal cogido (orden incorrecto): para avisar sin repetir */
  private wrongT = 0;
  private lastLvl = 0;
  private orbCool = 0;
  private blockT = 0;

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
    private hooks: MissionHooks,
    /** true = reto de equipo (multijugador) */
    public team = false,
  ) {
    scene.add(this.group);
  }

  /** Recibe un estado nuevo (local o de la red) */
  setState(next: MissionNet | null) {
    const prev = this.state;
    this.state = next;
    if (!next) {
      this.clear();
      return;
    }
    if (prev && next.lvl > prev.lvl) this.hooks.complete(prev, next, next.bn ?? null);
    if (next.lvl !== this.lastLvl) {
      this.lastLvl = next.lvl;
      this.slalomLeft = 0;
      this.secsAcc = 0;
    }
    if (next.kind === 'slalom' && next.prog === 0) this.slalomLeft = 0;
    // Slalom de equipo: si un compañero pasa un aro, el reloj vuelve a empezar para todos
    else if (next.kind === 'slalom' && prev && prev.lvl === next.lvl && next.prog > prev.prog) this.slalomLeft = SLALOM_WINDOW(next.lvl);
    this.build();
  }

  private clear() {
    for (const r of this.rings) {
      this.group.remove(r.mesh);
      r.mat.dispose();
    }
    this.rings = [];
    if (this.orb) {
      this.group.remove(this.orb);
      this.orb.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.orbMat?.dispose();
      this.orb = null;
    }
    this.builtKey = '';
  }

  /** Posiciones de los aros del reto (deterministas) */
  private layout(m: MissionNet): THREE.Vector3[] {
    const r = mulberry32(m.seed ^ 0x9e3779b9);
    const fwd = new THREE.Vector3(-Math.sin(m.yaw), 0, -Math.cos(m.yaw));
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const base = new THREE.Vector3(m.x, m.y, m.z);
    const out: THREE.Vector3[] = [];
    const lift = (p: THREE.Vector3, dy: number) => {
      p.y = Math.max(base.y + dy, this.gen.maxHeightNear(p.x, p.z, RING_R + 20) + RING_R + 30, 90);
      return p;
    };
    if (m.kind === 'blink') {
      for (let i = 0; i < m.goal; i++) {
        const a = (r() - 0.5) * 1.8;
        const d = 380 + r() * 1100;
        const p = base.clone().addScaledVector(fwd, Math.cos(a) * d).addScaledVector(side, Math.sin(a) * d);
        out.push(lift(p, -60 + r() * 180));
      }
    } else if (m.kind === 'colors') {
      for (let i = 0; i < m.goal; i++) {
        const p = base.clone().addScaledVector(fwd, 450 + i * 380).addScaledVector(side, (r() - 0.5) * 700);
        out.push(lift(p, -40 + r() * 140));
      }
    } else if (m.kind === 'slalom') {
      let dy = 0;
      for (let i = 0; i < m.goal; i++) {
        dy += (r() - 0.45) * 50;
        const p = base.clone().addScaledVector(fwd, 400 + i * 230).addScaledVector(side, (i % 2 ? 1 : -1) * (50 + r() * 50));
        out.push(lift(p, dy));
      }
    } else if (m.kind === 'orb') {
      for (let i = 0; i < m.goal; i++) {
        const p = base.clone().addScaledVector(fwd, 700 + i * 450).addScaledVector(side, (r() - 0.5) * 900);
        out.push(lift(p, 60 + r() * 120));
      }
    }
    return out;
  }

  private build() {
    const m = this.state!;
    const key = `${m.lvl}:${m.seed}`;
    if (key !== this.builtKey) {
      this.clear();
      this.builtKey = key;
      const pts = this.layout(m);
      if (m.kind === 'orb') {
        this.orb = new THREE.Group();
        this.orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.55) });
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(6, 1), this.orbMat);
        const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(14, 1), new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.25, depthWrite: false }));
        this.orb.add(core, halo);
        this.group.add(this.orb);
        this.rings = pts.map((pos) => ({ mesh: new THREE.Mesh(), mat: new THREE.MeshBasicMaterial(), pos, base: new THREE.Color() }));
      } else {
        pts.forEach((pos, i) => {
          const base = new THREE.Color(m.kind === 'colors' ? COLORS[i % COLORS.length] : m.kind === 'slalom' ? 0xb080ff : 0x60e0ff);
          const mat = new THREE.MeshBasicMaterial({ color: base.clone() });
          const mesh = new THREE.Mesh(this.torus, mat);
          mesh.position.copy(pos);
          // De cara al recorrido (desde el anterior, o desde el ancla)
          const from = i > 0 && m.kind !== 'blink' ? pts[i - 1] : new THREE.Vector3(m.x, pos.y, m.z);
          mesh.lookAt(from);
          this.group.add(mesh);
          this.rings.push({ mesh, mat, pos, base });
        });
      }
    }
    this.refreshVisibility();
  }

  private refreshVisibility() {
    const m = this.state!;
    this.rings.forEach((r, i) => {
      r.mesh.visible = m.kind === 'blink' ? !m.taken?.[i] : m.kind === 'orb' ? false : i >= m.prog;
    });
    if (this.orb) this.orb.visible = m.prog < m.goal;
  }

  /** ¿Aro relámpago i parpadeando ahora? (todos los del equipo lo ven igual: reloj compartido) */
  blinking(i: number, t: number) {
    const m = this.state;
    if (!m) return false;
    const ph = (t + i * 2.3 + (m.seed % 97) * 0.1) % BLINK_CYCLE;
    return ph < BLINK_ON;
  }

  /** Posición de la chispa (huye describiendo curvas alrededor de su punto) */
  private orbAt(t: number) {
    const m = this.state!;
    const c = this.rings[Math.min(m.prog, this.rings.length - 1)]?.pos;
    if (!c) return this.orbPos;
    const k = m.prog + 1;
    this.orbPos.set(c.x + Math.cos(t * 0.45 * (1 + k * 0.08)) * 240, c.y + Math.sin(t * 0.9) * 50, c.z + Math.sin(t * 0.6 * (1 + k * 0.08)) * 240);
    this.orbPos.y = Math.max(this.orbPos.y, this.gen.maxHeightNear(this.orbPos.x, this.orbPos.z, 30) + 40);
    return this.orbPos;
  }

  /**
   * t: reloj de juego compartido (s). prev/pos: tramo recorrido este paso.
   */
  update(dt: number, t: number, prev: THREE.Vector3, pos: THREE.Vector3, speedKmh: number, alive: boolean) {
    const m = this.state;
    if (!m) return;
    if (this.frenzy > 0) this.frenzy = Math.max(0, this.frenzy - dt);
    this.wrongT = Math.max(0, this.wrongT - dt);
    // Animación
    for (const [i, r] of this.rings.entries()) {
      if (!r.mesh.visible) continue;
      let s = 1;
      if (m.kind === 'blink') {
        const on = this.blinking(i, t) || this.frenzy > 0;
        if (on) {
          const f = Math.floor(t * 8) % 2 === 0;
          r.mat.color.setRGB(f ? 1 : 1, f ? 0.85 : 1, f ? 0.25 : 0.9);
          s = 1.12;
        } else r.mat.color.copy(r.base);
      } else if (i === m.prog) {
        s = 1 + 0.12 * Math.sin(t * 5);
        r.mat.color.copy(r.base).multiplyScalar(1);
      } else {
        r.mat.color.copy(r.base).multiplyScalar(0.55);
      }
      r.mesh.scale.setScalar(s);
    }
    if (this.orb) {
      this.orb.position.copy(this.orbAt(t));
      this.orb.rotation.y += dt * 3;
      const p = 0.9 + 0.1 * Math.sin(t * 12);
      this.orbMat!.color.setRGB(p, p * 0.95, 0.55);
    }
    // Aros que han quedado dentro de una isla flotante (se cargan por zonas): subirlos
    this.blockT -= dt;
    if (this.blockT <= 0 && this.hooks.blocked) {
      this.blockT = 1;
      for (const r of this.rings) {
        let k = 0;
        while (k < 30 && this.hooks.blocked(r.pos)) {
          r.pos.y += 25;
          k++;
        }
        if (k) {
          r.pos.y += RING_R + 20;
          r.mesh.position.copy(r.pos);
        }
      }
    }
    if (!alive) return;

    // Progreso
    if (m.kind === 'low' || m.kind === 'speed') {
      const agl = pos.y - this.gen.heightAt(pos.x, pos.z);
      const ok = m.kind === 'low' ? agl < LOW_AGL && agl > 3 : speedKmh >= FAST_KMH;
      if (ok) this.secsAcc += dt;
      this.flushT -= dt;
      if (this.flushT <= 0 && this.secsAcc > 0) {
        this.flushT = this.team ? 1 : 0.25;
        const v = Math.round(this.secsAcc * 10) / 10;
        this.secsAcc = 0;
        this.hooks.act({ lvl: m.lvl, type: 'secs', v });
      }
      return;
    }
    if (m.kind === 'orb') {
      this.orbCool = Math.max(0, this.orbCool - dt);
      if (m.prog < m.goal && this.orbCool <= 0 && segDist(prev, pos, this.orbPos) < 26) {
        // Espera a que el equipo confirme antes de poder atrapar la siguiente
        this.orbCool = 1.2;
        this.hooks.ring(this.frenzy > 0, 'Chispa atrapada');
        this.hooks.act({ lvl: m.lvl, type: 'ring', idx: m.prog });
      }
      return;
    }
    // Slalom: si se acaba el tiempo entre aros, vuelve a empezar
    if (m.kind === 'slalom' && m.prog > 0) {
      this.slalomLeft -= dt;
      if (this.slalomLeft <= 0) {
        this.hooks.toast('Slalom: ¡se acabó el tiempo! Vuelve al primer aro', 1800);
        this.hooks.act({ lvl: m.lvl, type: 'reset' });
        this.slalomLeft = 999;
      }
    }
    for (const [i, r] of this.rings.entries()) {
      if (!r.mesh.visible) continue;
      if (segDist(prev, pos, r.pos) > RING_R * 1.05) continue;
      if (m.kind === 'blink') {
        const x3 = this.blinking(i, t) || this.frenzy > 0;
        this.hooks.ring(x3, x3 ? 'Aro relámpago ×3' : 'Aro relámpago');
        r.mesh.visible = false;
        this.hooks.act({ lvl: m.lvl, type: 'ring', idx: i });
      } else if (i === m.prog) {
        this.hooks.ring(this.frenzy > 0, m.kind === 'colors' ? 'Color correcto' : 'Slalom');
        r.mesh.visible = false;
        if (m.kind === 'slalom') this.slalomLeft = SLALOM_WINDOW(m.lvl);
        this.hooks.act({ lvl: m.lvl, type: 'ring', idx: i });
      } else if (m.kind === 'colors' && this.wrongT <= 0) {
        this.wrongT = 2;
        this.hooks.toast('🌈 Orden incorrecto: sigue el color que late', 1500);
      }
    }
  }


  /** Objetivo para la flecha y el radar */
  target(): THREE.Vector3 | null {
    const m = this.state;
    if (!m) return null;
    if (m.kind === 'orb') return this.orb?.visible ? this.orbPos : null;
    if (m.kind === 'colors' || m.kind === 'slalom') return this.rings[m.prog]?.pos ?? null;
    if (m.kind === 'blink') return null;
    return null;
  }

  /** Aros visibles (radar) */
  radarPoints(): { pos: THREE.Vector3; color: string }[] {
    const m = this.state;
    if (!m) return [];
    if (m.kind === 'orb') return this.orb?.visible ? [{ pos: this.orbPos, color: '#ffe080' }] : [];
    return this.rings.filter((r) => r.mesh.visible).map((r) => ({ pos: r.pos, color: `#${r.base.getHexString()}` }));
  }

  /** Aro relámpago más cercano (para la flecha) */
  nearest(from: THREE.Vector3): THREE.Vector3 | null {
    const t = this.target();
    if (t) return t;
    let best: THREE.Vector3 | null = null;
    let bd = Infinity;
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      const d = r.pos.distanceToSquared(from);
      if (d < bd) {
        bd = d;
        best = r.pos;
      }
    }
    return best;
  }

  /** Texto de progreso */
  progressText() {
    const m = this.state;
    if (!m) return '';
    if (m.kind === 'low' || m.kind === 'speed') return `${Math.floor(m.prog)}/${m.goal} s`;
    return `${m.prog}/${m.goal}`;
  }

  dispose() {
    this.clear();
    this.torus.dispose();
    this.scene.remove(this.group);
  }
}

/** Distancia de un punto al segmento a-b */
export function segDist(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - p.x;
  const dy = a.y + aby * t - p.y;
  const dz = a.z + abz * t - p.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ------------------------------------------------------------------ Obstáculos del cielo

interface Mine {
  g: THREE.Group;
  pos: THREE.Vector3;
  base: number;
  ph: number;
  alive: boolean;
}

interface Laser {
  g: THREE.Group;
  a: THREE.Vector3;
  b: THREE.Vector3;
  beam: THREE.Mesh;
  ph: number;
  period: number;
}

export interface HazardHooks {
  damage(n: number, what: string, pos: THREE.Vector3): void;
}

/**
 * Minas flotantes y barreras láser que aparecen por delante del avión.
 * Su número crece con el nivel (dificultad in crescendo).
 */
export class Hazards {
  private group = new THREE.Group();
  private mines: Mine[] = [];
  private lasers: Laser[] = [];
  private mineGeo = new THREE.IcosahedronGeometry(6, 0);
  private spikeGeo = new THREE.ConeGeometry(1.6, 6, 5);
  private lightGeo = new THREE.SphereGeometry(2, 8, 6);
  private mineMat = new THREE.MeshLambertMaterial({ color: 0x3a3438, emissive: 0x200808 });
  private spikeMat = new THREE.MeshLambertMaterial({ color: 0x8a8088 });
  private lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.2, 0.15) });
  private pylonGeo = new THREE.BoxGeometry(6, 26, 6);
  private pylonMat = new THREE.MeshLambertMaterial({ color: 0x404858, emissive: 0x101820 });
  private beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.25, 0.3), transparent: true, opacity: 0.85 });
  private beamGeo = new THREE.CylinderGeometry(1.4, 1.4, 1, 6, 1, true);
  /** nivel de dificultad (0 = pocos obstáculos) */
  level = 0;
  /** densidad base según el modo */
  baseMines = 4;
  baseLasers = 1;
  private cool = 0;
  private spawnT = 0;
  /** puntos que hay que dejar libres (hitos de carrera, entregas) */
  keepClear: () => THREE.Vector3[] = () => [];

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
    private hooks: HazardHooks,
  ) {
    scene.add(this.group);
  }

  get wantMines() {
    return Math.min(30, this.baseMines + this.level * 2);
  }
  get wantLasers() {
    return Math.min(9, this.baseLasers + Math.floor(this.level / 2));
  }

  private place(from: THREE.Vector3, yaw: number, minD: number, maxD: number): THREE.Vector3 | null {
    const clear = this.keepClear();
    for (let k = 0; k < 8; k++) {
      const a = yaw + (Math.random() - 0.5) * 1.4;
      const d = minD + Math.random() * (maxD - minD);
      const p = new THREE.Vector3(from.x - Math.sin(a) * d, 0, from.z - Math.cos(a) * d);
      const floor = this.gen.maxHeightNear(p.x, p.z, 40);
      p.y = Math.max(from.y + (Math.random() - 0.5) * 200, floor + 45, 60);
      if (clear.some((c) => c.distanceTo(p) < 130)) continue;
      return p;
    }
    return null;
  }

  private addMine(p: THREE.Vector3) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.mineGeo, this.mineMat));
    const dirs = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (const d of dirs) {
      const s = new THREE.Mesh(this.spikeGeo, this.spikeMat);
      const v = new THREE.Vector3(d[0], d[1], d[2]);
      s.position.copy(v).multiplyScalar(7);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
      g.add(s);
    }
    const light = new THREE.Mesh(this.lightGeo, this.lightMat);
    light.position.y = 6.5;
    g.add(light);
    g.scale.setScalar(1.5);
    g.position.copy(p);
    this.group.add(g);
    this.mines.push({ g, pos: p.clone(), base: p.y, ph: Math.random() * 6, alive: true });
  }

  private addLaser(p: THREE.Vector3) {
    const g = new THREE.Group();
    const ang = Math.random() * Math.PI;
    const half = 70 + Math.random() * 40;
    const off = new THREE.Vector3(Math.cos(ang) * half, 0, Math.sin(ang) * half);
    const a = p.clone().add(off);
    const b = p.clone().sub(off);
    for (const q of [a, b]) {
      const py = new THREE.Mesh(this.pylonGeo, this.pylonMat);
      py.position.copy(q);
      g.add(py);
    }
    const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
    beam.position.copy(p);
    beam.scale.set(1, half * 2, 1);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), off.clone().normalize());
    g.add(beam);
    this.group.add(g);
    this.lasers.push({ g, a, b, beam, ph: Math.random() * 4, period: 3.6 + Math.random() * 1.2 });
  }

  /** ¿La barrera está encendida? (encendida ~60 % del ciclo) */
  private laserOn(l: Laser, t: number) {
    return (t + l.ph) % l.period < l.period * 0.6;
  }

  update(dt: number, t: number, prev: THREE.Vector3, pos: THREE.Vector3, yaw: number, alive: boolean) {
    this.cool = Math.max(0, this.cool - dt);
    // Repoblar por delante y retirar los que quedan lejos
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.5;
      for (const mn of [...this.mines]) {
        if (!mn.alive || mn.pos.distanceTo(pos) > 2800) this.removeMine(mn);
      }
      for (const l of [...this.lasers]) {
        if (l.a.distanceTo(pos) > 2800) this.removeLaser(l);
      }
      if (this.mines.length < this.wantMines) {
        const p = this.place(pos, yaw, this.mines.length < 3 ? 500 : 800, 2300);
        if (p) this.addMine(p);
      }
      if (this.lasers.length < this.wantLasers) {
        const p = this.place(pos, yaw, 900, 2300);
        if (p) this.addLaser(p);
      }
    }
    for (const mn of this.mines) {
      mn.pos.y = mn.base + Math.sin(t * 0.8 + mn.ph) * 8;
      mn.g.position.copy(mn.pos);
      mn.g.rotation.y += dt * 0.6;
      mn.g.children[mn.g.children.length - 1].visible = Math.floor(t * 2 + mn.ph) % 2 === 0;
    }
    for (const l of this.lasers) {
      const on = this.laserOn(l, t);
      const warn = !on && (t + l.ph) % l.period > l.period - 0.6;
      l.beam.visible = on || (warn && Math.floor(t * 10) % 2 === 0);
    }
    if (!alive || this.cool > 0) return;
    for (const mn of this.mines) {
      if (!mn.alive || segDist(prev, pos, mn.pos) > 15) continue;
      mn.alive = false;
      mn.g.visible = false;
      this.cool = 0.8;
      this.hooks.damage(24, '¡Mina!', mn.pos.clone());
      return;
    }
    for (const l of this.lasers) {
      if (!this.laserOn(l, t)) continue;
      // cruce del segmento del avión con el haz (distancia entre segmentos aproximada)
      const mid = closestOnSeg(l.a, l.b, pos);
      if (segDist(prev, pos, mid) < 5) {
        this.cool = 1.2;
        this.hooks.damage(18, '¡Barrera láser!', mid);
        return;
      }
    }
  }

  private removeMine(mn: Mine) {
    this.group.remove(mn.g);
    this.mines.splice(this.mines.indexOf(mn), 1);
  }
  private removeLaser(l: Laser) {
    this.group.remove(l.g);
    this.lasers.splice(this.lasers.indexOf(l), 1);
  }

  /** Puntos para el radar */
  radarPoints(from: THREE.Vector3): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const mn of this.mines) if (mn.alive && mn.pos.distanceTo(from) < 1500) out.push(mn.pos);
    for (const l of this.lasers) if (l.a.distanceTo(from) < 1500) out.push(l.a.clone().lerp(l.b, 0.5));
    return out;
  }

  get count() {
    return { mines: this.mines.length, lasers: this.lasers.length };
  }

  dispose() {
    this.scene.remove(this.group);
    for (const g of [this.mineGeo, this.spikeGeo, this.lightGeo, this.pylonGeo, this.beamGeo]) g.dispose();
    for (const m of [this.mineMat, this.spikeMat, this.lightMat, this.pylonMat, this.beamMat]) m.dispose();
  }
}

function closestOnSeg(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return a.clone().addScaledVector(ab, t);
}
