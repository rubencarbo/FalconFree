import * as THREE from 'three';
import type { CityGen } from './world/city';
import { mulberry32 } from './world/noise';
import { store } from './settings';

export interface CourseDef {
  id: string;
  name: string;
  description: string;
  gates: number;
  radius: number;
  seedOffset: number;
}

export const COURSES: CourseDef[] = [
  { id: 'sprint2', name: 'Sprint', description: '9 hitos · circuito rápido', gates: 9, radius: 1300, seedOffset: 11 },
  { id: 'grand2', name: 'Gran circuito', description: '15 hitos · ruta larga con muchas variantes', gates: 15, radius: 2300, seedOffset: 29 },
];

export interface Gate {
  pos: THREE.Vector3;
  yaw: number;
  w: number;
  h: number;
  low: boolean;
}

export type BonusKind = 'time' | 'boost';

export interface Bonus {
  id: number;
  pos: THREE.Vector3;
  yaw: number;
  kind: BonusKind;
}

export interface Course {
  id: string;
  name: string;
  gates: Gate[];
  bonuses: Bonus[];
  start: { pos: THREE.Vector3; yaw: number };
}

export const TIME_BONUS = 1;

export function courseId(stageId: string, def: CourseDef) {
  return `${stageId}-${def.id}`;
}

function yawFromDir(d: THREE.Vector3) {
  return Math.atan2(-d.x, -d.z);
}

/** Genera un circuito determinista para el escenario */
export function buildCourse(gen: CityGen, def: CourseDef): Course {
  const rand = mulberry32(gen.stage.seed * 31 + def.seedOffset);
  const N = def.gates;
  const cx = (rand() - 0.5) * 800;
  const cz = (rand() - 0.5) * 800;
  const pts: { x: number; z: number; low: boolean; y: number }[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (rand() - 0.5) * 0.4;
    const r = def.radius * (0.65 + rand() * 0.55);
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const low = i % 3 === 1;
    const roof = gen.maxHeightNear(x, z, low ? 60 : 120);
    const y = low ? Math.max(55, roof + 45) : Math.max(roof + 80, 160 + rand() * 340);
    pts.push({ x, z, y, low });
  }
  const gates: Gate[] = pts.map((p, i) => {
    const prev = pts[(i - 1 + N) % N];
    const next = pts[(i + 1) % N];
    const d = new THREE.Vector3(next.x - prev.x, 0, next.z - prev.z).normalize();
    return {
      pos: new THREE.Vector3(p.x, p.y, p.z),
      yaw: yawFromDir(d),
      w: p.low ? 90 : 120,
      h: p.low ? 55 : 75,
      low: p.low,
    };
  });

  // Rutas alternativas entre hitos
  const bonuses: Bonus[] = [];
  let id = 0;
  for (let i = 0; i < N; i++) {
    const a = gates[i].pos;
    const b = gates[(i + 1) % N].pos;
    const seg = new THREE.Vector3().subVectors(b, a);
    const len = seg.length();
    const perp = new THREE.Vector3(-seg.z, 0, seg.x).normalize();
    const dir = seg.clone().normalize();
    const yaw = yawFromDir(new THREE.Vector3(dir.x, 0, dir.z).normalize());
    const side = rand() < 0.5 ? 1 : -1;
    if (len < 600) {
      const p = a.clone().lerp(b, 0.5).addScaledVector(perp, side * len * 0.2);
      p.y = Math.max(60, gen.maxHeightNear(p.x, p.z, 40) + 30);
      bonuses.push({ id: id++, pos: p, yaw, kind: 'time' });
      continue;
    }
    // Ruta baja (entre edificios): anillos que restan tiempo
    for (const t of [0.3, 0.5, 0.7]) {
      const p = a.clone().lerp(b, t).addScaledVector(perp, side * len * 0.28 * Math.sin(Math.PI * t));
      p.y = Math.max(50, gen.maxHeightNear(p.x, p.z, 35) + 28);
      bonuses.push({ id: id++, pos: p, yaw, kind: 'time' });
    }
    // Ruta alta: anillos de turbo
    for (const t of [0.35, 0.65]) {
      const p = a.clone().lerp(b, t).addScaledVector(perp, -side * len * 0.22 * Math.sin(Math.PI * t));
      p.y = 480 + rand() * 160;
      bonuses.push({ id: id++, pos: p, yaw, kind: 'boost' });
    }
  }

  const d0 = new THREE.Vector3(-Math.sin(gates[0].yaw), 0, -Math.cos(gates[0].yaw));
  const start = { pos: gates[0].pos.clone().addScaledVector(d0, -280), yaw: gates[0].yaw };
  return { id: courseId(gen.stage.id, def), name: def.name, gates, bonuses, start };
}

