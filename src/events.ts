import * as THREE from 'three';
import { Flight, JetModel } from './jet';
import { Guns, type Target } from './combat';
import { buildDrone } from './drones';
import type { CityGen } from './world/city';
import type { Fx } from './fx';
import type { WeatherKind } from './weather';

export type CityEventKind = 'balloon' | 'storm' | 'convoy';

export const EVENT_NAMES: Record<CityEventKind, string> = {
  balloon: '¡Globo con premio!',
  storm: '¡Tormenta eléctrica!',
  convoy: '¡Escolta el convoy!',
};

export interface CityEventHooks {
  /** Mensaje corto en pantalla */
  toast: (text: string, ms?: number) => void;
  /** Recompensa de créditos (y si se completa el evento) */
  reward: (credits: number, completed: boolean, label: string) => void;
  /** Daño al jugador (rayos) */
  damage: (amount: number) => void;
  /** Cambiar el clima (null = volver al de antes) */
  weather: (kind: WeatherKind | null) => void;
  /** Sonidos */
  sound: (kind: 'start' | 'pickup' | 'thunder' | 'fail' | 'win') => void;
}

export interface EventHud {
  banner: string;
  kind: 'good' | 'bad' | 'warn' | 'info';
  nav: THREE.Vector3 | null;
  navLabel: string;
  navColor: number;
  items: { pos: THREE.Vector3; color: string; kind: 'gate' | 'enemy' | 'ally' | 'power' }[];
}

interface Attacker extends Target {
  hp: number;
  mesh: THREE.Group;
  rotors: THREE.Object3D[];
  angle: number;
  delay: number;
}

interface Strike {
  pos: THREE.Vector3;
  t: number;
  marker: THREE.Mesh;
  bolt: THREE.Group | null;
}

/**
 * Eventos dinámicos del vuelo libre: aparecen cada minuto y medio más o menos.
 * Globo con premio, tormenta eléctrica con esferas de energía y convoy que escoltar.
 */
