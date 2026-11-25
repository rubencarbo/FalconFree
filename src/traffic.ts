import * as THREE from 'three';
import { AVENUE_EVERY, PERIOD, ROAD } from './world/city';

/**
 * Tráfico aéreo (Ciudad cyberpunk): coches voladores luminosos que circulan por carriles
 * sobre las avenidas, a varias alturas y en ambos sentidos. Su posición depende solo del
 * reloj, así que todos los pilotos de una sala ven lo mismo. Chocar con uno hace daño.
 */
const LANE_STEP = PERIOD * AVENUE_EVERY;
const UP = new THREE.Vector3(0, 1, 0);
const HEIGHTS = [70, 115, 170];
const RANGE = 1000;
const MAX = 280;
// Algo por encima de 1 para que brillen un poco con el resplandor (bloom)
const COLORS = [new THREE.Color(0.3, 1.3, 1.4), new THREE.Color(1.4, 0.35, 1.05), new THREE.Color(1.4, 1.0, 0.35), new THREE.Color(1.3, 1.3, 1.4), new THREE.Color(0.85, 0.5, 1.4)];

export class SkyTraffic {
  private body: THREE.InstancedMesh;
  private lights: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private cars: THREE.Vector3[] = [];
  private cool = 0;

  constructor(private scene: THREE.Scene) {
    const g = new THREE.BoxGeometry(3.2, 1.6, 7);
    this.body = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0x20222c }), MAX);
    const lg = new THREE.BoxGeometry(3.4, 0.5, 7.4);
    this.lights = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX);
    for (let i = 0; i < MAX; i++) this.lights.setColorAt(i, COLORS[i % COLORS.length]);
    for (const im of [this.body, this.lights]) {
      im.frustumCulled = false;
      im.count = 0;
      scene.add(im);
    }
  }

  update(t: number, me: THREE.Vector3, onHit?: (pos: THREE.Vector3) => void, dt = 0) {
    this.cool = Math.max(0, this.cool - dt);
    let n = 0;
    this.cars.length = 0;
    const k0x = Math.floor((me.x - RANGE) / LANE_STEP);
    const k1x = Math.floor((me.x + RANGE) / LANE_STEP);
    const k0z = Math.floor((me.z - RANGE) / LANE_STEP);
    const k1z = Math.floor((me.z + RANGE) / LANE_STEP);
    const place = (x: number, y: number, z: number, yaw: number, ci: number) => {
      if (n >= MAX) return;
      this.p.set(x, y, z);
      this.q.setFromAxisAngle(UP, yaw);
      this.m.compose(this.p, this.q, this.s);
      this.body.setMatrixAt(n, this.m);
      this.p.y += 0.6;
      this.m.compose(this.p, this.q, this.s);
      this.lights.setMatrixAt(n, this.m);
      this.lights.setColorAt(n, COLORS[((ci % COLORS.length) + COLORS.length) % COLORS.length]);
      this.cars.push(new THREE.Vector3(x, y, z));
      n++;
    };
    // Carriles a lo largo de z (sobre avenidas con x fija) y a lo largo de x
    for (const axis of [0, 1]) {
      const k0 = axis === 0 ? k0x : k0z;
      const k1 = axis === 0 ? k1x : k1z;
      const along = axis === 0 ? me.z : me.x;
      for (let k = k0; k <= k1; k++) {
        const across = k * LANE_STEP + ROAD / 2;
        for (const [hi, h] of HEIGHTS.entries()) {
          for (const dir of [1, -1]) {
            const speed = (38 + hi * 9) * dir;
            const gap = 380 + ((k * 7 + hi * 3) % 5) * 45;
            const off = across + dir * 3.5;
            const phase = (t * speed) % gap;
            const start = Math.floor((along - RANGE) / gap) * gap;
            for (let s = start; s < along + RANGE; s += gap) {
              const pos = s + phase + ((k * 131 + hi * 57) % gap);
              if (Math.abs(pos - along) > RANGE) continue;
              const y = h + (dir > 0 ? 0 : 6);
              if (axis === 0) place(off, y, pos, dir > 0 ? 0 : Math.PI, k + hi + (dir > 0 ? 0 : 2));
              else place(pos, y, off, dir > 0 ? Math.PI / 2 : -Math.PI / 2, k + hi + (dir > 0 ? 1 : 3));
            }
          }
        }
      }
    }
    for (const im of [this.body, this.lights]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
    if (this.lights.instanceColor) this.lights.instanceColor.needsUpdate = true;
    if (onHit && this.cool <= 0) {
      for (const c of this.cars) {
        if (Math.abs(c.y - me.y) < 4 && Math.abs(c.x - me.x) < 6 && Math.abs(c.z - me.z) < 6) {
          this.cool = 1.2;
          onHit(c);
          break;
        }
      }
    }
  }

  /** Coches cercanos (para el radar) */
  near(me: THREE.Vector3, r: number): THREE.Vector3[] {
    return this.cars.filter((c) => c.distanceTo(me) < r);
  }

  dispose() {
    for (const im of [this.body, this.lights]) {
      this.scene.remove(im);
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      im.dispose();
    }
  }
}
