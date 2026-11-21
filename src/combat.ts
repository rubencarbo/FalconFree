import * as THREE from 'three';
import type { CityGen } from './world/city';
import type { Fx } from './fx';

export const MAX_AMMO = 160;
export const BULLET_SPEED = 950;
export const BULLET_DAMAGE = 3.5;
const FIRE_RATE = 13;
const BULLET_LIFE = 1.3;
const POOL = 260;

export interface Target {
  id: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  alive: boolean;
  name?: string;
  /** bengalas activas (despistan misiles) */
  flares?: boolean;
}

export interface GunContext {
  firing: boolean;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  targets: Target[];
  aimAssist: boolean;
  onHit: (t: Target, point: THREE.Vector3, damage: number) => void;
  onShot?: () => void;
  onEmpty?: () => void;
}

const GUN_OFFSETS = [new THREE.Vector3(-2.3, -0.3, -3), new THREE.Vector3(2.3, -0.3, -3)];

/** Cañones, balas trazadoras y apuntado asistido */
export class Guns {
  maxAmmo = MAX_AMMO;
  ammo = MAX_AMMO;
  /** Multiplicador de daño (recompensa «Doble daño») */
  damageMul = 1;
  lock: Target | null = null;
  /** 0..1 progreso de fijación (para el retículo) */
  lockStrength = 0;
  private cooldown = 0;
  private side = 0;
  private emptyWarned = false;

  private mesh: THREE.InstancedMesh;
  private pos = new Float32Array(POOL * 3);
  private vel = new Float32Array(POOL * 3);
  private life = new Float32Array(POOL);
  /** true = bala propia (hace daño); false = cosmética (de otro jugador) */
  private own = new Uint8Array(POOL);
  private next = 0;

