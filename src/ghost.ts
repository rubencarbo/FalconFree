import * as THREE from 'three';
import { Flight, JetModel } from './jet';
import { store } from './settings';

const RATE = 10;
const STRIDE = 6;

export interface GhostData {
  v: 1;
  time: number;
  /** x, y, z, yaw, pitch, roll intercalados a 10 Hz (tiempo real de carrera) */
  f: number[];
}

/** Graba la vuelta actual */
export class GhostRecorder {
  private frames: number[] = [];
  private acc = 1 / RATE;

  reset() {
    this.frames = [];
    this.acc = 1 / RATE;
  }

  /** Llamar con el tiempo real transcurrido de carrera */
  record(dt: number, f: Flight) {
    this.acc += dt;
    while (this.acc >= 1 / RATE) {
      this.acc -= 1 / RATE;
      const r = (v: number) => Math.round(v * 10) / 10;
      const r3 = (v: number) => Math.round(v * 1000) / 1000;
      this.frames.push(r(f.pos.x), r(f.pos.y), r(f.pos.z), r3(f.yaw), r3(f.pitch), r3(f.roll));
    }
  }

  data(time: number): GhostData {
    return { v: 1, time, f: this.frames.slice() };
  }
}

export function loadGhost(courseId: string): GhostData | null {
  try {
    const raw = store.get(`ghost.${courseId}`);
    if (!raw) return null;
    const g = JSON.parse(raw) as GhostData;
    return g.v === 1 && Array.isArray(g.f) && g.f.length >= STRIDE ? g : null;
  } catch {
    return null;
  }
}

export function saveGhost(courseId: string, g: GhostData) {
  store.set(`ghost.${courseId}`, JSON.stringify(g));
}

/** Reproduce un fantasma translúcido */
export class GhostPlayer {
  jet: JetModel;
  private flight = new Flight();
  readonly pos = new THREE.Vector3();
  finished = false;

  constructor(
    private scene: THREE.Scene,
    public data: GhostData,
  ) {
    this.jet = new JetModel(0x8fd0ff, 0x8fa8d0);
    this.jet.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && 'opacity' in m) {
        const c = m.clone();
        c.transparent = true;
        c.opacity = Math.min(c.opacity, 0.38);
        c.depthWrite = false;
        (o as THREE.Mesh).material = c;
      }
    });
    scene.add(this.jet.group);
  }

  /** t: tiempo real de carrera (s) */
  update(t: number, time: number) {
    const f = this.data.f;
    const n = f.length / STRIDE;
    const x = Math.max(0, t * RATE);
    const i = Math.min(n - 1, Math.floor(x));
    const j = Math.min(n - 1, i + 1);
    const k = Math.min(1, x - i);
    this.finished = i >= n - 1;
    const a = i * STRIDE;
    const b = j * STRIDE;
    const fl = this.flight;
    fl.pos.set(f[a] + (f[b] - f[a]) * k, f[a + 1] + (f[b + 1] - f[a + 1]) * k, f[a + 2] + (f[b + 2] - f[a + 2]) * k);
    let dy = f[b + 3] - f[a + 3];
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    fl.yaw = f[a + 3] + dy * k;
    fl.pitch = f[a + 4] + (f[b + 4] - f[a + 4]) * k;
    fl.roll = f[a + 5] + (f[b + 5] - f[a + 5]) * k;
    fl.thrust = 0.8;
    this.pos.copy(fl.pos);
    this.jet.update(fl, time);
    this.jet.group.visible = !this.finished;
  }

  dispose() {
    this.scene.remove(this.jet.group);
  }
}