export class CityEvents {
  kind: CityEventKind | null = null;
  timeLeft = 0;
  private cooldown = 35;
  private last: CityEventKind | null = null;
  private group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  // Globo
  private balloon: THREE.Group | null = null;
  private balloonVel = new THREE.Vector3();
  // Tormenta
  private orbs: THREE.Mesh[] = [];
  private orbsTotal = 0;
  private strikes: Strike[] = [];
  private strikeT = 2;
  // Convoy
  private convoy: { jet: JetModel; flight: Flight; offset: THREE.Vector3 }[] = [];
  private convoyPos = new THREE.Vector3();
  private convoyDir = new THREE.Vector3();
  private convoyDest = new THREE.Vector3();
  private convoyHp = 100;
  private attackers: Attacker[] = [];
  private guns: Guns;
  private _q = new THREE.Quaternion();

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
    private fx: Fx,
    private hooks: CityEventHooks,
  ) {
    scene.add(this.group);
    this.guns = new Guns(scene, gen, fx);
    this.guns.setWeapon({ ...this.guns.weapon, tracer: [3, 0.5, 0.4] });
  }

  get active() {
    return this.kind !== null;
  }

  /** Objetivos para las armas del jugador (atacantes del convoy) */
  targets(): Target[] {
    return this.attackers.filter((a) => a.alive && a.delay <= 0);
  }

  /** Daño a un atacante. Devuelve true si lo destruye. */
  damage(id: string, dmg: number): boolean {
    const a = this.attackers.find((x) => x.id === id);
    if (!a || !a.alive) return false;
    a.hp -= dmg;
    if (a.hp > 0) return false;
    a.alive = false;
    a.mesh.visible = false;
    this.fx.explosion(a.pos, a.vel, 0.8);
    return true;
  }

  update(dt: number, time: number, player: THREE.Vector3, fwd: THREE.Vector3, alive: boolean) {
    this.guns.update(dt, { firing: false, pos: player, quat: this._q, vel: new THREE.Vector3(), targets: [], aimAssist: false, onHit: () => undefined });
    if (!this.kind) {
      if (!alive) return;
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.start(player, fwd);
      return;
    }
    this.timeLeft -= dt;
    if (this.kind === 'balloon') this.updateBalloon(dt, time, player, alive);
    else if (this.kind === 'storm') this.updateStorm(dt, time, player, fwd, alive);
    else this.updateConvoy(dt, time);
  }

  // ------------------------------------------------------------ Inicio y fin
  private start(player: THREE.Vector3, fwd: THREE.Vector3) {
    const kinds: CityEventKind[] = ['balloon', 'storm', 'convoy'];
    const options = kinds.filter((k) => k !== this.last);
    const kind = options[Math.floor(Math.random() * options.length)];
    this.kind = kind;
    this.last = kind;
    const dir = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    if (dir.lengthSq() < 0.1) dir.set(0, 0, -1);
    if (kind === 'balloon') this.startBalloon(player, dir);
    else if (kind === 'storm') this.startStorm(player, dir);
    else this.startConvoy(player, dir);
    this.hooks.sound('start');
    this.hooks.toast(EVENT_NAMES[kind], 2200);
  }

  private finish(completed: boolean, credits: number, label: string) {
    if (credits > 0 || completed) this.hooks.reward(credits, completed, label);
    this.hooks.toast(label, 2400);
    this.hooks.sound(completed ? 'win' : 'fail');
    if (this.kind === 'storm') this.hooks.weather(null);
    this.clear();
    this.cooldown = 70 + Math.random() * 40;
  }

  private clear() {
    this.kind = null;
    this.group.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.balloon = null;
    this.orbs = [];
    this.strikes = [];
    for (const c of this.convoy) this.scene.remove(c.jet.group);
    this.convoy = [];
    for (const a of this.attackers) this.scene.remove(a.mesh);
    this.attackers = [];
  }

  private safeY(x: number, z: number, min: number) {
    return Math.max(min, this.gen.maxHeightNear(x, z, 120) + 80);
  }

  private beam(color: number, height = 900) {
    const geo = new THREE.CylinderGeometry(3, 3, height, 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = height / 2 + 30;
    return m;
  }

  // ------------------------------------------------------------ Globo
  private startBalloon(player: THREE.Vector3, dir: THREE.Vector3) {
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((Math.random() - 0.5) * 1400);
    const p = player.clone().addScaledVector(dir, 1500 + Math.random() * 600).add(side);
    p.y = this.safeY(p.x, p.z, 280 + Math.random() * 200);
    const g = new THREE.Group();
    // Envoltura a gajos de colores
    const geo = new THREE.SphereGeometry(24, 12, 10).toNonIndexed();
    geo.scale(1, 1.18, 1);
    const colors = [new THREE.Color(0xff4d4d), new THREE.Color(0xffd23f), new THREE.Color(0x3fa7ff), new THREE.Color(0xffffff)];
    const pos = geo.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const seg = Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * 12) % 4;
      for (let k = 0; k < 3; k++) colors[seg].toArray(col, (i + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x221100 });
    const basketGeo = new THREE.BoxGeometry(9, 7, 9);
    const basketMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
    const ropeGeo = new THREE.BoxGeometry(0.6, 14, 0.6);
    const ropeMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const giftGeo = new THREE.BoxGeometry(5, 5, 5);
    const giftMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 0.5) });
    this.disposables.push(geo, mat, basketGeo, basketMat, ropeGeo, ropeMat, giftGeo, giftMat);
    g.add(new THREE.Mesh(geo, mat));
    const basket = new THREE.Mesh(basketGeo, basketMat);
    basket.position.y = -40;
    g.add(basket);
    for (const [x, z] of [
      [-4, -4],
      [4, -4],
      [-4, 4],
      [4, 4],
    ]) {
      const r = new THREE.Mesh(ropeGeo, ropeMat);
      r.position.set(x, -31, z);
      g.add(r);
    }
    const gift = new THREE.Mesh(giftGeo, giftMat);
    gift.position.y = -34;
    g.add(gift, this.beam(0xffd23f));
    g.position.copy(p);
    this.group.add(g);
    this.balloon = g;
    const wind = Math.random() * Math.PI * 2;
    this.balloonVel.set(Math.cos(wind) * 9, 0.6, Math.sin(wind) * 9);
    this.timeLeft = 75;
  }

  private updateBalloon(dt: number, time: number, player: THREE.Vector3, alive: boolean) {
    const b = this.balloon!;
    b.position.addScaledVector(this.balloonVel, dt);
    b.position.y += Math.sin(time * 0.8) * dt * 2;
    b.rotation.y += dt * 0.15;
    if (alive && b.position.distanceTo(player) < 42) {
      this.fx.sparks(b.position, null, 60, 90);
      this.hooks.sound('pickup');
      this.finish(true, 150, '¡Globo alcanzado! +150 créditos');
      return;
    }
    if (this.timeLeft <= 0) this.finish(false, 0, 'El globo se ha alejado…');
  }

  // ------------------------------------------------------------ Tormenta
  private startStorm(player: THREE.Vector3, dir: THREE.Vector3) {
    this.hooks.weather('storm');
    const geo = new THREE.IcosahedronGeometry(7, 1);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 2.2, 3.2) });
    const haloGeo = new THREE.IcosahedronGeometry(14, 1);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
    this.disposables.push(geo, mat, haloGeo, haloMat);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dir.x, dir.z) + (i / n - 0.5) * 2.6;
      const r = 600 + Math.random() * 900;
      const x = player.x + Math.sin(a) * r;
      const z = player.z + Math.cos(a) * r;
      const orb = new THREE.Mesh(geo, mat);
      orb.add(new THREE.Mesh(haloGeo, haloMat));
      orb.position.set(x, this.safeY(x, z, 180 + Math.random() * 250), z);
      this.group.add(orb);
      this.orbs.push(orb);
    }
    this.orbsTotal = n;
    this.strikeT = 3;
    this.timeLeft = 60;
  }

  private updateStorm(dt: number, time: number, player: THREE.Vector3, fwd: THREE.Vector3, alive: boolean) {
    for (const o of this.orbs) {
      o.rotation.y += dt;
      o.scale.setScalar(1 + Math.sin(time * 5 + o.position.x) * 0.12);
    }
    if (alive) {
      const got = this.orbs.findIndex((o) => o.position.distanceTo(player) < 26);
      if (got >= 0) {
        const o = this.orbs[got];
        this.fx.sparks(o.position, null, 40, 80);
        this.group.remove(o);
        this.orbs.splice(got, 1);
        this.hooks.sound('pickup');
        this.hooks.reward(15, false, '');
        this.hooks.toast(`Esfera de energía · ${this.orbsTotal - this.orbs.length}/${this.orbsTotal}`, 1200);
        if (!this.orbs.length) {
          this.finish(true, 160, '¡Tormenta dominada! +160 créditos');
          return;
        }
      }
    }
    // Rayos: aviso en el suelo y descarga 1,3 s después
    this.strikeT -= dt;
    if (this.strikeT <= 0 && alive) {
      this.strikeT = 2.2 + Math.random() * 1.6;
      const ahead = player.clone().addScaledVector(fwd, 220 + Math.random() * 200);
      ahead.x += (Math.random() - 0.5) * 220;
      ahead.z += (Math.random() - 0.5) * 220;
      const geo = new THREE.CylinderGeometry(45, 45, 1400, 20, 1, true);
      const mat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      this.disposables.push(geo, mat);
      const marker = new THREE.Mesh(geo, mat);
      marker.position.set(ahead.x, 700, ahead.z);
      this.group.add(marker);
      this.strikes.push({ pos: new THREE.Vector3(ahead.x, 0, ahead.z), t: 1.3, marker, bolt: null });
    }
    for (const s of [...this.strikes]) {
      s.t -= dt;
      const m = s.marker.material as THREE.MeshBasicMaterial;
      if (!s.bolt) {
        m.opacity = 0.1 + (1 - s.t / 1.3) * 0.25 + Math.sin(time * 30) * 0.04;
        if (s.t <= 0) {
          s.bolt = this.bolt(s.pos);
          this.group.add(s.bolt);
          this.group.remove(s.marker);
          this.hooks.sound('thunder');
          const top = this.gen.maxHeightNear(s.pos.x, s.pos.z, 40);
          this.fx.sparks(new THREE.Vector3(s.pos.x, top + 2, s.pos.z), null, 30, 70);
          const d = Math.hypot(player.x - s.pos.x, player.z - s.pos.z);
          if (alive && d < 48) this.hooks.damage(30);
        }
      } else if (s.t < -0.25) {
        this.group.remove(s.bolt);
        this.strikes.splice(this.strikes.indexOf(s), 1);
      }
    }
    if (this.timeLeft <= 0) {
      const got = this.orbsTotal - this.orbs.length;
      this.finish(false, 0, `La tormenta pasa · ${got}/${this.orbsTotal} esferas`);
    }
  }

  private bolt(at: THREE.Vector3) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.2, 4), fog: false });
    this.disposables.push(mat);
    let p = new THREE.Vector3(at.x + (Math.random() - 0.5) * 80, 1300, at.z + (Math.random() - 0.5) * 80);
    const ground = this.gen.maxHeightNear(at.x, at.z, 40);
    for (let i = 0; i < 12; i++) {
      const k = (i + 1) / 12;
      const next = new THREE.Vector3(at.x + (Math.random() - 0.5) * 70 * (1 - k), 1300 + (ground - 1300) * k, at.z + (Math.random() - 0.5) * 70 * (1 - k));
      const len = p.distanceTo(next);
      const geo = new THREE.BoxGeometry(2.5, len, 2.5);
      this.disposables.push(geo);
      const seg = new THREE.Mesh(geo, mat);
      seg.position.copy(p).add(next).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), next.clone().sub(p).normalize());
      g.add(seg);
      p = next;
    }
    return g;
  }

  // ------------------------------------------------------------ Convoy
  private startConvoy(player: THREE.Vector3, dir: THREE.Vector3) {
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const start = player.clone().addScaledVector(dir, 500).addScaledVector(side, 350);
    start.y = this.safeY(start.x, start.z, 320);
    this.convoyPos.copy(start);
    this.convoyDir.copy(dir);
    this.convoyDest.copy(start).addScaledVector(dir, 4800);
    this.convoyHp = 100;
    const yaw = Math.atan2(-dir.x, -dir.z);
    const offsets = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-40, -6, 45), new THREE.Vector3(40, -6, 45)];
    for (const off of offsets) {
      const jet = new JetModel(0x3fd07a, 0xc8ccd2, 'typhoon');
      jet.group.scale.setScalar(2.4);
      this.scene.add(jet.group);
      const flight = new Flight();
      flight.reset(start.x, start.y, start.z, yaw);
      flight.thrust = 0.6;
      this.convoy.push({ jet, flight, offset: off });
    }
    // Atacantes en dos oleadas
    for (let i = 0; i < 6; i++) {
      const { group, rotors } = buildDrone();
      group.scale.setScalar(1.4);
      group.visible = false;
      this.scene.add(group);
      this.attackers.push({
        id: `evt-a${i}`,
        name: 'Saqueador',
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        radius: 9,
        alive: true,
        hp: 30,
        mesh: group,
        rotors,
        angle: (i / 6) * Math.PI * 2,
        delay: i < 3 ? 4 + i : 22 + (i - 3) * 2,
      });
    }
    this.timeLeft = 4800 / 90;
  }

  private updateConvoy(dt: number, time: number) {
    const speed = 90;
    this.convoyPos.addScaledVector(this.convoyDir, speed * dt);
    const floor = this.gen.maxHeightNear(this.convoyPos.x, this.convoyPos.z, 150) + 70;
    this.convoyPos.y += (Math.max(floor, this.convoyPos.y) - this.convoyPos.y) * Math.min(1, dt * 2);
    const yaw = Math.atan2(-this.convoyDir.x, -this.convoyDir.z);
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (const c of this.convoy) {
      c.flight.pos.copy(c.offset).applyQuaternion(rot).add(this.convoyPos);
      c.flight.yaw = yaw;
      c.flight.pitch = 0;
      c.flight.roll = Math.sin(time * 0.7 + c.offset.x) * 0.04;
      c.jet.update(c.flight, time);
      c.jet.group.visible = this.convoyHp > 0;
    }
    for (const a of this.attackers) {
      if (!a.alive) continue;
      if (a.delay > 0) {
        a.delay -= dt;
        if (a.delay <= 0) {
          a.mesh.visible = true;
          const from = this.convoyPos.clone().addScaledVector(this.convoyDir, 900).add(new THREE.Vector3(Math.cos(a.angle) * 400, 60, Math.sin(a.angle) * 400));
          a.pos.copy(from);
        }
        continue;
      }
      a.angle += dt * 0.7;
      const goal = this.convoyPos.clone().add(new THREE.Vector3(Math.cos(a.angle) * 130, 25 + Math.sin(a.angle * 2) * 20, Math.sin(a.angle) * 130));
      const to = goal.sub(a.pos);
      const max = 140;
      const v = to.clone().clampLength(0, max);
      a.vel.lerp(v.add(this.convoyDir.clone().multiplyScalar(speed)), Math.min(1, dt * 2));
      a.pos.addScaledVector(a.vel, dt);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(this.convoyPos);
      for (const r of a.rotors) r.rotation.y += dt * 40;
      const d = a.pos.distanceTo(this.convoyPos);
      if (d < 260 && this.convoyHp > 0) {
        this.convoyHp -= 1.6 * dt;
        if (Math.random() < dt * 6) {
          this._q.setFromRotationMatrix(new THREE.Matrix4().lookAt(a.pos, this.convoyPos, new THREE.Vector3(0, 1, 0)));
          this.guns.cosmeticShot(a.pos, this._q, a.vel);
        }
        if (Math.random() < dt * 2) this.fx.hit(this.convoyPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, 0, (Math.random() - 0.5) * 60)), this.convoyDir);
      }
    }
    if (this.convoyHp <= 0) {
      for (const c of this.convoy) this.fx.explosion(c.flight.pos, this.convoyDir.clone().multiplyScalar(speed), 1.6);
      this.finish(false, 0, 'El convoy ha caído…');
      return;
    }
    if (this.timeLeft <= 0 || this.convoyPos.distanceTo(this.convoyDest) < 60) {
      const credits = Math.round(60 + this.convoyHp * 1.4);
      this.finish(true, credits, `¡Convoy a salvo con ${Math.ceil(this.convoyHp)} % de carga! +${credits} créditos`);
    }
  }

  // ------------------------------------------------------------ HUD
  hud(player: THREE.Vector3): EventHud | null {
    if (!this.kind) return null;
    const t = Math.max(0, Math.ceil(this.timeLeft));
    if (this.kind === 'balloon' && this.balloon) {
      return { banner: `Globo con premio · alcánzalo · ${t} s`, kind: 'info', nav: this.balloon.position, navLabel: 'GLOBO', navColor: 0xffd23f, items: [{ pos: this.balloon.position, color: '#ffd23f', kind: 'gate' }] };
    }
    if (this.kind === 'storm') {
      return {
        banner: `Tormenta · esferas ${this.orbsTotal - this.orbs.length}/${this.orbsTotal} · ¡evita los rayos! · ${t} s`,
        kind: 'warn',
        nav: this.nearestOrb(player),
        navLabel: 'ESFERA',
        navColor: 0x66ccff,
        items: this.orbs.map((o) => ({ pos: o.position, color: '#66ccff', kind: 'power' as const })),
      };
    }
    const enemies = this.attackers.filter((a) => a.alive && a.delay <= 0);
    return {
      banner: `Convoy ${Math.ceil(this.convoyHp)} % · ${enemies.length ? `¡${enemies.length} saqueadores atacando!` : 'escóltalo hasta el destino'} · ${t} s`,
      kind: this.convoyHp < 35 ? 'bad' : enemies.length ? 'warn' : 'good',
      nav: this.convoyPos,
      navLabel: 'CONVOY',
      navColor: 0x3fd07a,
      items: [{ pos: this.convoyPos, color: '#3fd07a', kind: 'ally' as const }, ...enemies.map((a) => ({ pos: a.pos, color: '#ff4040', kind: 'enemy' as const }))],
    };
  }

  private nearestOrb(p: THREE.Vector3) {
    let best: THREE.Vector3 | null = null;
    let bd = Infinity;
    for (const o of this.orbs) {
      const d = o.position.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = o.position;
      }
    }
    return best;
  }

  dispose() {
    if (this.kind === 'storm') this.hooks.weather(null);
    this.clear();
    this.scene.remove(this.group);
    this.guns.dispose();
  }
}
