import * as THREE from 'three';
import type { Target } from './combat';
import type { CityGen } from './world/city';
import type { Fx } from './fx';

export const MAX_MISSILES = 4;
export const START_MISSILES = 2;
export const MISSILE_DAMAGE = 45;
export const MAX_FLARES = 3;
const FLARE_RECHARGE = 12;
const FLARE_WINDOW = 1.6;
const TURN_RATE = 1.7;
const LIFE = 7;

export type MissileOwner = 'me' | 'bot' | 'remote';

interface Missile {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  speed: number;
  target: Target | null;
  owner: MissileOwner;
  shooterId: string;
  life: number;
  decoyed: boolean;
  checkedFlare: number;
}

interface Flare {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

export interface MissileContext {
  /** Avión propio como objetivo (para misiles enemigos) */
  me: Target;
  /** ¿Tiene bengalas activas el objetivo? */
  hasFlares: (t: Target) => boolean;
  onHit: (m: { owner: MissileOwner; shooterId: string }, target: Target, point: THREE.Vector3) => void;
  onDecoyed?: (m: { owner: MissileOwner; target: Target | null }) => void;
}

function buildMissileMesh() {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
  const red = new THREE.MeshLambertMaterial({ color: 0xd8323a });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.6) });
  const add = (w: number, h: number, d: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.z = z;
    g.add(b);
  };
  add(0.7, 0.7, 4, 0, white);
  add(0.5, 0.5, 0.8, -2.3, red);
  add(2, 0.15, 0.6, 1.5, white);
  add(0.15, 2, 0.6, 1.5, white);
  add(0.6, 0.6, 0.6, 2.3, glow);
  return g;
}

/** Misiles teledirigidos y bengalas */
export class Missiles {
  count = START_MISSILES;
  flares = MAX_FLARES;
  /** s restantes en las que mis bengalas despistan misiles */
  myFlareWindow = 0;
  private flareCharge = 0;
  private list: Missile[] = [];
  private flareList: Flare[] = [];
  private _a = new THREE.Vector3();
  private _b = new THREE.Vector3();
  private zAxis = new THREE.Vector3(0, 0, -1);

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
    private fx: Fx,
  ) {}

  reset() {
    this.count = START_MISSILES;
    this.flares = MAX_FLARES;
    this.myFlareWindow = 0;
    for (const m of this.list) this.removeMesh(m.mesh);
    this.list = [];
    this.flareList = [];
  }

  addMissiles(n: number) {
    this.count = Math.min(MAX_MISSILES, this.count + n);
  }

  /** ¿Hay algún misil persiguiéndome? */
  incomingTo(id: string): Missile | null {
    let best: Missile | null = null;
    for (const m of this.list) {
      if (m.target?.id === id && !m.decoyed && (!best || m.life > best.life)) best = m;
    }
    return best;
  }

  /** Lanza un misil propio (o de un bot) contra un objetivo */
  launch(from: THREE.Vector3, quat: THREE.Quaternion, vel: THREE.Vector3, target: Target, owner: MissileOwner, shooterId: string) {
    if (owner === 'me') {
      if (this.count <= 0) return false;
      this.count--;
    }
    const mesh = buildMissileMesh();
    const pos = new THREE.Vector3(0, -1.6, -2).applyQuaternion(quat).add(from);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const speed = Math.max(220, vel.length() + 40);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.list.push({ mesh, pos, vel: dir.multiplyScalar(speed), speed, target, owner, shooterId, life: LIFE, decoyed: false, checkedFlare: -1 });
    return true;
  }

  deployFlares(pos: THREE.Vector3, vel: THREE.Vector3) {
    if (this.flares <= 0) return false;
    this.flares--;
    this.myFlareWindow = FLARE_WINDOW;
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      this.flareList.push({
        pos: pos.clone(),
        vel: vel.clone().multiplyScalar(0.4).add(new THREE.Vector3(side * (20 + i * 6), -10 - i * 3, 0)),
        life: 2.4,
      });
    }
    return true;
  }

  /** Bengalas visuales de otro jugador */
  cosmeticFlares(pos: THREE.Vector3, vel: THREE.Vector3) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      this.flareList.push({ pos: pos.clone(), vel: vel.clone().multiplyScalar(0.4).add(new THREE.Vector3(side * (20 + i * 6), -10 - i * 3, 0)), life: 2.4 });
    }
  }

  update(dt: number, ctx: MissileContext) {
    this.myFlareWindow = Math.max(0, this.myFlareWindow - dt);
    if (this.flares < MAX_FLARES) {
      this.flareCharge += dt;
      if (this.flareCharge >= FLARE_RECHARGE) {
        this.flareCharge = 0;
        this.flares++;
      }
    }

    // Bengalas
    for (let i = this.flareList.length - 1; i >= 0; i--) {
      const f = this.flareList[i];
      f.life -= dt;
      f.vel.y -= 15 * dt;
      f.vel.multiplyScalar(1 - dt * 0.8);
      f.pos.addScaledVector(f.vel, dt);
      this.fx.flareSpark(f.pos);
      if (f.life <= 0) this.flareList.splice(i, 1);
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.life -= dt;
      m.speed = Math.min(560, m.speed + 160 * dt);
      const t = m.target;
      let dead = m.life <= 0;
      let hit = false;

      if (t && !m.decoyed && t.alive) {
        // Bengalas: cada despliegue nuevo se comprueba una vez
        if (ctx.hasFlares(t)) {
          const key = Math.floor(performance.now() / 1000);
          if (m.checkedFlare !== key && Math.random() < 0.85) {
            m.decoyed = true;
            m.life = Math.min(m.life, 1.4);
            ctx.onDecoyed?.(m);
          }
          m.checkedFlare = key;
        }
      }

      const dir = this._a.copy(m.vel).normalize();
      if (t && !m.decoyed && t.alive) {
        const dist = t.pos.distanceTo(m.pos);
        const lead = this._b.copy(t.pos).addScaledVector(t.vel, Math.min(2, dist / m.speed));
        const want = lead.sub(m.pos).normalize();
        const angle = dir.angleTo(want);
        if (angle > THREE.MathUtils.degToRad(80)) {
          m.decoyed = true; // pierde el blanco tras una maniobra brusca
          m.life = Math.min(m.life, 1.5);
          ctx.onDecoyed?.(m);
        } else if (angle > 1e-4) {
          const k = Math.min(1, (TURN_RATE * dt) / angle);
          dir.lerp(want, k).normalize();
        }
        if (dist < 14) {
          ctx.onHit(m, t, m.pos.clone());
          this.fx.explosion(m.pos, t.vel, 0.6);
          dead = true;
          hit = true;
        }
      }
      m.vel.copy(dir).multiplyScalar(m.speed);
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.setFromUnitVectors(this.zAxis, dir);
      this.fx.missileTrail(m.pos, dir);

      if (!dead) {
        const h = this.gen.heightAt(m.pos.x, m.pos.z);
        if (m.pos.y < 1 || (h > 0 && m.pos.y < h)) dead = true;
      }
      if (dead) {
        if (!hit) this.fx.explosion(m.pos, new THREE.Vector3(), 0.4);
        this.removeMesh(m.mesh);
        this.list.splice(i, 1);
      }
    }
  }

  private removeMesh(g: THREE.Group) {
    this.scene.remove(g);
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    });
  }

  dispose() {
    for (const m of this.list) this.removeMesh(m.mesh);
    this.list = [];
    this.flareList = [];
  }
}
