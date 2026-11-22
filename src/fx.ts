import * as THREE from 'three';

interface SpawnOpts {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size0: number;
  size1: number;
  color: number;
  drag?: number;
  grav?: number;
}

/** Piscina de partículas cúbicas (estética vóxel) con InstancedMesh */
class ParticlePool {
  mesh: THREE.InstancedMesh;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private next = 0;
  private c = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private n: number,
    private additive: boolean,
  ) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !additive,
      fog: !additive,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    const m = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < n; i++) {
      m[i * 16 + 15] = 1;
      this.mesh.setColorAt(i, this.c.setRGB(0, 0, 0));
    }
    scene.add(this.mesh);
  }

  spawn(o: SpawnOpts) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const k = i * 3;
    this.pos[k] = o.x;
    this.pos[k + 1] = o.y;
    this.pos[k + 2] = o.z;
    this.vel[k] = o.vx ?? 0;
    this.vel[k + 1] = o.vy ?? 0;
    this.vel[k + 2] = o.vz ?? 0;
    this.c.setHex(o.color);
    this.col[k] = this.c.r;
    this.col[k + 1] = this.c.g;
    this.col[k + 2] = this.c.b;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.s0[i] = o.size0;
    this.s1[i] = o.size1;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.grav ?? 0;
  }

  update(dt: number) {
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const colors = this.mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const o = i * 16;
      if (this.life[i] <= 0) {
        if (m[o] !== 0) {
          m[o] = m[o + 5] = m[o + 10] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.3) {
        this.pos[k + 1] = 0.3;
        this.vel[k + 1] *= -0.3;
      }
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const s = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      m[o] = m[o + 5] = m[o + 10] = this.life[i] > 0 ? s : 0;
      m[o + 12] = this.pos[k];
      m[o + 13] = this.pos[k + 1];
      m[o + 14] = this.pos[k + 2];
      const f = this.additive ? (1 - t) * (1 - t) : 1;
      colors[k] = this.col[k] * f;
      colors[k + 1] = this.col[k + 1] * f;
      colors[k + 2] = this.col[k + 2] * f;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

interface Shock {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  max: number;
}

const FIRE = [0xfff2b0, 0xffd040, 0xff9a20, 0xff6a10, 0xff4010];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: T[]) => arr[(Math.random() * arr.length) | 0];

/** Efectos visuales del juego */
export class Fx {
  private glow: ParticlePool;
  private smoke: ParticlePool;
  private shocks: Shock[] = [];
  private lights: { light: THREE.PointLight; t: number; life: number; peak: number }[] = [];
  private _v = new THREE.Vector3();
  high = true;

  constructor(private scene: THREE.Scene) {
    this.glow = new ParticlePool(scene, 1800, true);
    this.smoke = new ParticlePool(scene, 900, false);
    const ringGeo = new THREE.RingGeometry(0.85, 1, 40);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffc070,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      mesh.visible = false;
      scene.add(mesh);
      this.shocks.push({ mesh, t: 0, life: 0, max: 1 });
    }
    // Número fijo de luces para no recompilar shaders
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 600, 1.4);
      scene.add(light);
      this.lights.push({ light, t: 0, life: 0, peak: 0 });
    }
  }

  private flash(pos: THREE.Vector3, peak: number, life: number, color = 0xffa040) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.life - l.t < best.life - best.t) best = l;
    best.light.position.copy(pos);
    best.light.color.setHex(color);
    best.peak = peak;
    best.t = 0;
    best.life = life;
  }

  /** Fogonazo en la boca del cañón */
  muzzle(pos: THREE.Vector3, dir: THREE.Vector3, vel: THREE.Vector3) {
    for (let i = 0; i < (this.high ? 4 : 2); i++) {
      const s = rnd(60, 160);
      this.glow.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: vel.x + dir.x * s + rnd(-15, 15),
        vy: vel.y + dir.y * s + rnd(-15, 15),
        vz: vel.z + dir.z * s + rnd(-15, 15),
        life: rnd(0.04, 0.09),
        size0: rnd(1.2, 2.2),
        size1: 0.3,
        color: pick(FIRE),
      });
    }
  }

  muzzleLight(pos: THREE.Vector3) {
    this.flash(pos, 3000, 0.05, 0xffc060);
  }

  /** Impacto de bala: chispas que rebotan */
  sparks(pos: THREE.Vector3, normal: THREE.Vector3 | null, count = 14, speed = 60) {
    const n = this.high ? count : Math.ceil(count / 2);
    for (let i = 0; i < n; i++) {
      const d = this._v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
      if (normal) d.add(normal).normalize();
      const s = rnd(0.3, 1) * speed;
      this.glow.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: d.x * s,
        vy: d.y * s,
        vz: d.z * s,
        life: rnd(0.25, 0.7),
        size0: rnd(0.4, 0.9),
        size1: 0.1,
        color: pick([0xffffff, 0xfff2b0, 0xffd040, 0xff9a20]),
        drag: 1.5,
        grav: 30,
      });
    }
  }

  /** Impacto sobre un avión: chispas + destello + humo */
  hit(pos: THREE.Vector3, vel: THREE.Vector3) {
    this.sparks(pos, null, 10, 50);
    this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, life: 0.12, size0: 5, size1: 1, color: 0xffe0a0 });
    this.smoke.spawn({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      vx: vel.x * 0.3,
      vy: vel.y * 0.3 + 3,
      vz: vel.z * 0.3,
      life: 0.9,
      size0: 1.5,
      size1: 5,
      color: 0x555555,
      drag: 2,
    });
  }

  /** Rozamiento contra un edificio o el suelo */
  scrape(pos: THREE.Vector3, normal: THREE.Vector3) {
    this.sparks(pos, normal, 40, 90);
    this.flash(pos, 2500, 0.25, 0xffd080);
    for (let i = 0; i < 6; i++) {
      this.smoke.spawn({
        x: pos.x + rnd(-2, 2),
        y: pos.y + rnd(-2, 2),
        z: pos.z + rnd(-2, 2),
        vy: rnd(2, 8),
        life: rnd(1, 2),
        size0: 2,
        size1: rnd(6, 10),
        color: pick([0x6a6a6a, 0x8a8a8a, 0x4a4a4a]),
        drag: 1,
      });
    }
  }

  /** Gran explosión */
  explosion(pos: THREE.Vector3, vel: THREE.Vector3, scale = 1) {
    const hi = this.high;
    // Núcleo de fuego
    for (let i = 0; i < (hi ? 70 : 35) * scale; i++) {
      const d = this._v.set(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1)).normalize();
      const s = rnd(5, 45) * scale;
      this.glow.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: d.x * s + vel.x * 0.2,
        vy: d.y * s + vel.y * 0.2,
        vz: d.z * s + vel.z * 0.2,
        life: rnd(0.5, 1.3),
        size0: rnd(4, 9) * scale,
        size1: rnd(1, 3),
        color: pick(FIRE),
        drag: 2.2,
        grav: -4,
      });
    }
    // Chispas rápidas
    this.sparks(pos, null, 50, 140 * scale);
    // Humo negro que asciende
    for (let i = 0; i < (hi ? 40 : 18) * scale; i++) {
      this.smoke.spawn({
        x: pos.x + rnd(-6, 6) * scale,
        y: pos.y + rnd(-4, 6) * scale,
        z: pos.z + rnd(-6, 6) * scale,
        vx: rnd(-8, 8) + vel.x * 0.1,
        vy: rnd(4, 14),
        vz: rnd(-8, 8) + vel.z * 0.1,
        life: rnd(2, 4),
        size0: rnd(3, 6) * scale,
        size1: rnd(10, 18) * scale,
        color: pick([0x2a2a2a, 0x3a3a3a, 0x4a4442, 0x222222]),
        drag: 0.9,
      });
    }
    // Escombros
    for (let i = 0; i < 24 * scale; i++) {
      const d = this._v.set(rnd(-1, 1), rnd(0, 1), rnd(-1, 1)).normalize();
      const s = rnd(20, 70);
      this.smoke.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: d.x * s + vel.x * 0.3,
        vy: d.y * s + vel.y * 0.3,
        vz: d.z * s + vel.z * 0.3,
        life: rnd(1.5, 3),
        size0: rnd(0.8, 2.2),
        size1: rnd(0.6, 1.5),
        color: pick([0x40454e, 0x2a2d33, 0x4d535d, 0xff7a1a]),
        grav: 28,
        drag: 0.3,
      });
    }
    // Onda expansiva
    const sh = this.shocks.reduce((a, b) => (a.t / (a.life || 1) > b.t / (b.life || 1) ? a : b));
    sh.mesh.position.copy(pos);
    sh.mesh.lookAt(pos.x, pos.y + 1, pos.z);
    sh.mesh.visible = true;
    sh.t = 0;
    sh.life = 0.7;
    sh.max = 90 * scale;
    this.flash(pos, 120000 * scale, 0.9);
  }

  /** Humo/fuego que sale de un avión dañado (llamar cada frame) */
  damageTrail(pos: THREE.Vector3, hp01: number, dt: number) {
    if (hp01 > 0.6) return;
    const rate = (1 - hp01) * (this.high ? 50 : 25);
    const n = Math.floor(rate * dt + Math.random());
    for (let i = 0; i < n; i++) {
      this.smoke.spawn({
        x: pos.x + rnd(-1, 1),
        y: pos.y + rnd(-1, 1),
        z: pos.z + rnd(-1, 1),
        vy: rnd(1, 4),
        life: rnd(1, 2),
        size0: 1.5,
        size1: rnd(4, 8),
        color: hp01 < 0.3 ? pick([0x222222, 0x333333]) : pick([0x777777, 0x999999]),
        drag: 1,
      });
      if (hp01 < 0.3) {
        this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, vy: 2, life: 0.25, size0: rnd(1.5, 3), size1: 0.5, color: pick(FIRE) });
      }
    }
  }

  /** Estela de un misil */
  missileTrail(pos: THREE.Vector3, dir: THREE.Vector3) {
    this.glow.spawn({ x: pos.x - dir.x * 2.5, y: pos.y - dir.y * 2.5, z: pos.z - dir.z * 2.5, life: 0.12, size0: 1.6, size1: 0.4, color: pick(FIRE) });
    if (Math.random() < (this.high ? 0.9 : 0.5)) {
      this.smoke.spawn({
        x: pos.x - dir.x * 3,
        y: pos.y - dir.y * 3,
        z: pos.z - dir.z * 3,
        vy: rnd(0.5, 2),
        life: rnd(1.2, 2.2),
        size0: 1,
        size1: rnd(3, 5),
        color: pick([0xd8d8d8, 0xc0c0c0, 0xeeeeee]),
        drag: 1,
      });
    }
  }

  /** Bengala incandescente */
  flareSpark(pos: THREE.Vector3) {
    this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.25, size0: 2.4, size1: 0.6, color: pick([0xffffff, 0xfff2b0, 0xffd040]) });
    if (Math.random() < 0.5) this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vy: 1, life: 1.2, size0: 0.8, size1: 3, color: 0xdddddd, drag: 1 });
  }

  /** Burbuja de escudo: chispas azules alrededor */
  shieldSpark(pos: THREE.Vector3) {
    const d = this._v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(11);
    this.glow.spawn({ x: pos.x + d.x, y: pos.y + d.y, z: pos.z + d.z, life: 0.2, size0: 0.9, size1: 0.2, color: 0x40e0ff });
  }

  update(dt: number) {
    this.glow.update(dt);
    this.smoke.update(dt);
    for (const s of this.shocks) {
      if (!s.mesh.visible) continue;
      s.t += dt;
      const k = s.t / s.life;
      const r = 4 + s.max * (1 - Math.pow(1 - Math.min(1, k), 3));
      s.mesh.scale.set(r, r, r);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k) * 0.9;
      if (k >= 1) s.mesh.visible = false;
    }
    for (const l of this.lights) {
      if (l.t >= l.life) {
        l.light.intensity = 0;
        continue;
      }
      l.t += dt;
      l.light.intensity = l.peak * Math.max(0, 1 - l.t / l.life);
    }
  }

  dispose() {
    this.glow.dispose(this.scene);
    this.smoke.dispose(this.scene);
    for (const s of this.shocks) {
      this.scene.remove(s.mesh);
      (s.mesh.material as THREE.Material).dispose();
    }
    this.shocks[0]?.mesh.geometry.dispose();
    for (const l of this.lights) this.scene.remove(l.light);
  }
}
