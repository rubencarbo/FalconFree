import * as THREE from 'three';
import { Flight, JetModel, type FlightInput } from './jet';
import { Guns, type Target } from './combat';
import type { CityGen } from './world/city';
import type { Fx } from './fx';
import type { Missiles } from './missiles';

export type Team = 'A' | 'B';

export const TEAM_COLORS: Record<Team, number> = { A: 0xff8a2a, B: 0x2ec5ff };
export const TEAM_NAMES: Record<Team, string> = { A: 'Naranja', B: 'Azul' };

/** Indicativos de los pilotos de la máquina */
const BOT_NAMES = ['Cuervo', 'Lince', 'Navaja', 'Polilla', 'Víbora', 'Rayo', 'Sombra', 'Trueno', 'Escorpión', 'Cobra', 'Martillo', 'Jaguar', 'Fantasma', 'Ciclón', 'Halcón Gris', 'Avispa'];
const BOT_COLORS = [0xd8323a, 0xffb020, 0x30c070, 0x5a50e0, 0x303038, 0xc0c8d0, 0xff6a6a, 0xa0e040, 0x40c8e0, 0xe060c0, 0x8a6a40, 0x60e0a0, 0xe0e060, 0x6080ff, 0xff8a40, 0xa080e0];

export interface BotSpec {
  id: string;
  name: string;
  team: Team | null;
  color: number;
}

export function makeBotSpecs(n: number, teamFor: (i: number) => Team | null): BotSpec[] {
  return Array.from({ length: n }, (_, i) => ({ id: `bot${i + 1}`, name: BOT_NAMES[i % BOT_NAMES.length], team: teamFor(i), color: BOT_COLORS[i % BOT_COLORS.length] }));
}

/** Avión controlado por la máquina */
export class Bot {
  flight = new Flight();
  jet: JetModel;
  target: Target;
  hp = 100;
  alive = true;
  respawn = 0;
  guns: Guns;
  firing = false;
  private aimAt: Target | null = null;
  private retarget = 0;
  private burst = 0;
  private missileTimer = 8 + Math.random() * 10;
  private lockTime = 0;
  private skill: number;

  constructor(
    public spec: BotSpec,
    private scene: THREE.Scene,
    private gen: CityGen,
    fx: Fx,
    skill = 0.7,
  ) {
    this.skill = skill;
    this.jet = new JetModel(spec.team ? TEAM_COLORS[spec.team] : spec.color, new THREE.Color(spec.color).lerp(new THREE.Color(0x22252b), 0.5).getHex());
    scene.add(this.jet.group);
    this.guns = new Guns(scene, gen, fx);
    this.guns.maxAmmo = this.guns.ammo = 99999;
    this.guns.damageMul = 0.55 + skill * 0.25;
    this.target = { id: spec.id, name: spec.name, pos: this.flight.pos, vel: new THREE.Vector3(), radius: 9, alive: true };
  }

