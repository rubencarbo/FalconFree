import * as THREE from 'three';
import { Guns, STANDARD_WEAPON, type Target, type WeaponDef } from './combat';
import type { CityGen } from './world/city';
import type { Fx } from './fx';
import type { Missiles } from './missiles';

export type PartKind = 'turret' | 'engine' | 'core';

export const PHASE_LABELS = ['', 'Destruye las torretas', 'Destruye los motores', '¡El núcleo está expuesto!', 'Derribado'];

/** Estado compacto que publica el anfitrión */
export interface BossNet {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** fase 1..3, 4 = derribado */
  ph: number;
  /** vida de cada parte */
  hp: number[];
  /** bits: torretas disparando (0..3) y cañón del núcleo (4) */
  f: number;
  t: number;
}

interface BossPart {
  id: string;
  kind: PartKind;
  phase: number;
  local: THREE.Vector3;
  hp: number;
  maxHp: number;
  mesh: THREE.Object3D;
  mats: THREE.MeshLambertMaterial[];
  target: Target;
  guns?: Guns;
  burst: number;
  aim: Target | null;
  firing: boolean;
}

export interface BossEvents {
  onPartDestroyed?: (kind: PartKind, pos: THREE.Vector3) => void;
  onPhase?: (phase: number) => void;
  onDefeated?: () => void;
}

const TURRET_WEAPON: WeaponDef = {
  ...STANDARD_WEAPON,
  name: 'Torreta',
  fireRate: 7,
  damage: 1.6,
  speed: 780,
  spread: 2.2,
  tracer: [3, 0.6, 0.4],
  lockRange: 1000,
  cone: 30,
};

const CORE_WEAPON: WeaponDef = {
  ...STANDARD_WEAPON,
  name: 'Cañón del núcleo',
  fireRate: 3,
  damage: 6,
  speed: 620,
  spread: 1.5,
  barrels: 2,
  tracer: [3.2, 1.4, 0.2],
  lockRange: 1300,
  cone: 40,
};

const ORBIT = 950;
const ALTITUDE = 560;
const BASE_SPEED = 26;

