import * as THREE from 'three';
import { Flight, JetModel } from './jet';
import { buildDrone } from './drones';
import type { Fx } from './fx';
import type { Guns } from './combat';

const RATE = 20;
const KEEP = 25;

interface ActorFrame {
  id: string;
  kind: 'jet' | 'drone';
  color: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  alive: boolean;
  fire: boolean;
}

interface Frame {
  t: number;
  actors: ActorFrame[];
}

export type ReplayEventType = 'explosion' | 'scrape' | 'missile';
export interface ReplayEvent {
  t: number;
  type: ReplayEventType;
  x: number;
  y: number;
  z: number;
  scale: number;
}

export interface Highlight {
  t: number;
  label: string;
}

export interface Recording {
  frames: Frame[];
  events: ReplayEvent[];
  highlights: Highlight[];
  me: string;
  myColors: [number, number];
  myVariant: 'falcon' | 'raptor' | 'typhoon' | 'colibri';
}

/** Graba continuamente los últimos segundos de juego */
export class ReplayRecorder {
  private frames: Frame[] = [];
  private events: ReplayEvent[] = [];
  private highlights: Highlight[] = [];
  private acc = 0;
  t = 0;

  reset() {
    this.frames = [];
    this.events = [];
    this.highlights = [];
    this.t = 0;
  }

  get hasContent() {
    return this.frames.length > RATE * 2;
  }

  tick(dt: number, sample: () => ActorFrame[]) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / RATE) return;
    this.acc = 0;
    this.frames.push({ t: this.t, actors: sample() });
    const min = this.t - KEEP;
    while (this.frames.length && this.frames[0].t < min) this.frames.shift();
    while (this.events.length && this.events[0].t < min) this.events.shift();
    while (this.highlights.length && this.highlights[0].t < min) this.highlights.shift();
  }

  event(type: ReplayEventType, p: THREE.Vector3, scale = 1) {
    this.events.push({ t: this.t, type, x: p.x, y: p.y, z: p.z, scale });
  }

  highlight(label: string) {
    this.highlights.push({ t: this.t, label });
  }

  snapshot(me: string, colors: [number, number], variant: Recording['myVariant']): Recording {
    return {
      frames: this.frames.map((f) => ({ t: f.t, actors: f.actors.map((a) => ({ ...a })) })),
      events: this.events.map((e) => ({ ...e })),
      highlights: this.highlights.map((h) => ({ ...h })),
      me,
      myColors: colors,
      myVariant: variant,
    };
  }
}

type Shot = 'orbit' | 'flyby' | 'chase' | 'side' | 'tower';
const SHOTS: Shot[] = ['chase', 'flyby', 'orbit', 'side', 'tower'];

interface Actor {
  obj: THREE.Object3D;
  jet?: JetModel;
  flight: Flight;
  fireTimer: number;
}