  spawn(center: THREE.Vector3, radius: number) {
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.5 + Math.random() * 0.5);
    const x = center.x + Math.cos(a) * r;
    const z = center.z + Math.sin(a) * r;
    const y = Math.max(350, this.gen.maxHeightNear(x, z, 300) + 150) + Math.random() * 200;
    this.flight.reset(x, y, z, Math.atan2(x - center.x, z - center.z));
    this.hp = 100;
    this.alive = true;
    this.target.alive = true;
    this.jet.group.visible = true;
  }

  kill() {
    this.alive = false;
    this.hp = 0;
    this.target.alive = false;
    this.jet.group.visible = false;
    this.respawn = 4;
    this.firing = false;
  }

  /** IA + física. Devuelve true si se ha estrellado. */
  update(
    dt: number,
    time: number,
    enemies: Target[],
    arena: THREE.Vector3,
    missiles: Missiles,
    onHit: (t: Target, dmg: number) => void,
    opts: { goal?: THREE.Vector3; flee?: THREE.Vector3; noFire?: boolean; chase?: boolean } = {},
  ): boolean {
    if (!this.alive) {
      this.guns.update(dt, { firing: false, pos: this.flight.pos, quat: this.jet.group.quaternion, vel: this.target.vel, targets: [], aimAssist: true, onHit: () => undefined });
      return false;
    }
    const f = this.flight;
    // Elegir objetivo
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.aimAt || !this.aimAt.alive) {
      this.retarget = 2 + Math.random() * 2;
      let best: Target | null = null;
      let bd = Infinity;
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = e.pos.distanceTo(f.pos);
        if (d < bd && d < 3500) {
          bd = d;
          best = e;
        }
      }
      this.aimAt = best;
    }

    const fwd = f.forward();
    let goal: THREE.Vector3;
    let dist = Infinity;
    if (this.aimAt) {
      dist = this.aimAt.pos.distanceTo(f.pos);
      // Persecución (pilla-pilla): poca anticipación para ir directo a por el avión
      const lead = opts.chase ? Math.min(0.3, dist / 1000) : Math.min(1.5, dist / 900) * this.skill;
      goal = this.aimAt.pos.clone().addScaledVector(this.aimAt.vel, lead);
    } else {
      // Patrulla en círculo alrededor del centro
      const a = time * 0.15 + this.spec.id.length;
      goal = arena.clone().add(new THREE.Vector3(Math.cos(a) * 550, 450, Math.sin(a) * 550));
    }
    // Objetivo del modo (zona del Rey del cielo): ir a ella salvo combate cercano
    if (opts.goal && (!this.aimAt || dist > 650)) {
      const a = time * 0.35 + this.spec.id.length * 1.7;
      goal = opts.goal.clone().add(new THREE.Vector3(Math.cos(a) * 70, 0, Math.sin(a) * 70));
    }
    // Pilla-pilla: huir de quien la lleva
    if (opts.flee) {
      const away = f.pos.clone().sub(opts.flee).setY(0);
      if (away.lengthSq() < 1) away.set(1, 0, 0);
      goal = f.pos.clone().addScaledVector(away.normalize(), 900).setY(Math.max(300, f.pos.y));
      // no salir de la arena
      if (goal.distanceTo(arena) > 1400) goal.lerp(arena.clone().setY(400), 0.6);
    }
    if (Math.hypot(f.pos.x - arena.x, f.pos.z - arena.z) > 1700) goal = arena.clone().setY(Math.max(450, f.pos.y));

    // Evitar el suelo y los edificios
    const ahead = f.pos.clone().addScaledVector(fwd, 250);
    const floor = Math.max(this.gen.maxHeightNear(ahead.x, ahead.z, 120), this.gen.maxHeightNear(f.pos.x, f.pos.z, 80)) + 90;
    const to = goal.clone().sub(f.pos);
    const desiredYaw = Math.atan2(-to.x, -to.z);
    let yawErr = desiredYaw - f.yaw;
    while (yawErr > Math.PI) yawErr -= Math.PI * 2;
    while (yawErr < -Math.PI) yawErr += Math.PI * 2;
    const horiz = Math.hypot(to.x, to.z);
    let desiredPitch = THREE.MathUtils.clamp(Math.atan2(to.y, horiz), -0.6, 0.7);
    if (f.pos.y < floor) desiredPitch = Math.max(desiredPitch, 0.5);
    else if (f.pos.y < floor + 60) desiredPitch = Math.max(desiredPitch, 0.05);

    const input: FlightInput = {
      x: THREE.MathUtils.clamp(-yawErr * 2.4, -1, 1),
      y: THREE.MathUtils.clamp((desiredPitch - f.pitch) * 3, -1, 1),
      // Pilla-pilla: quien la lleva solo usa turbo si estás lejos; quien huye, solo si se le acercan
      boost: opts.chase ? dist > 150 : opts.flee ? f.pos.distanceTo(opts.flee) < 500 : dist > 700 && dist < 4000,
      climb: false,
    };
    // Pilla-pilla equilibrado: los bots no son más rápidos que el jugador
    f.speedMul = opts.chase ? 1.06 : opts.flee ? 0.92 : 1;
    f.update(dt, input);
    this.target.vel.copy(f.forward()).multiplyScalar(f.speed);

    // Disparo en ráfagas cuando apunta bien
    let firing = false;
    if (this.aimAt && dist < 950 && !opts.noFire) {
      const ang = fwd.angleTo(this.aimAt.pos.clone().sub(f.pos));
      if (ang < THREE.MathUtils.degToRad(9)) {
        this.burst += dt;
        firing = this.burst % 2 < 1.1;
        this.lockTime += dt;
      } else {
        this.lockTime = 0;
      }
    } else {
      this.lockTime = 0;
    }
    this.firing = firing;
    this.missileTimer -= dt;
    if (this.aimAt && !opts.noFire && this.lockTime > 1.5 && this.missileTimer <= 0 && dist < 1500) {
      this.missileTimer = 14 + Math.random() * 12;
      missiles.launch(f.pos, this.jet.group.quaternion, this.target.vel, this.aimAt, 'bot', this.spec.id);
    }

    this.jet.update(f, time);
    this.guns.update(dt, {
      firing,
      pos: f.pos,
      quat: this.jet.group.quaternion,
      vel: this.target.vel,
      targets: this.aimAt ? [this.aimAt] : [],
      aimAssist: true,
      onHit: (t, _p, dmg) => onHit(t, dmg),
    });

    // Colisión con el escenario
    const h = this.gen.heightAt(f.pos.x, f.pos.z);
    return f.pos.y < 2 || (h > 0 && f.pos.y < h);
  }

  dispose() {
    this.scene.remove(this.jet.group);
    this.guns.dispose();
  }
}