  private _a = new THREE.Vector3();
  private _b = new THREE.Vector3();
  private _c = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private _m = new THREE.Matrix4();
  private _s = new THREE.Vector3(1, 1, 1);
  private zAxis = new THREE.Vector3(0, 0, 1);

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
    private fx: Fx,
  ) {
    const geo = new THREE.BoxGeometry(0.8, 0.8, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.2, 2.2, 0.9),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < POOL; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
  }

  reload(amount: number) {
    const before = this.ammo;
    this.ammo = Math.min(this.maxAmmo, this.ammo + amount);
    if (this.ammo > 0) this.emptyWarned = false;
    return this.ammo - before;
  }

  refill() {
    this.ammo = this.maxAmmo;
    this.emptyWarned = false;
  }

  /** Busca el mejor objetivo dentro del cono de apuntado */
  private updateLock(ctx: GunContext, dt: number) {
    const fwd = this._a.set(0, 0, -1).applyQuaternion(ctx.quat);
    const cone = THREE.MathUtils.degToRad(ctx.aimAssist ? 20 : 8);
    const range = 1200;
    let best: Target | null = null;
    let bestScore = Infinity;
    for (const t of ctx.targets) {
      if (!t.alive) continue;
      const to = this._b.subVectors(t.pos, ctx.pos);
      const d = to.length();
      if (d > range || d < 5) continue;
      const ang = Math.acos(THREE.MathUtils.clamp(fwd.dot(to) / d, -1, 1));
      const limit = t === this.lock ? cone * 1.35 : cone;
      if (ang > limit) continue;
      const score = ang + d / range * 0.15 - (t === this.lock ? 0.05 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best !== this.lock) this.lockStrength = 0;
    this.lock = best;
    this.lockStrength = best ? Math.min(1, this.lockStrength + dt * 3) : 0;
  }

  update(dt: number, ctx: GunContext) {
    this.updateLock(ctx, dt);
    this.cooldown -= dt;
    if (!ctx.firing) this.cooldown = Math.max(this.cooldown, 0);
    // Varios disparos por frame si los FPS son bajos
    let shots = 0;
    while (ctx.firing && this.cooldown <= 0 && shots < 4) {
      if (this.ammo <= 0) {
        if (!this.emptyWarned) {
          this.emptyWarned = true;
          ctx.onEmpty?.();
        }
        this.cooldown = 0;
        break;
      }
      this.cooldown += 1 / FIRE_RATE;
      this.ammo--;
      shots++;
      this.fire(ctx);
    }
    this.step(dt, ctx);
  }

  private fire(ctx: GunContext) {
    const offset = GUN_OFFSETS[this.side];
    this.side = 1 - this.side;
    const muzzle = this._c.copy(offset).applyQuaternion(ctx.quat).add(ctx.pos);
    const fwd = this._a.set(0, 0, -1).applyQuaternion(ctx.quat);
    const dir = fwd.clone();

    if (this.lock && this.lockStrength > 0.3) {
      // Anticipación: dirección para interceptar al objetivo
      const t = this.lock;
      const rel = this._b.subVectors(ctx.vel, t.vel);
      const delta = new THREE.Vector3().subVectors(t.pos, muzzle);
      let time = delta.length() / BULLET_SPEED;
      for (let i = 0; i < 2; i++) {
        const aim = delta.clone().addScaledVector(rel, -time);
        time = aim.length() / BULLET_SPEED;
      }
      const aim = delta.addScaledVector(rel, -time).normalize();
      const assist = ctx.aimAssist ? 1 : 0.5;
      dir.lerp(aim, assist * this.lockStrength).normalize();
    }
    // Dispersión
    const spread = THREE.MathUtils.degToRad(ctx.aimAssist ? 0.35 : 0.6);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();

    this.spawnBullet(muzzle, dir, ctx.vel, true);
    this.fx.muzzle(muzzle, dir, ctx.vel);
    if (this.side === 0) this.fx.muzzleLight(muzzle);
    ctx.onShot?.();
  }

  /** Balas visuales de otro jugador (el daño lo calcula quien dispara) */
  cosmeticShot(pos: THREE.Vector3, quat: THREE.Quaternion, vel: THREE.Vector3) {
    const offset = GUN_OFFSETS[(Math.random() * 2) | 0];
    const muzzle = this._c.copy(offset).applyQuaternion(quat).add(pos);
    const dir = this._a.set(0, 0, -1).applyQuaternion(quat);
    this.spawnBullet(muzzle, dir, vel, false);
    this.fx.muzzle(muzzle, dir, vel);
  }

  private spawnBullet(p: THREE.Vector3, dir: THREE.Vector3, baseVel: THREE.Vector3, own: boolean) {
    const i = this.next;
    this.next = (this.next + 1) % POOL;
    const k = i * 3;
    this.pos[k] = p.x;
    this.pos[k + 1] = p.y;
    this.pos[k + 2] = p.z;
    this.vel[k] = baseVel.x + dir.x * BULLET_SPEED;
    this.vel[k + 1] = baseVel.y + dir.y * BULLET_SPEED;
    this.vel[k + 2] = baseVel.z + dir.z * BULLET_SPEED;
    this.life[i] = BULLET_LIFE;
    this.own[i] = own ? 1 : 0;
  }

  private step(dt: number, ctx: GunContext) {
    const a = this._a;
    const b = this._b;
    for (let i = 0; i < POOL; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      a.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
      this.life[i] -= dt;
      b.set(a.x + this.vel[k] * dt, a.y + this.vel[k + 1] * dt, a.z + this.vel[k + 2] * dt);
      let dead = this.life[i] <= 0;

      // Impacto contra aviones (solo balas propias)
      if (!dead && this.own[i]) {
        for (const t of ctx.targets) {
          if (!t.alive) continue;
          const r = t.radius;
          if (segmentSphere(a, b, t.pos, r)) {
            const point = closestPoint(a, b, t.pos, this._c);
            ctx.onHit(t, point.clone(), BULLET_DAMAGE * this.damageMul);
            this.fx.hit(point, t.vel);
            dead = true;
            break;
          }
        }
      }
      // Impacto contra edificios / suelo
      if (!dead) {
        const h = this.gen.heightAt(b.x, b.z);
        if (b.y <= 0.5 || (h > 0 && b.y < h)) {
          const y = b.y <= 0.5 ? 0.5 : Math.min(b.y, h);
          this._c.set(b.x, y, b.z);
          this.fx.sparks(this._c, this._b.set(0, 1, 0), 8, 45);
          dead = true;
        }
      }

      if (dead) {
        this.life[i] = 0;
        this._m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this._m);
        continue;
      }
      this.pos[k] = b.x;
      this.pos[k + 1] = b.y;
      this.pos[k + 2] = b.z;
      const v = this._c.set(this.vel[k], this.vel[k + 1], this.vel[k + 2]).normalize();
      this._q.setFromUnitVectors(this.zAxis, v);
      this._s.set(1, 1, 22);
      // La trazadora se dibuja detrás de la punta de la bala
      a.copy(b).addScaledVector(v, -11);
      this._m.compose(a, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();

function segmentSphere(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number) {
  _ab.subVectors(b, a);
  _ap.subVectors(c, a);
  const len2 = _ab.lengthSq() || 1e-6;
  const t = THREE.MathUtils.clamp(_ap.dot(_ab) / len2, 0, 1);
  const dx = a.x + _ab.x * t - c.x;
  const dy = a.y + _ab.y * t - c.y;
  const dz = a.z + _ab.z * t - c.z;
  return dx * dx + dy * dy + dz * dz < r * r;
}

function closestPoint(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3) {
  _ab.subVectors(b, a);
  _ap.subVectors(c, a);
  const t = THREE.MathUtils.clamp(_ap.dot(_ab) / (_ab.lengthSq() || 1e-6), 0, 1);
  return out.copy(a).addScaledVector(_ab, t);
}