export type RaceEvent =
  | { type: 'gate'; index: number; total: number; split: number; delta: number | null }
  /** time: tiempo de la vuelta; total: tiempo acumulado; lap: número de vuelta */
  | { type: 'finish'; time: number; splits: number[]; best: boolean; total: number; lap: number }
  | { type: 'bonus'; kind: BonusKind; pos: THREE.Vector3 }
  /** Se ha saltado hitos para ir a uno posterior (con penalización) */
  | { type: 'skip'; count: number; penalty: number; gates: number[] }
  /** Ha pasado junto al hito sin atravesarlo */
  | { type: 'missed'; gate: number };

/** Segundos de penalización por cada hito saltado */
export const SKIP_PENALTY = 5;

export interface BestRecord {
  time: number;
  splits: number[];
}

export function loadBest(courseId: string): BestRecord | null {
  try {
    const raw = store.get(`race.${courseId}`);
    if (!raw) return null;
    const r = JSON.parse(raw) as BestRecord;
    return typeof r.time === 'number' && Array.isArray(r.splits) ? r : null;
  } catch {
    return null;
  }
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * 4, y * 4, 4, 4);
    }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelTexture(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,16,30,0.75)';
  g.beginPath();
  g.roundRect(8, 8, 240, 112, 24);
  g.fill();
  g.font = '900 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface GateVis {
  group: THREE.Group;
  frameMat: THREE.MeshLambertMaterial;
  field: THREE.Mesh;
  beam: THREE.Mesh;
}

/** Sesión de carrera: visuales, paso por hitos, tiempos parciales */
export class Race {
  group = new THREE.Group();
  nextGate = 1;
  passed = 0;
  started = false;
  finished = false;
  elapsed = 0;
  bonusTime = 0;
  splits: number[] = [];
  best: BestRecord | null;
  private gateVis: GateVis[] = [];
  private bonusMeshes = new Map<number, THREE.Mesh>();
  private taken = new Set<number>();
  private disposables: { dispose(): void }[] = [];
  private inv = new THREE.Matrix4();
  private missedGate = -1;
  /** Vuelta actual (botón «¡Seguir!») y momento en que empezó */
  lap = 1;
  lapStart = 0;
  bestLap = Infinity;

