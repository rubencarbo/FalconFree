import * as THREE from 'three';
import { JetModel, Flight } from './jet';
import type { BotNet, NetState, PlayerInfo } from './net';
import { TEAM_COLORS } from './bots';
import type { Target } from './combat';
import type { Fx } from './fx';
import type { Guns } from './combat';

/** Retraso de interpolación (ms): suaviza el movimiento a cambio de un poco de latencia */
const INTERP_DELAY = 140;

/** Cuerpo del avión teñido con el color del piloto */
export function bodyTint(color: number) {
  const c = new THREE.Color(color).lerp(new THREE.Color(0x22252b), 0.5);
  return c.getHex();
}

class RemotePlayer {
  jet: JetModel;
  buffer: NetState[] = [];
  target: Target;
  quat = new THREE.Quaternion();
  hp = 100;
  alive = true;
  firing = false;
  /** vuela en formación (humo de colores) */
  smoke = false;
  private flight = new Flight();
  private shotTimer = 0;
  private wasAlive = true;

  constructor(
    public uid: string,
    public info: PlayerInfo,
    private scene: THREE.Scene,
  ) {
    this.jet = this.makeJet(info);
    scene.add(this.jet.group);
    this.target = { id: uid, name: info.name, pos: new THREE.Vector3(), vel: new THREE.Vector3(), radius: 9, alive: false };
  }

  /** Color con el que se identifica (equipo en batalla por equipos, si no el suyo) */
  get color() {
    return this.info.color;
  }

  private makeJet(info: PlayerInfo) {
    const c = info.color;
    return new JetModel(info.team ? TEAM_COLORS[info.team] : c, bodyTint(c), info.plane ?? 'falcon');
  }

  /** Actualiza nombre/color/icono si el piloto los cambia */
  setInfo(info: PlayerInfo) {
    const changed = info.color !== this.info.color || info.team !== this.info.team || info.plane !== this.info.plane;
    this.info = info;
    this.target.name = info.name;
    if (changed) {
      const vis = this.jet.group.visible;
      this.scene.remove(this.jet.group);
      this.jet = this.makeJet(info);
      this.jet.group.visible = vis;
      this.scene.add(this.jet.group);
    }
  }

  get flaresActive() {
    return this.target.flares === true;
  }

  push(s: NetState) {
    const last = this.buffer[this.buffer.length - 1];
    if (last && s.t <= last.t) return;
    this.buffer.push(s);
    if (this.buffer.length > 30) this.buffer.shift();
  }

  /** Devuelve true si acaba de explotar */
  update(dt: number, serverNow: number, time: number, guns: Guns, fx: Fx): boolean {
    const b = this.buffer;
    if (!b.length) return false;
    const rt = serverNow - INTERP_DELAY;
    let a = b[0];
    let c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) {
      if (b[i].t <= rt && b[i + 1].t >= rt) {
        a = b[i];
        c = b[i + 1];
        break;
      }
    }
    const f = this.flight;
    if (rt >= c.t) {
      // Extrapolar como mucho 400 ms
      const ex = Math.min(0.4, (rt - c.t) / 1000);
      f.yaw = c.yaw;
      f.pitch = c.pitch;
      f.roll = c.roll;
      const fwd = f.forward();
      f.pos.set(c.x, c.y, c.z).addScaledVector(fwd, c.s * ex);
    } else if (rt <= a.t) {
      f.pos.set(a.x, a.y, a.z);
      f.yaw = a.yaw;
      f.pitch = a.pitch;
      f.roll = a.roll;
    } else {
      const k = (rt - a.t) / Math.max(1, c.t - a.t);
      f.pos.set(a.x + (c.x - a.x) * k, a.y + (c.y - a.y) * k, a.z + (c.z - a.z) * k);
      f.yaw = lerpAngle(a.yaw, c.yaw, k);
      f.pitch = a.pitch + (c.pitch - a.pitch) * k;
      f.roll = a.roll + (c.roll - a.roll) * k;
    }
    const cur = b[b.length - 1];
    f.speed = cur.s;
    f.thrust = cur.s > 300 ? 1 : 0.55;
    this.hp = cur.hp;
    this.firing = cur.f === 1;
    this.alive = cur.a === 1;
    this.target.flares = cur.fl === 1;
    this.smoke = cur.sm === 1;

    this.target.pos.copy(f.pos);
    // Velocidad a partir del estado enviado (robusto ante saltos/reapariciones)
    this.target.vel.copy(f.forward()).multiplyScalar(f.speed);
    this.target.alive = this.alive;
    f.quaternion(this.quat);

    this.jet.update(f, time);
    this.jet.group.visible = this.alive;

    if (this.alive) {
      fx.damageTrail(f.pos, this.hp / 100, dt);
      if (this.firing) {
        this.shotTimer -= dt;
        if (this.shotTimer <= 0) {
          this.shotTimer = 1 / 12;
          guns.cosmeticShot(f.pos, this.quat, f.forward().multiplyScalar(f.speed));
        }
      }
    }
    const exploded = this.wasAlive && !this.alive;
    this.wasAlive = this.alive;
    return exploded;
  }

  dispose() {
    this.scene.remove(this.jet.group);
  }
}

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** Conjunto de jugadores remotos */
export class RemotePlayers {
  map = new Map<string, RemotePlayer>();

  constructor(private scene: THREE.Scene) {}

  sync(players: Map<string, PlayerInfo>, myUid: string, bots?: Map<string, BotNet>) {
    for (const [uid, info] of players) {
      if (uid === myUid) continue;
      const ex = this.map.get(uid);
      if (!ex) this.map.set(uid, new RemotePlayer(uid, info, this.scene));
      else ex.setInfo(info);
    }
    if (bots) {
      for (const [id, b] of bots) {
        if (!this.map.has(id)) {
          const color = b.tm ? TEAM_COLORS[b.tm] : b.c;
          this.map.set(id, new RemotePlayer(id, { name: b.n, color, joinedAt: 0, team: b.tm }, this.scene));
        }
        this.map.get(id)!.push(b);
      }
    }
    for (const [uid, p] of this.map) {
      if (!players.has(uid) && !bots?.has(uid)) {
        p.dispose();
        this.map.delete(uid);
      }
    }
  }

  state(uid: string, s: NetState | null) {
    const p = this.map.get(uid);
    if (!p) return;
    if (s) p.push(s);
    else p.buffer = [];
  }

  update(dt: number, serverNow: number, time: number, guns: Guns, fx: Fx) {
    for (const p of this.map.values()) {
      if (p.update(dt, serverNow, time, guns, fx)) {
        fx.explosion(p.target.pos, p.target.vel, 1);
      }
    }
  }

  targets(): Target[] {
    return [...this.map.values()].filter((p) => p.buffer.length).map((p) => p.target);
  }

  get(uid: string) {
    return this.map.get(uid);
  }

  dispose() {
    for (const p of this.map.values()) p.dispose();
    this.map.clear();
  }
}