/** Dirigible gigante con partes destructibles y tres fases */
export class Boss {
  group = new THREE.Group();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  phase = 1;
  parts: BossPart[] = [];
  events: BossEvents = {};
  /** quien simula (en solitario o el anfitrión) */
  authority = true;
  private angle = 0;
  private alt = ALTITUDE;
  private roll = 0;
  private pitch = 0;
  private missileT = 10;
  private deathT = 0;
  private props: THREE.Object3D[] = [];
  private shield!: THREE.Mesh;
  private shieldMat!: THREE.MeshBasicMaterial;
  private netTarget: BossNet | null = null;
  private disposables: { dispose(): void }[] = [];
  private _q = new THREE.Quaternion();
  private _v = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
    private fx: Fx,
    public center: THREE.Vector3,
    hpScale = 1,
  ) {
    this.build(hpScale);
    this.place(0);
    scene.add(this.group);
    void this.gen;
  }

  // ------------------------------------------------------------ Modelo
  private build(hpScale: number) {
    const g = this.group;
    const mat = (c: number, e = 0) => {
      const m = new THREE.MeshLambertMaterial({ color: c, emissive: e });
      this.disposables.push(m);
      return m;
    };
    const box = (w: number, h: number, d: number) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      this.disposables.push(geo);
      return geo;
    };
    const hullA = mat(0x8a909a);
    const hullB = mat(0x6c727c);
    const red = mat(0xb8262e);
    const dark = mat(0x2a2d33);
    // Casco: segmentos de caja que forman un huso
    for (let z = -120; z <= 120; z += 15) {
      const t = z / 128;
      const w = 34 * Math.sqrt(Math.max(0, 1 - t * t)) + 5;
      const m = new THREE.Mesh(box(w * 2, w * 1.75, 15.4), Math.abs(z) < 8 ? red : (z / 15) % 2 === 0 ? hullA : hullB);
      m.position.z = z;
      g.add(m);
    }
    // Aletas de cola
    const fin = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(box(w, h, d), red);
      m.position.set(x, y, z);
      g.add(m);
    };
    fin(3, 42, 34, 0, 30, 102);
    fin(3, 42, 34, 0, -30, 102);
    fin(42, 3, 34, 30, 0, 102);
    fin(42, 3, 34, -30, 0, 102);
    // Luces de posición
    const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.25) });
    this.disposables.push(lightMat);
    for (const [x, y, z] of [
      [0, 32, -100],
      [0, 52, 104],
      [52, 0, 104],
      [-52, 0, 104],
    ]) {
      const l = new THREE.Mesh(box(3, 3, 3), lightMat);
      l.position.set(x, y, z);
      g.add(l);
    }

    let n = 0;
    const part = (kind: PartKind, phase: number, local: THREE.Vector3, mesh: THREE.Object3D, mats: THREE.MeshLambertMaterial[], hp: number, radius: number) => {
      mesh.position.copy(local);
      g.add(mesh);
      const id = `boss-${n++}`;
      const p: BossPart = {
        id,
        kind,
        phase,
        local,
        hp: hp * hpScale,
        maxHp: hp * hpScale,
        mesh,
        mats,
        target: { id, name: kind === 'turret' ? 'Torreta' : kind === 'engine' ? 'Motor' : 'Núcleo', pos: new THREE.Vector3(), vel: new THREE.Vector3(), radius, alive: true },
        burst: Math.random() * 2,
        aim: null,
        firing: false,
      };
      if (kind === 'turret') p.guns = new Guns(this.scene, this.gen, this.fx);
      if (kind === 'core') p.guns = new Guns(this.scene, this.gen, this.fx);
      if (p.guns) {
        p.guns.setWeapon(kind === 'core' ? CORE_WEAPON : TURRET_WEAPON);
        p.guns.maxAmmo = p.guns.ammo = 1e9;
      }
      this.parts.push(p);
      return p;
    };

    // Torretas (fase 1)
    for (const local of [new THREE.Vector3(0, 31, -62), new THREE.Vector3(0, 31, 42), new THREE.Vector3(-39, 2, -18), new THREE.Vector3(39, 2, -18)]) {
      const tm = mat(0x3a3e46);
      const t = new THREE.Group();
      const base = new THREE.Mesh(box(10, 6, 10), tm);
      const barrel = new THREE.Mesh(box(2, 2, 12), dark);
      barrel.position.set(0, 1, -7);
      const eye = new THREE.Mesh(box(4, 1.4, 1), lightMat);
      eye.position.set(0, 2.4, -5);
      t.add(base, barrel, eye);
      part('turret', 1, local, t, [tm], 240, 11);
    }
    // Motores (fase 2)
    for (const side of [-1, 1]) {
      const em = mat(0x50555e);
      const eg = new THREE.Group();
      eg.add(new THREE.Mesh(box(14, 14, 30), em));
      const strut = new THREE.Mesh(box(18, 3, 6), dark);
      strut.position.x = -side * 14;
      eg.add(strut);
      const glow = new THREE.Mesh(box(10, 10, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.6, 3) }));
      glow.position.z = 15.5;
      this.disposables.push(glow.material as THREE.Material);
      eg.add(glow);
      const prop = new THREE.Group();
      prop.position.z = 17;
      prop.add(new THREE.Mesh(box(30, 3, 1), dark), new THREE.Mesh(box(3, 30, 1), dark));
      eg.add(prop);
      this.props.push(prop);
      part('engine', 2, new THREE.Vector3(side * 50, -6, 58), eg, [em], 420, 15);
    }
    // Núcleo: góndola bajo el casco (fase 3)
    const cm = mat(0x454a54, 0x000000);
    const core = new THREE.Group();
    core.add(new THREE.Mesh(box(24, 14, 52), cm));
    const win = new THREE.Mesh(box(25, 3, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.4, 3) }));
    this.disposables.push(win.material as THREE.Material);
    win.position.y = 2;
    core.add(win);
    part('core', 3, new THREE.Vector3(0, -38, -8), core, [cm], 1100, 20);
    // Escudo del núcleo mientras no está expuesto
    this.shieldMat = new THREE.MeshBasicMaterial({ color: 0x55b8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    this.shield = new THREE.Mesh(box(34, 24, 64), this.shieldMat);
    this.shield.position.set(0, -38, -8);
    g.add(this.shield);
    this.disposables.push(this.shieldMat);
  }

  // ------------------------------------------------------------ Estado
  /** Partes que se pueden dañar ahora */
  get vulnerable(): BossPart[] {
    return this.phase >= 4 ? [] : this.parts.filter((p) => p.hp > 0 && p.phase === this.phase);
  }

  /** Objetivos para las armas de los jugadores */
  targets(): Target[] {
    return this.vulnerable.map((p) => p.target);
  }

  part(id: string) {
    return this.parts.find((p) => p.id === id);
  }

  get defeated() {
    return this.phase >= 4;
  }

  /** Vida total restante de la fase (0..1) */
  phaseHealth() {
    const ps = this.parts.filter((p) => p.phase === this.phase);
    const max = ps.reduce((a, p) => a + p.maxHp, 0);
    return max ? ps.reduce((a, p) => a + Math.max(0, p.hp), 0) / max : 0;
  }

  /** Texto corto de la fase para el HUD */
  phaseLabel() {
    if (this.phase >= 4) return PHASE_LABELS[4];
    const ps = this.parts.filter((p) => p.phase === this.phase);
    const left = ps.filter((p) => p.hp > 0).length;
    const what = this.phase === 1 ? 'torretas' : this.phase === 2 ? 'motores' : 'núcleo';
    return `Fase ${this.phase}/3 · ${PHASE_LABELS[this.phase]}${this.phase < 3 ? ` (${left} ${what})` : ''}`;
  }

  /**
   * Daño a una parte. Solo lo aplica quien tiene la autoridad.
   * Devuelve el daño aplicado (0 si la parte está blindada).
   */
  damage(id: string, dmg: number): number {
    const p = this.part(id);
    if (!p || p.hp <= 0 || p.phase !== this.phase || this.phase >= 4) {
      if (p && p.hp > 0) this.fx.shieldSpark(p.target.pos);
      return 0;
    }
    const applied = Math.min(p.hp, dmg);
    p.hp -= dmg;
    for (const m of p.mats) m.emissive.setRGB(0.6, 0.15, 0.1);
    if (p.hp <= 0) this.onPartDown(p);
    return applied;
  }

  private onPartDown(p: BossPart) {
    p.hp = 0;
    p.target.alive = false;
    p.firing = false;
    this.fx.explosion(p.target.pos, this.vel, p.kind === 'core' ? 2.2 : 1.3);
    for (const m of p.mats) m.color.setHex(0x1b1c20);
    if (p.kind === 'turret') p.mesh.scale.setScalar(0.6);
    this.events.onPartDestroyed?.(p.kind, p.target.pos.clone());
    if (this.parts.filter((x) => x.phase === this.phase).every((x) => x.hp <= 0)) {
      this.phase++;
      if (this.phase === 4) {
        this.deathT = 0;
        this.events.onDefeated?.();
      } else this.events.onPhase?.(this.phase);
    }
  }

  // ------------------------------------------------------------ Movimiento
  private speed() {
    const engines = this.parts.filter((p) => p.kind === 'engine' && p.hp > 0).length;
    return this.phase >= 3 ? 40 : BASE_SPEED * (0.55 + 0.225 * engines);
  }

  private place(dt: number) {
    if (this.phase < 4) {
      const sp = this.speed();
      this.angle += (sp / ORBIT) * dt;
      const targetAlt = this.phase >= 3 ? ALTITUDE - 90 : ALTITUDE;
      this.alt += (targetAlt - this.alt) * Math.min(1, dt * 0.3);
      const prev = this.pos.clone();
      this.pos.set(this.center.x + Math.cos(this.angle) * ORBIT, this.alt, this.center.z + Math.sin(this.angle) * ORBIT);
      this.yaw = Math.PI - this.angle;
      if (dt > 0) this.vel.subVectors(this.pos, prev).divideScalar(dt);
      this.roll += ((this.phase >= 3 ? 0.12 : 0) - this.roll) * Math.min(1, dt);
    }
  }

  private updateTransform(time: number) {
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.group.updateMatrixWorld(true);
    for (const p of this.parts) {
      p.target.pos.copy(p.local).applyMatrix4(this.group.matrixWorld);
      p.target.vel.copy(this.vel);
      for (const m of p.mats) if (p.hp > 0) m.emissive.multiplyScalar(0.85);
      if (p.hp <= 0 && Math.random() < 0.5) this.fx.damageTrail(p.target.pos, 0.05, 0.05);
    }
    const coreExposed = this.phase >= 3;
    this.shield.visible = !coreExposed && this.phase < 4;
    this.shieldMat.opacity = 0.16 + 0.08 * Math.sin(time * 4);
    for (const [i, pr] of this.props.entries()) {
      const alive = this.parts.filter((p) => p.kind === 'engine')[i]?.hp > 0;
      pr.rotation.z += alive ? 0.6 : 0.02;
    }
  }

  // ------------------------------------------------------------ Bucle
  /**
   * enemies: aviones a los que dispara. onHit: impacto de sus armas.
   */
  update(dt: number, time: number, enemies: Target[], missiles: Missiles, onHit: (t: Target, dmg: number) => void) {
    if (this.phase >= 4) {
      this.updateDeath(dt);
      return;
    }
    if (this.authority) this.place(dt);
    else this.followNet(dt);
    this.updateTransform(time);

    for (const p of this.parts) {
      if (!p.guns) continue;
      const active = p.hp > 0 && (p.kind === 'turret' || this.phase >= 3);
      if (this.authority) {
        p.aim = null;
        if (active) {
          let bd = p.kind === 'core' ? 1300 : 1000;
          for (const e of enemies) {
            if (!e.alive) continue;
            const d = e.pos.distanceTo(p.target.pos);
            if (d < bd) {
              bd = d;
              p.aim = e;
            }
          }
        }
        p.burst += dt;
        const cycle = p.kind === 'core' ? 3.2 : 2.6;
        p.firing = !!p.aim && p.burst % cycle < (p.kind === 'core' ? 1.8 : 1.4);
      } else if (!active) p.firing = false;
      // Orientar el arma hacia su objetivo (o hacia el avión más cercano si es una réplica)
      const aimPos = p.aim?.pos ?? (p.firing ? nearest(enemies, p.target.pos)?.pos : null);
      const quat = this._q;
      if (aimPos) {
        const m = new THREE.Matrix4().lookAt(p.target.pos, aimPos, new THREE.Vector3(0, 1, 0));
        quat.setFromRotationMatrix(m);
        if (p.kind === 'turret') {
          const parentInv = this.group.quaternion.clone().invert();
          p.mesh.quaternion.copy(parentInv.multiply(quat));
        }
      } else quat.copy(this.group.quaternion);
      p.guns.update(dt, {
        firing: p.firing && this.authority,
        pos: p.target.pos,
        quat,
        vel: this.vel,
        targets: p.aim ? [p.aim] : [],
        aimAssist: false,
        onHit: (t, _pt, dmg) => onHit(t, dmg),
      });
      if (!this.authority && p.firing && Math.random() < dt * (p.kind === 'core' ? 3 : 7)) p.guns.cosmeticShot(p.target.pos, quat, this.vel);
    }

    // Misiles desde la fase 2
    if (this.authority && this.phase >= 2) {
      this.missileT -= dt;
      if (this.missileT <= 0) {
        this.missileT = this.phase >= 3 ? 5 : 9;
        const cands = enemies.filter((e) => e.alive && e.pos.distanceTo(this.pos) < 1800);
        const t = cands[Math.floor(Math.random() * cands.length)];
        if (t) {
          const from = this._v.set(0, 40, 0).add(this.pos);
          const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(from, t.pos, new THREE.Vector3(0, 1, 0)));
          missiles.launch(from.clone(), q, this.vel, t, 'bot', 'botboss');
        }
      }
    }
  }

  private updateDeath(dt: number) {
    this.deathT += dt;
    this.pitch = Math.min(0.5, this.pitch + dt * 0.08);
    this.roll += dt * 0.05;
    this.pos.y -= dt * (20 + this.deathT * 18);
    this.pos.addScaledVector(this.vel, dt * 0.5);
    if (Math.random() < dt * 5) {
      const local = new THREE.Vector3((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 220);
      this.fx.explosion(local.applyMatrix4(this.group.matrixWorld), this.vel, 1.4);
    }
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.group.updateMatrixWorld(true);
    if (this.pos.y < 20 && this.group.visible) {
      this.fx.explosion(this.pos, new THREE.Vector3(), 3);
      this.group.visible = false;
    }
  }

  /** ¿El punto p está dentro del casco? (choque) */
  hits(p: THREE.Vector3) {
    if (this.phase >= 4 && !this.group.visible) return false;
    const inv = this.group.matrixWorld.clone().invert();
    const l = p.clone().applyMatrix4(inv);
    const e = (l.x / 40) ** 2 + (l.y / 36) ** 2 + (l.z / 128) ** 2;
    if (e < 1) return true;
    // góndola
    return Math.abs(l.x) < 14 && Math.abs(l.y + 38) < 9 && Math.abs(l.z + 8) < 28;
  }

  // ------------------------------------------------------------ Red
  netState(): Omit<BossNet, 't'> {
    let f = 0;
    this.parts.forEach((p, i) => {
      if (p.firing) f |= 1 << Math.min(i, 4);
    });
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, ph: this.phase, hp: this.parts.map((p) => Math.max(0, Math.round(p.hp))), f };
  }

  /** Réplica (clientes que no son el anfitrión) */
  applyNet(s: BossNet) {
    this.netTarget = s;
    if (this.pos.lengthSq() === 0 || this.pos.distanceTo(new THREE.Vector3(s.x, s.y, s.z)) > 400) this.pos.set(s.x, s.y, s.z);
    s.hp.forEach((hp, i) => {
      const p = this.parts[i];
      if (!p) return;
      if (hp < p.hp) for (const m of p.mats) m.emissive.setRGB(0.6, 0.15, 0.1);
      if (p.hp > 0 && hp <= 0) {
        p.hp = 0;
        this.onPartDown(p);
      } else p.hp = hp;
      p.firing = ((s.f >> Math.min(i, 4)) & 1) === 1;
    });
    if (s.ph > this.phase && s.ph >= 4 && this.phase < 4) {
      this.phase = 4;
      this.events.onDefeated?.();
    } else if (s.ph > this.phase) {
      this.phase = s.ph;
      this.events.onPhase?.(this.phase);
    }
  }

  private followNet(dt: number) {
    const s = this.netTarget;
    if (!s) return;
    const prev = this.pos.clone();
    const k = 1 - Math.exp(-dt * 4);
    this.pos.lerp(this._v.set(s.x, s.y, s.z), k);
    let dy = s.yaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * k;
    if (dt > 0) this.vel.subVectors(this.pos, prev).divideScalar(dt);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const p of this.parts) p.guns?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function nearest(list: Target[], p: THREE.Vector3) {
  let best: Target | null = null;
  let bd = Infinity;
  for (const t of list) {
    if (!t.alive) continue;
    const d = t.pos.distanceToSquared(p);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}