/** Reproduce una grabación con cámara cinematográfica */
export class ReplayPlayer {
  active = false;
  label = '';
  private rec!: Recording;
  private t = 0;
  private t0 = 0;
  private t1 = 0;
  private actors = new Map<string, Actor>();
  private eventIdx = 0;
  private shot: Shot = 'chase';
  private shotT = 0;
  private shotIdx = 0;
  private flybyPoint = new THREE.Vector3();
  private orbitA = 0;
  readonly subject = new THREE.Vector3();
  onEnd?: () => void;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private fx: Fx,
    private guns: Guns,
  ) {}

  start(rec: Recording) {
    this.stop();
    this.rec = rec;
    const frames = rec.frames;
    if (frames.length < 4) return false;
    const end = frames[frames.length - 1].t;
    const hs = rec.highlights.slice(-2);
    if (hs.length) {
      this.t0 = Math.max(frames[0].t, Math.min(...hs.map((h) => h.t)) - 5);
      this.t1 = Math.min(end, Math.max(...hs.map((h) => h.t)) + 2.5);
      if (this.t1 - this.t0 > 18) this.t0 = this.t1 - 18;
      this.label = hs.map((h) => h.label).join(' · ');
    } else {
      this.t0 = Math.max(frames[0].t, end - 12);
      this.t1 = end;
      this.label = 'Últimos segundos';
    }
    this.t = this.t0;
    this.eventIdx = rec.events.findIndex((e) => e.t >= this.t0);
    if (this.eventIdx < 0) this.eventIdx = rec.events.length;
    this.shotIdx = 0;
    this.nextShot();
    this.active = true;
    return true;
  }

  stop() {
    for (const a of this.actors.values()) this.scene.remove(a.obj);
    this.actors.clear();
    this.active = false;
  }

  private nextShot() {
    this.shot = SHOTS[this.shotIdx % SHOTS.length];
    this.shotIdx++;
    this.shotT = 0;
    this.orbitA = Math.random() * Math.PI * 2;
    // Punto de pasada: por delante de la trayectoria futura
    const ahead = this.sample(this.t + 1.6)?.find((a) => a.id === this.rec.me);
    if (ahead) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const yaw = ahead.yaw;
      this.flybyPoint.set(ahead.x + Math.cos(yaw) * 28 * side, ahead.y + 6, ahead.z - Math.sin(yaw) * 28 * side);
    }
  }

  private sample(t: number): ActorFrame[] | null {
    const f = this.rec.frames;
    if (!f.length) return null;
    let i = 0;
    while (i < f.length - 2 && f[i + 1].t < t) i++;
    const a = f[i];
    const b = f[Math.min(f.length - 1, i + 1)];
    const k = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    return a.actors.map((x) => {
      const y = b.actors.find((q) => q.id === x.id) ?? x;
      let dy = y.yaw - x.yaw;
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      return {
        ...x,
        x: x.x + (y.x - x.x) * k,
        y: x.y + (y.y - x.y) * k,
        z: x.z + (y.z - x.z) * k,
        yaw: x.yaw + dy * k,
        pitch: x.pitch + (y.pitch - x.pitch) * k,
        roll: x.roll + (y.roll - x.roll) * k,
      };
    });
  }

  /** Cámara lenta cerca de las jugadas destacadas */
  private timeScale() {
    for (const h of this.rec.highlights) if (Math.abs(h.t - this.t) < 1.1) return 0.3;
    return 1;
  }

  update(dt: number, time: number) {
    if (!this.active) return;
    const scale = this.timeScale();
    this.t += dt * scale;
    this.shotT += dt;
    if (this.shotT > 3 && scale === 1) this.nextShot();

    const actors = this.sample(this.t) ?? [];
    for (const af of actors) {
      let a = this.actors.get(af.id);
      if (!a) {
        if (af.kind === 'drone') {
          const d = buildDrone();
          this.scene.add(d.group);
          a = { obj: d.group, flight: new Flight(), fireTimer: 0 };
        } else {
          const mine = af.id === this.rec.me;
          const jet = mine ? new JetModel(this.rec.myColors[1], this.rec.myColors[0], this.rec.myVariant) : new JetModel(af.color, 0x3a3f48);
          this.scene.add(jet.group);
          a = { obj: jet.group, jet, flight: new Flight(), fireTimer: 0 };
        }
        this.actors.set(af.id, a);
      }
      const f = a.flight;
      f.pos.set(af.x, af.y, af.z);
      f.yaw = af.yaw;
      f.pitch = af.pitch;
      f.roll = af.roll;
      f.thrust = 0.8;
      f.speed = 200;
      if (a.jet) a.jet.update(f, time);
      else {
        a.obj.position.copy(f.pos);
        a.obj.rotation.y = af.yaw;
      }
      a.obj.visible = af.alive;
      if (af.alive && af.fire && a.jet) {
        a.fireTimer -= dt * scale;
        if (a.fireTimer <= 0) {
          a.fireTimer = 1 / 12;
          this.guns.cosmeticShot(f.pos, a.jet.group.quaternion, f.forward().multiplyScalar(f.speed));
        }
      }
      if (af.id === this.rec.me) this.subject.copy(f.pos);
    }

    // Eventos
    while (this.eventIdx < this.rec.events.length && this.rec.events[this.eventIdx].t <= this.t) {
      const e = this.rec.events[this.eventIdx++];
      const p = new THREE.Vector3(e.x, e.y, e.z);
      if (e.type === 'explosion') this.fx.explosion(p, new THREE.Vector3(), e.scale);
      else if (e.type === 'scrape') this.fx.scrape(p, new THREE.Vector3(0, 1, 0));
    }

    this.updateCamera(actors);
    if (this.t >= this.t1) {
      this.stop();
      this.onEnd?.();
    }
  }

  private updateCamera(actors: ActorFrame[]) {
    const me = actors.find((a) => a.id === this.rec.me);
    const cam = this.camera;
    const s = this.subject;
    const fwd = me ? new THREE.Vector3(-Math.sin(me.yaw) * Math.cos(me.pitch), Math.sin(me.pitch), -Math.cos(me.yaw) * Math.cos(me.pitch)) : new THREE.Vector3(0, 0, -1);
    cam.up.set(0, 1, 0);
    switch (this.shot) {
      case 'chase':
        cam.position.copy(s).addScaledVector(fwd, -26).add(new THREE.Vector3(0, 5, 0));
        cam.lookAt(s.clone().addScaledVector(fwd, 30));
        cam.fov = 70;
        break;
      case 'flyby':
        cam.position.copy(this.flybyPoint);
        cam.lookAt(s);
        cam.fov = 45;
        break;
      case 'orbit': {
        this.orbitA += 0.012;
        cam.position.copy(s).add(new THREE.Vector3(Math.cos(this.orbitA) * 45, 12, Math.sin(this.orbitA) * 45));
        cam.lookAt(s);
        cam.fov = 55;
        break;
      }
      case 'side': {
        const right = new THREE.Vector3(Math.cos(me?.yaw ?? 0), 0, -Math.sin(me?.yaw ?? 0));
        cam.position.copy(s).addScaledVector(right, 38).add(new THREE.Vector3(0, 3, 0)).addScaledVector(fwd, 8);
        cam.lookAt(s);
        cam.fov = 50;
        break;
      }
      case 'tower':
        cam.position.copy(s).add(new THREE.Vector3(30, 140, 30));
        cam.lookAt(s);
        cam.fov = 40;
        break;
    }
    cam.updateProjectionMatrix();
  }
}