  /** Otra vuelta al mismo circuito: el cronómetro total sigue corriendo */
  continueLap() {
    if (!this.finished) return;
    this.finished = false;
    this.lap++;
    this.lapStart = this.time;
    this.nextGate = 1;
    this.passed = 0;
    this.splits = [];
    this.missedGate = -1;
    this.highlight();
  }
  private la = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    public course: Course,
  ) {
    this.best = loadBest(course.id);
    this.buildVisuals();
    scene.add(this.group);
    this.highlight();
  }

  get totalCheckpoints() {
    return this.course.gates.length;
  }

  /** Tiempo de carrera (con bonificaciones) */
  get time() {
    return Math.max(0, this.elapsed - this.bonusTime);
  }

  get nextGatePos() {
    return this.course.gates[this.nextGate].pos;
  }

  /** Hito posterior al siguiente (para el radar) */
  get followingGatePos() {
    return this.course.gates[(this.nextGate + 1) % this.totalCheckpoints].pos;
  }

  /** Penalización de tiempo (s) */
  penalty(sec: number) {
    this.bonusTime -= sec;
  }

  private buildVisuals() {
    const checker = checkerTexture();
    checker.wrapS = THREE.RepeatWrapping;
    this.disposables.push(checker);
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.disposables.push(box);
    const pylonMat = new THREE.MeshLambertMaterial({ color: 0x3a4050 });
    this.disposables.push(pylonMat);
    const beamGeo = new THREE.CylinderGeometry(7, 7, 1400, 8, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x40e0ff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.disposables.push(beamGeo, beamMat);

    this.course.gates.forEach((g, i) => {
      const grp = new THREE.Group();
      grp.position.copy(g.pos);
      grp.rotation.y = g.yaw;
      const isFinish = i === 0;
      const frameMat = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        emissive: 0x000000,
        map: isFinish ? checker : null,
      });
      this.disposables.push(frameMat);
      const t = 5;
      const bars: [number, number, number, number, number][] = [
        [g.w + t * 2, t, 0, g.h / 2 + t / 2, 0],
        [g.w + t * 2, t, 0, -g.h / 2 - t / 2, 0],
        [t, g.h, -g.w / 2 - t / 2, 0, 0],
        [t, g.h, g.w / 2 + t / 2, 0, 0],
      ];
      for (const [w, h, x, y] of bars) {
        const m = new THREE.Mesh(box, frameMat);
        m.scale.set(w, h, t);
        m.position.set(x, y, 0);
        grp.add(m);
      }
      // Pilares hasta el suelo (las "fitas")
      const bottom = g.pos.y - g.h / 2 - t;
      if (bottom > 2) {
        for (const x of [-g.w / 2 - t / 2, g.w / 2 + t / 2]) {
          const p = new THREE.Mesh(box, pylonMat);
          p.scale.set(t * 0.6, bottom, t * 0.6);
          p.position.set(x, -g.h / 2 - t - bottom / 2, 0);
          grp.add(p);
        }
      }
      // Campo de energía del hito activo
      const fieldMat = new THREE.MeshBasicMaterial({
        color: 0x40e0ff,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.disposables.push(fieldMat);
      const planeGeo = new THREE.PlaneGeometry(g.w, g.h);
      this.disposables.push(planeGeo);
      const field = new THREE.Mesh(planeGeo, fieldMat);
      field.visible = false;
      grp.add(field);
      // Etiqueta
      const label = labelTexture(isFinish ? 'META' : String(i), isFinish ? '#ffd040' : '#40e0ff');
      this.disposables.push(label);
      const spriteMat = new THREE.SpriteMaterial({ map: label, depthWrite: false });
      this.disposables.push(spriteMat);
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(40, 20, 1);
      sprite.position.set(0, g.h / 2 + 22, 0);
      grp.add(sprite);
      // Haz de luz vertical: se ve desde muy lejos, incluso con niebla
      const beam = new THREE.Mesh(beamGeo, beamMat.clone());
      this.disposables.push(beam.material as THREE.Material);
      beam.position.set(0, g.h / 2 + 700, 0);
      beam.visible = false;
      grp.add(beam);
      this.group.add(grp);
      this.gateVis.push({ group: grp, frameMat, field, beam });
    });

    const timeGeo = new THREE.TorusGeometry(11, 1.8, 6, 18);
    const boostGeo = new THREE.TorusGeometry(15, 2.2, 6, 18);
    const timeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 2.6) });
    const boostMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.6, 0.7) });
    this.disposables.push(timeGeo, boostGeo, timeMat, boostMat);
    for (const b of this.course.bonuses) {
      const m = new THREE.Mesh(b.kind === 'time' ? timeGeo : boostGeo, b.kind === 'time' ? timeMat : boostMat);
      m.position.copy(b.pos);
      m.rotation.y = b.yaw;
      m.updateMatrixWorld();
      this.group.add(m);
      this.bonusMeshes.set(b.id, m);
    }
  }

  private highlight() {
    const following = (this.nextGate + 1) % this.totalCheckpoints;
    this.gateVis.forEach((v, i) => {
      const active = i === this.nextGate && !this.finished;
      const after = i === following && !this.finished && this.nextGate !== 0;
      v.beam.visible = active || after;
      const bm = v.beam.material as THREE.MeshBasicMaterial;
      bm.color.setHex(active ? (i === 0 ? 0xffd040 : 0x40e0ff) : 0xffffff);
      bm.opacity = active ? 0.2 : 0.07;
      const done = !this.finished && i !== 0 && i < this.nextGate;
      v.field.visible = active;
      // Marco del hito activo iluminado, pero sin deslumbrar (por debajo del umbral del bloom)
      v.frameMat.emissive.setRGB(active ? 0.05 : 0, active ? 0.4 : 0, active ? 0.55 : 0);
      v.frameMat.color.setHex(done ? 0x556070 : 0xffffff);
      v.group.visible = !done;
    });
  }

  start() {
    this.started = true;
    this.elapsed = 0;
  }

  /** Posición de reaparición: último hito superado, mirando al siguiente */
  respawnPoint() {
    const last = this.course.gates[(this.nextGate - 1 + this.totalCheckpoints) % this.totalCheckpoints];
    const next = this.course.gates[this.nextGate];
    if (this.passed === 0) return { pos: this.course.start.pos.clone(), yaw: this.course.start.yaw };
    const d = new THREE.Vector3().subVectors(next.pos, last.pos).setY(0).normalize();
    return { pos: last.pos.clone().addScaledVector(d, 60), yaw: yawFromDir(d) };
  }

  update(dt: number, prev: THREE.Vector3, cur: THREE.Vector3, time: number): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (this.started && !this.finished) this.elapsed += dt;

    // Animación
    const v = this.gateVis[this.nextGate];
    if (v && !this.finished) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      (v.field.material as THREE.MeshBasicMaterial).opacity = 0.04 + pulse * 0.05;
    }
    for (const m of this.bonusMeshes.values()) m.rotation.z += dt * 1.5;

    if (!this.started || this.finished) return events;

    // Hito (o uno posterior: se puede saltar hitos con penalización)
    const N = this.totalCheckpoints;
    let reached = -1;
    let skipped = 0;
    for (let j = 0; j < 3; j++) {
      const idx = (this.nextGate + j) % N;
      // No se puede saltar la meta: es siempre el final
      if (j > 0 && (this.nextGate === 0 || (this.nextGate + j - 1) % N === 0)) break;
      const g = this.course.gates[idx];
      if (this.crossed(this.gateVis[idx].group, prev, cur, g.w / 2, g.h / 2, false)) {
        reached = idx;
        skipped = j;
        break;
      }
    }
    if (reached < 0) {
      // ¿Ha pasado al lado del hito que tocaba? Avisar una vez
      const g = this.course.gates[this.nextGate];
      if (this.missedGate !== this.nextGate && this.crossed(this.gateVis[this.nextGate].group, prev, cur, g.w * 2.5, g.h * 3, false)) {
        this.missedGate = this.nextGate;
        events.push({ type: 'missed', gate: this.nextGate });
      }
    } else {
      if (skipped > 0) {
        const gates: number[] = [];
        for (let j = 0; j < skipped; j++) gates.push((this.nextGate + j) % N);
        this.penalty(SKIP_PENALTY * skipped);
        events.push({ type: 'skip', count: skipped, penalty: SKIP_PENALTY * skipped, gates });
        // Los parciales de los hitos saltados se registran con el tiempo de este
        for (let j = 0; j < skipped; j++) {
          this.passed++;
          this.splits.push(this.time - this.lapStart);
        }
      }
      this.passed++;
      const split = this.time - this.lapStart;
      this.splits.push(split);
      const idx = this.splits.length - 1;
      const delta = this.best && this.best.splits[idx] !== undefined ? split - this.best.splits[idx] : null;
      if (reached === 0) {
        this.finished = true;
        // El récord del circuito cuenta la primera vuelta (las demás son «seguir volando»)
        const isBest = this.lap === 1 && (!this.best || split < this.best.time);
        if (isBest) {
          this.best = { time: split, splits: [...this.splits] };
          store.set(`race.${this.course.id}`, JSON.stringify(this.best));
        }
        this.bestLap = Math.min(this.bestLap, split);
        events.push({ type: 'finish', time: split, splits: [...this.splits], best: isBest, total: this.time, lap: this.lap });
      } else {
        events.push({ type: 'gate', index: this.passed, total: this.totalCheckpoints, split, delta });
        this.nextGate = (reached + 1) % N;
      }
      this.missedGate = -1;
      this.highlight();
    }

    // Bonificaciones
    for (const b of this.course.bonuses) {
      if (this.taken.has(b.id)) continue;
      if (b.pos.distanceToSquared(cur) > 60 * 60) continue;
      const m = this.bonusMeshes.get(b.id)!;
      const r = b.kind === 'time' ? 13 : 17;
      if (this.crossed(m, prev, cur, r, r, true)) {
        this.taken.add(b.id);
        m.visible = false;
        if (b.kind === 'time') this.bonusTime += TIME_BONUS;
        events.push({ type: 'bonus', kind: b.kind, pos: b.pos });
      }
    }
    return events;
  }

  /** ¿El segmento prev→cur cruza el plano local XY dentro de los límites? */
  private crossed(obj: THREE.Object3D, prev: THREE.Vector3, cur: THREE.Vector3, hw: number, hh: number, round: boolean) {
    obj.updateMatrixWorld();
    this.inv.copy(obj.matrixWorld).invert();
    const a = this.la.copy(prev).applyMatrix4(this.inv);
    const az = a.z,
      ax = a.x,
      ay = a.y;
    const b = this.la.copy(cur).applyMatrix4(this.inv);
    if ((az > 0 && b.z > 0) || (az < 0 && b.z < 0)) return false;
    const t = az / (az - b.z || 1e-6);
    const ix = ax + (b.x - ax) * t;
    const iy = ay + (b.y - ay) * t;
    if (round) return ix * ix + iy * iy < hw * hw;
    return Math.abs(ix) < hw && Math.abs(iy) < hh;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose();
  }
}

export function formatTime(t: number) {
  if (!isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function formatDelta(d: number) {
  return `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`;
}
