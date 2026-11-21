import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { STAGES, getStage, type Stage, type StageId } from './stages';
import { CityGen, type Box } from './world/city';
import { ChunkManager } from './world/chunks';
import { Flight, JetModel, CRUISE_KMH, BOOST_KMH, type FlightInput } from './jet';
import { CameraRig, CAMERA_LABELS, CAMERA_MODES } from './cameraRig';
import { Contrails, FarGround, Rings, Sky } from './effects';
import { Fx } from './fx';
import { Guns, MAX_AMMO, type Target } from './combat';
import { Drones } from './drones';
import { Race, COURSES, buildCourse, courseId, formatTime, formatDelta, loadBest, type CourseDef, type RaceEvent } from './race';
import { Input } from './input';
import { Hud } from './hud';
import { GameAudio } from './audio';
import { firebase } from './firebase';
import { Room, NetError, formatCode, normalizeCode, MAX_PLAYERS, type NetEvent, type RoomMeta, type RoomMode } from './net';
import { RemotePlayers } from './remote';
import { loadSettings, saveSettings, store, type Settings } from './settings';
import { applyControlLayout, ControlsEditor } from './controls';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, v: boolean) => $(id).classList.toggle('hidden', !v);

type Screen = 'menu' | 'playing' | 'crashed' | 'results' | 'lobby';
type Mode = 'free' | 'race';

const isTouch = matchMedia('(hover: none), (pointer: coarse)').matches;

/** Velocidad perpendicular (m/s) a partir de la cual un choque destruye el avión */
const HARD_IMPACT = 48;
/** Velocidad de aproximación (m/s) entre aviones a partir de la cual explotan */
const HARD_BUMP = 75;
const RESPAWN_TIME = 3;
const NET_RATE = 10;

class Game {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 1, 9000);
  rig = new CameraRig(this.camera);
  flight = new Flight();
  jet = new JetModel();
  hud = new Hud();
  audio = new GameAudio();
  input: Input;
  settings: Settings;
  editor = new ControlsEditor();

  stage!: Stage;
  gen!: CityGen;
  chunks!: ChunkManager;
  rings!: Rings;
  sky!: Sky;
  far!: FarGround;
  contrails!: Contrails;
  fx!: Fx;
  guns!: Guns;
  drones!: Drones;
  hemi!: THREE.HemisphereLight;
  sun!: THREE.DirectionalLight;
  remotes: RemotePlayers;

  screen: Screen = 'menu';
  mode: Mode = 'free';
  paused = false;
  room: Room | null = null;
  race: Race | null = null;
  courseDef: CourseDef = COURSES[0];

  // Estado del jugador
  hp = 100;
  alive = true;
  respawnTimer = 0;
  invuln = 0;
  bumpCooldown = 0;
  ringCount = 0;
  kills = 0;
  /** Momento de salida (ms, en el reloj de la sala o local) */
  goAt = 0;
  private myRound = 0;
  private lastCountdown = -1;

  private timer = new THREE.Timer();
  private time = 0;
  private crashTimer = 0;
  private warnTimer = 0;
  private netTimer = 0;
  private shotSoundTimer = 0;
  private prevPos = new THREE.Vector3();
  private stageListEls: HTMLElement[] = [];
  private lastInput: FlightInput = { x: 0, y: 0, boost: false, climb: false, fire: false };

  constructor() {
    const canvas = $<HTMLCanvasElement>('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.3, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.scene.add(this.jet.group);
    this.remotes = new RemotePlayers(this.scene);

    this.settings = loadSettings();
    this.input = new Input($('joy-zone'), $('joy-base'), $('joy-knob'), $('btn-boost'), $('btn-climb'), $('btn-fire'), canvas);
    this.applySettings();
    this.input.onCamera = () => this.cycleCamera();
    this.input.onPause = () => {
      if (this.screen === 'playing') this.setPaused(!this.paused);
    };
    this.input.onBoostStart = () => {
      if (this.screen === 'playing' && this.alive && !this.flight.frozen) this.hud.toast('¡Turbo!');
    };
    this.hud.onLock = () => this.audio.lockOn();

    this.loadStage(getStage(store.get('stage')));
    this.setupUi();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'playing' && !this.room) this.setPaused(true);
    });
    window.addEventListener('beforeunload', () => {
      void this.room?.leave();
    });

    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ================================================================ Mundo
  loadStage(stage: Stage) {
    if (this.chunks) this.disposeWorld();
    this.stage = stage;
    store.set('stage', stage.id);
    this.gen = new CityGen(stage);
    const radius = isTouch ? 5 : 7;
    this.chunks = new ChunkManager(this.scene, this.gen, radius);
    this.rings = new Rings(this.scene, this.gen);
    this.chunks.onChunkAdded = (cx, cz) => {
      this.rings.addChunk(cx, cz);
      // Anillos ya recogidos por el equipo
      if (this.room) for (const id of this.room.rings) this.rings.takenByOther(id);
    };
    this.chunks.onChunkRemoved = (cx, cz) => this.rings.removeChunk(cx, cz);

    this.scene.background = new THREE.Color(stage.sky.horizon);
    this.scene.fog = new THREE.FogExp2(stage.sky.fog, stage.fogDensity);
    this.sky = new Sky(stage);
    this.scene.add(this.sky.mesh);
    this.far = new FarGround(stage);
    this.scene.add(this.far.mesh);
    this.hemi = new THREE.HemisphereLight(stage.hemi.sky, stage.hemi.ground, stage.hemi.intensity);
    this.sun = new THREE.DirectionalLight(stage.sun.color, stage.sun.intensity);
    this.sun.position.set(...stage.sun.dir);
    this.scene.add(this.hemi, this.sun);
    this.contrails = new Contrails(this.scene);
    this.fx = new Fx(this.scene);
    this.fx.high = this.settings.effects === 'high';
    this.guns = new Guns(this.scene, this.gen, this.fx);
    this.drones = new Drones(this.scene, this.gen);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.bloom.strength = stage.night ? 1 : 0.8;

    this.spawnAt(new THREE.Vector3(0, this.safeAltitude(0, 0), 0), Math.random() * Math.PI * 2);
    this.chunks.warmup(this.flight.pos.x, this.flight.pos.z, 12);
    this.refreshStageLists();
  }

  private disposeWorld() {
    this.race?.dispose();
    this.race = null;
    this.chunks.dispose();
    this.rings.dispose();
    this.scene.remove(this.sky.mesh, this.far.mesh, this.hemi, this.sun);
    this.sky.dispose();
    this.far.dispose();
    this.contrails.dispose(this.scene);
    this.fx.dispose();
    this.guns.dispose();
    this.drones.dispose();
  }

  private safeAltitude(x: number, z: number) {
    return Math.max(420, this.gen.maxHeightNear(x, z, 400) + 120);
  }

  /** Coloca el avión y reinicia su estado de vuelo */
  spawnAt(pos: THREE.Vector3, yaw: number) {
    this.flight.reset(pos.x, pos.y, pos.z, yaw);
    this.prevPos.copy(this.flight.pos);
    this.hp = 100;
    this.alive = true;
    this.invuln = 2;
    this.jet.group.visible = true;
    this.contrails.reset();
    this.rig.snap();
  }

  // ================================================================ Sesiones
  private resetSession() {
    this.rings.enabled = true;
    this.ringCount = 0;
    this.kills = 0;
    this.guns.refill();
    this.race?.dispose();
    this.race = null;
    this.paused = false;
    this.hud.setTimer(null);
    this.hud.countdown(null);
    this.flight.frozen = false;
  }

  /** Vuelo libre en solitario */
  startFree() {
    this.audio.init();
    this.mode = 'free';
    this.resetSession();
    this.spawnAt(new THREE.Vector3(0, this.safeAltitude(0, 0), 0), Math.random() * Math.PI * 2);
    this.rings.respawnAll(this.chunks.loaded());
    this.drones.setActive(true);
    this.setScreen('playing');
    this.hud.toast('¡Despegue!');
  }

  /** Carrera contrarreloj (solo o multijugador) */
  startRace(def: CourseDef, gridIndex = 0, gridSize = 1, goAt?: number) {
    this.audio.init();
    this.mode = 'race';
    this.courseDef = def;
    this.resetSession();
    this.drones.setActive(false);
    this.rings.enabled = false;
    this.rings.respawnAll([]);
    const course = buildCourse(this.gen, def);
    this.race = new Race(this.scene, course);
    // Parrilla de salida
    const right = new THREE.Vector3(Math.cos(course.start.yaw), 0, -Math.sin(course.start.yaw));
    const pos = course.start.pos.clone().addScaledVector(right, (gridIndex - (gridSize - 1) / 2) * 32);
    this.spawnAt(pos, course.start.yaw);
    this.chunks.warmup(pos.x, pos.z, 16);
    this.flight.frozen = true;
    this.goAt = goAt ?? this.now() + 3500;
    this.lastCountdown = -1;
    this.setScreen('playing');
  }

  /** Vuelo libre multijugador */
  startCoopFree(gridIndex: number) {
    this.audio.init();
    this.mode = 'free';
    this.resetSession();
    this.drones.setActive(false);
    const yaw = 0;
    const pos = new THREE.Vector3(gridIndex * 40 - 60, this.safeAltitude(0, 0), 0);
    this.spawnAt(pos, yaw);
    this.rings.respawnAll(this.chunks.loaded());
    for (const id of this.room?.rings ?? []) this.rings.takenByOther(id);
    this.setScreen('playing');
    this.hud.toast('¡Vuelo en equipo!');
  }

  private now() {
    return this.room ? this.room.serverNow() : performance.now();
  }

  // ================================================================ Pantallas
  private setScreen(s: Screen) {
    this.screen = s;
    show('menu', s === 'menu');
    show('crash', false);
    show('race-results', s === 'results');
    show('lobby', s === 'lobby');
    show('pause', false);
    this.paused = false;
    this.hud.show(s === 'playing' || s === 'crashed' || s === 'results');
    if (s !== 'playing') this.input.reset();
    if (s === 'menu' || s === 'lobby') {
      this.rig.mode = 'chase';
      this.hud.setCockpit(false);
      this.hud.setTimer(null);
      this.hud.countdown(null);
      this.drones.setActive(false);
      this.race?.dispose();
      this.race = null;
      this.flight.frozen = false;
      if (!this.rings.enabled) {
        this.rings.enabled = true;
        this.rings.respawnAll(this.chunks.loaded());
      }
      if (!this.alive) this.spawnAt(new THREE.Vector3(0, this.safeAltitude(0, 0), 0), Math.random() * 6);
    }
    $('btn-stage').classList.toggle('hidden', this.mode === 'race' || !!this.room);
    this.updateViewButton();
    this.layoutControls();
  }

  setPaused(p: boolean) {
    if (this.screen !== 'playing') return;
    this.paused = p;
    show('pause', p);
    $('btn-leave-room').classList.toggle('hidden', !this.room);
    $('btn-room-lobby').classList.toggle('hidden', !this.room?.isHost);
    $('btn-pause-menu').classList.toggle('hidden', !!this.room);
    $('btn-restart').classList.toggle('hidden', !!this.room);
    this.input.reset();
    if (!p) this.timer.update();
  }

  cycleCamera() {
    if (this.screen !== 'playing' || this.paused) return;
    const i = CAMERA_MODES.indexOf(this.rig.mode);
    this.rig.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    this.rig.snap();
    this.hud.setCockpit(this.rig.mode === 'cockpit');
    this.hud.toast(`Vista: ${CAMERA_LABELS[this.rig.mode]}`);
    this.updateViewButton();
    this.layoutControls();
  }

  private updateViewButton() {
    $('btn-view').textContent = `Vista: ${CAMERA_LABELS[this.rig.mode]}`;
  }

  private layoutControls() {
    applyControlLayout(this.settings.controls, this.rig.mode === 'cockpit' ? this.hud.panelH || 170 : 0);
  }

  // ================================================================ Daños
  private damage(amount: number) {
    if (!this.alive || this.invuln > 0) return;
    this.hp -= amount;
    this.hud.damageFlash();
    if (this.hp <= 0) this.destroy();
  }

  /** Explosión del avión propio */
  private destroy(killer?: string) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.audio.explosion();
    this.audio.engine(0, 0, false);
    const vel = this.flight.forward().multiplyScalar(this.flight.speed);
    this.fx.explosion(this.flight.pos, vel, 1.2);
    this.jet.group.visible = false;
    this.rig.addShake(6);
    this.hud.warning(false);
    if (this.rig.mode === 'cockpit') {
      this.rig.mode = 'chase';
      this.hud.setCockpit(false);
      this.rig.snap();
      this.layoutControls();
    }
    if (killer && this.room) this.room.sendEvent(killer, 'kill', 1);
    this.sendNetState(true);

    if (this.mode === 'free' && !this.room) {
      this.screen = 'crashed';
      this.crashTimer = 0;
      this.fillCrashPanel();
    } else {
      this.respawnTimer = RESPAWN_TIME;
      this.hud.toast(this.mode === 'race' ? 'Reapareces en el último hito…' : 'Reapareciendo…', 2000);
    }
  }

  private respawn() {
    if (this.race) {
      const p = this.race.respawnPoint();
      this.spawnAt(p.pos, p.yaw);
    } else {
      const p = this.flight.pos.clone();
      p.y = Math.max(p.y + 150, this.safeAltitude(p.x, p.z));
      this.spawnAt(p, this.flight.yaw);
    }
    this.guns.reload(MAX_AMMO / 2);
  }

  /** Choque contra el escenario: leve (rozadura) o fuerte (explosión) */
  private impact(normal: THREE.Vector3, box: Box | null) {
    const f = this.flight;
    const v = f.forward().multiplyScalar(f.speed);
    const into = -v.dot(normal);
    if (into > HARD_IMPACT || this.hp - (8 + into * 0.6) <= 0) {
      this.destroy();
      return;
    }
    // Rozadura: rebote, chispas, daño y pérdida de velocidad
    this.hp -= 8 + into * 0.6;
    v.addScaledVector(normal, Math.max(into, 8) * 1.6);
    v.multiplyScalar(0.72);
    f.setVelocity(v);
    if (box && normal.y < 0.5) {
      if (normal.x < -0.5) f.pos.x = box.x0 - 4;
      else if (normal.x > 0.5) f.pos.x = box.x1 + 4;
      else if (normal.z < -0.5) f.pos.z = box.z0 - 4;
      else if (normal.z > 0.5) f.pos.z = box.z1 + 4;
    } else {
      f.pos.y = (box ? box.h : 0) + 4;
    }
    f.stun = 0.9;
    this.fx.scrape(f.pos, normal);
    this.audio.scrape();
    this.rig.addShake(3);
    this.hud.damageFlash();
    this.hud.toast('¡Rozadura!', 900);
  }

  /** Devuelve true si ha habido colisión (y la gestiona) */
  private checkCollision(): boolean {
    const f = this.flight;
    const fwd = f.forward(new THREE.Vector3());
    const right = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
    const tilt = Math.sin(f.roll) * 6;
    const pts = [
      f.pos.clone(),
      f.pos.clone().addScaledVector(fwd, 9),
      f.pos.clone().addScaledVector(right, 6).setY(f.pos.y - tilt),
      f.pos.clone().addScaledVector(right, -6).setY(f.pos.y + tilt),
    ];
    for (const p of pts) {
      if (p.y < 1.2) {
        this.impact(new THREE.Vector3(0, 1, 0), null);
        return true;
      }
      const box = this.gen.boxAt(p.x, p.z);
      if (box && p.y < box.h + 0.5) {
        const prev = this.prevPos;
        const n = new THREE.Vector3();
        if (prev.y >= box.h - 1) n.set(0, 1, 0);
        else if (prev.x < box.x0) n.set(-1, 0, 0);
        else if (prev.x > box.x1) n.set(1, 0, 0);
        else if (prev.z < box.z0) n.set(0, 0, -1);
        else if (prev.z > box.z1) n.set(0, 0, 1);
        else n.set(0, 1, 0);
        this.impact(n, box);
        return true;
      }
    }
    return false;
  }

  /** Choques entre aviones (cada cliente gestiona su propio avión) */
  private checkPlayerCollisions() {
    if (!this.room || !this.alive || this.bumpCooldown > 0 || this.invuln > 0) return;
    const myVel = this.flight.forward().multiplyScalar(this.flight.speed);
    for (const t of this.remotes.targets()) {
      if (!t.alive) continue;
      const d = this.flight.pos.distanceTo(t.pos);
      if (d > 15) continue;
      const n = new THREE.Vector3().subVectors(this.flight.pos, t.pos).normalize();
      const closing = -new THREE.Vector3().subVectors(myVel, t.vel).dot(n);
      if (closing > HARD_BUMP) {
        this.room.sendEvent(t.id, 'crash', closing);
        this.destroy();
      } else {
        this.room.sendEvent(t.id, 'bump', Math.max(0, closing));
        this.bump(n);
      }
      return;
    }
  }

  private bump(n: THREE.Vector3) {
    if (this.bumpCooldown > 0 || !this.alive) return;
    this.bumpCooldown = 1.2;
    const f = this.flight;
    const v = f.forward().multiplyScalar(f.speed).addScaledVector(n, 40).multiplyScalar(0.75);
    f.setVelocity(v);
    f.pos.addScaledVector(n, 6);
    f.stun = 1.3;
    this.fx.scrape(f.pos, n);
    this.audio.scrape();
    this.rig.addShake(3);
    this.hud.toast('¡Choque!', 900);
    this.damage(10);
  }

  private onNetEvent(e: NetEvent) {
    const from = this.room?.players.get(e.from)?.name ?? 'Alguien';
    const other = this.remotes.get(e.from)?.target;
    switch (e.type) {
      case 'hit':
        if (!this.alive || this.invuln > 0) return;
        this.audio.damaged();
        this.fx.hit(this.flight.pos, this.flight.forward().multiplyScalar(this.flight.speed));
        this.hp -= e.v;
        this.hud.damageFlash();
        if (this.hp <= 0) {
          this.destroy(e.from);
          this.hud.toast(`Te ha derribado ${from}`, 2200);
        }
        break;
      case 'bump':
        if (other) this.bump(new THREE.Vector3().subVectors(this.flight.pos, other.pos).normalize());
        break;
      case 'crash':
        if (this.alive) {
          this.destroy();
          this.hud.toast(`Colisión con ${from}`, 2000);
        }
        break;
      case 'kill':
        this.kills++;
        this.audio.ring();
        this.hud.hitMarker(true);
        this.hud.toast(`¡Has derribado a ${from}!`, 2000);
        break;
    }
  }

  private sendNetState(force = false) {
    if (!this.room) return;
    if (!force && this.netTimer > 0) return;
    this.netTimer = 1 / NET_RATE;
    const f = this.flight;
    const playing = this.screen === 'playing' || this.screen === 'results';
    this.room.sendState({
      x: f.pos.x,
      y: f.pos.y,
      z: f.pos.z,
      yaw: f.yaw,
      pitch: f.pitch,
      roll: f.roll,
      s: f.speed,
      f: this.lastInput.fire && this.alive && this.guns.ammo > 0 ? 1 : 0,
      hp: this.hp,
      a: this.alive && playing ? 1 : 0,
    });
  }

  // ================================================================ Bucle
  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.time += dt;
    this.netTimer -= dt;

    if (this.screen === 'playing' && !(this.paused && !this.room)) this.updatePlaying(dt);
    else if (this.screen === 'menu' || this.screen === 'lobby') this.updateMenu(dt);
    else if (this.screen === 'crashed') {
      this.crashTimer += dt;
      if (this.crashTimer > 1.4) show('crash', true);
    } else if (this.screen === 'results') {
      this.updateAutopilot(dt);
    }

    if (this.room) {
      this.remotes.update(dt, this.room.serverNow(), this.time, this.guns, this.fx);
      if (this.screen === 'lobby' || this.screen === 'results') this.sendNetState();
    }

    const frozen = this.paused && !this.room;
    if (!frozen) {
      this.fx.update(dt);
      this.drones.update(dt, this.flight.pos, this.flight.forward(), this.time);
      if (this.screen !== 'playing') {
        this.guns.update(dt, this.gunContext(false));
      }
      const speedFactor = THREE.MathUtils.clamp((this.flight.speedKmh - CRUISE_KMH) / (BOOST_KMH - CRUISE_KMH), 0, 1);
      this.rig.update(this.alive ? dt : dt * 0.15, this.flight, this.alive ? speedFactor : 0);
    }
    this.jet.update(this.flight, this.time);
    this.jet.group.visible = this.alive && this.rig.mode !== 'cockpit';
    this.contrails.setVisible(this.rig.mode !== 'cockpit');
    if (this.alive && !frozen) this.fx.damageTrail(this.flight.pos, this.hp / 100, dt);

    this.chunks.update(this.flight.pos.x, this.flight.pos.z);
    this.far.update(this.flight.pos);
    this.sky.update(this.camera);
    this.sun.position.copy(this.flight.pos).add(new THREE.Vector3(...this.stage.sun.dir).multiplyScalar(100));
    this.sun.target.position.copy(this.flight.pos);
    this.sun.target.updateMatrixWorld();
    show('loading', this.chunks.loadingCount >= 30 && this.screen === 'playing');

    if (this.screen === 'playing' || this.screen === 'crashed' || this.screen === 'results') this.updateHud();

    if (this.settings.effects === 'high') this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  private gunContext(firing: boolean) {
    const targets: Target[] = this.room ? this.remotes.targets() : this.drones.active ? this.drones.list : [];
    return {
      firing,
      pos: this.flight.pos,
      quat: this.jet.group.quaternion,
      vel: this.flight.forward().multiplyScalar(this.flight.speed),
      targets,
      aimAssist: this.settings.aimAssist,
      onHit: (t: Target, _p: THREE.Vector3, dmg: number) => this.onBulletHit(t, dmg),
      onShot: () => {
        if (this.shotSoundTimer <= 0) {
          this.audio.shot();
          this.shotSoundTimer = 0.07;
        }
      },
      onEmpty: () => {
        this.audio.empty();
        this.hud.toast('Sin munición: pasa por un hito o anillo', 1600);
      },
    };
  }

  private onBulletHit(t: Target, dmg: number) {
    this.audio.hitMarker();
    if (this.room) {
      this.room.sendEvent(t.id, 'hit', dmg);
      this.hud.hitMarker(false);
      return;
    }
    const destroyed = this.drones.damage(t.id, dmg);
    this.hud.hitMarker(destroyed);
    if (destroyed) {
      this.kills++;
      this.fx.explosion(t.pos, t.vel, 0.8);
      this.audio.explosion();
      this.guns.reload(15);
      this.hud.toast(`¡Dron derribado! · ${this.kills}`);
    }
  }

  private updatePlaying(dt: number) {
    const f = this.flight;
    this.invuln = Math.max(0, this.invuln - dt);
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    this.shotSoundTimer -= dt;
    const input = this.paused ? { x: 0, y: 0, boost: false, climb: false, fire: false } : this.input.read();
    this.lastInput = input;

    // Cuenta atrás de carrera
    if (this.race && !this.race.started) {
      const left = (this.goAt - this.now()) / 1000;
      if (left > 0) {
        const n = Math.ceil(left);
        if (n !== this.lastCountdown && n <= 3) {
          this.lastCountdown = n;
          this.hud.countdown(String(n));
          this.audio.countdown(false);
        }
        f.frozen = true;
      } else {
        f.frozen = false;
        this.race.start();
        this.race.elapsed = -left;
        this.hud.countdown('¡YA!');
        this.audio.countdown(true);
        setTimeout(() => this.hud.countdown(null), 900);
      }
    }

    if (!this.alive) {
      if (this.screen === 'playing' && (this.mode === 'race' || this.room)) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) this.respawn();
      }
      this.race?.update(dt, f.pos, f.pos, this.time);
      this.guns.update(dt, this.gunContext(false));
      this.sendNetState();
      return;
    }

    // Física con subpasos para no atravesar edificios
    const steps = Math.max(1, Math.ceil((f.speed * dt) / 4));
    const sdt = dt / steps;
    for (let i = 0; i < steps && this.alive; i++) {
      this.prevPos.copy(f.pos);
      f.update(sdt, input);
      if (this.race) {
        for (const ev of this.race.update(sdt, this.prevPos, f.pos, this.time)) this.onRaceEvent(ev);
      } else {
        const got = this.rings.update(sdt, this.prevPos, f.pos);
        if (got) this.onRingsCollected(got);
      }
      if (!f.frozen && this.checkCollision()) break;
    }
    if (!this.alive) return;

    this.checkPlayerCollisions();
    this.guns.update(dt, this.gunContext(!!input.fire && !f.frozen && !this.paused));

    // Aviso de proximidad al suelo
    const clearance = f.pos.y - this.gen.maxHeightNear(f.pos.x, f.pos.z, 60);
    const warn = clearance < 90 && f.pitch < -0.12;
    this.hud.warning(warn);
    if (warn) {
      this.warnTimer -= dt;
      if (this.warnTimer <= 0) {
        this.audio.warning();
        this.warnTimer = 0.45;
      }
    }

    this.audio.engine(THREE.MathUtils.clamp(f.speedKmh / BOOST_KMH, 0, 1), f.thrust, !f.frozen);
    const q = this.jet.group.quaternion;
    const tips = this.jet.wingTips.map((t) => t.clone().applyQuaternion(q).add(this.jet.group.position));
    this.jet.update(f, this.time);
    if (!f.frozen) this.contrails.update(tips);
    // Parpadeo durante la invulnerabilidad
    if (this.invuln > 0) this.jet.group.visible = Math.floor(this.time * 12) % 2 === 0;
    this.sendNetState();
  }

  private onRingsCollected(got: number) {
    this.audio.ring();
    if (this.room) {
      for (const id of this.rings.lastCollected) this.room.claimRing(id);
    } else {
      this.ringCount += got;
    }
    const added = this.guns.reload(40);
    this.hud.toast(added > 0 ? `+${got} anillo · +${added} balas` : `+${got} anillo`);
  }

  private onRaceEvent(ev: RaceEvent) {
    switch (ev.type) {
      case 'gate': {
        const added = this.guns.reload(MAX_AMMO / 2);
        const better = ev.delta !== null && ev.delta < 0;
        this.audio.gate(better);
        const delta = ev.delta === null ? '' : `<b>${formatDelta(ev.delta)}</b>`;
        this.hud.split(
          `Hito ${ev.index}/${ev.total} · ${formatTime(ev.split)} ${delta}${added > 0 ? `<small>+${added} balas</small>` : ''}`,
          ev.delta === null ? 'neutral' : better ? 'good' : 'bad',
        );
        if (added > 0) this.audio.reload();
        break;
      }
      case 'bonus':
        if (ev.kind === 'time') {
          this.audio.ring();
          this.hud.toast('−1 s', 900);
          this.fx.sparks(ev.pos, null, 20, 40);
        } else {
          this.audio.boostRing();
          this.flight.burst = 2.2;
          this.hud.toast('¡Acelerón!', 900);
          this.fx.sparks(ev.pos, null, 20, 40);
        }
        break;
      case 'finish':
        this.audio.gate(ev.best);
        this.onRaceFinished(ev.time, ev.splits, ev.best);
        break;
    }
  }

  private updateMenu(dt: number) {
    this.updateAutopilot(dt);
    this.audio.engine(0, 0, false);
  }

  /** Vuelo automático de fondo (menú, sala, resultados) */
  private updateAutopilot(dt: number) {
    if (!this.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.spawnAt(new THREE.Vector3(this.flight.pos.x, this.safeAltitude(this.flight.pos.x, this.flight.pos.z), this.flight.pos.z), this.flight.yaw);
      return;
    }
    this.flight.frozen = false;
    const cruiseAlt = Math.max(420, this.gen.maxHeightNear(this.flight.pos.x, this.flight.pos.z, 300) + 120);
    const input = { x: 0.18, y: THREE.MathUtils.clamp((cruiseAlt - this.flight.pos.y) / 200, -1, 1), boost: false, climb: false };
    this.prevPos.copy(this.flight.pos);
    this.flight.update(dt, input);
    if (this.race) this.race.update(dt, this.flight.pos, this.flight.pos, this.time);
    const h = this.gen.heightAt(this.flight.pos.x, this.flight.pos.z);
    if (this.flight.pos.y < h + 5) this.flight.pos.y = h + 60;
    const q = this.jet.group.quaternion;
    const tips = this.jet.wingTips.map((t) => t.clone().applyQuaternion(q).add(this.jet.group.position));
    this.contrails.update(tips);
  }

  private updateHud() {
    const f = this.flight;
    let scoreLabel = 'Anillos';
    let scoreValue = String(this.ringCount);
    let navTarget: THREE.Vector3 | null = null;
    let navLabel = '';
    let navGate = false;
    if (this.race) {
      scoreLabel = 'Hito';
      scoreValue = `${Math.min(this.race.passed + 1, this.race.totalCheckpoints)}/${this.race.totalCheckpoints}`;
      if (!this.race.finished) {
        navTarget = this.race.nextGatePos;
        navGate = true;
        navLabel = this.race.nextGate === 0 ? 'META' : `HITO ${this.race.nextGate}`;
      }
      this.hud.setTimer(formatTime(this.race.started ? this.race.time : 0));
    } else {
      if (this.room) {
        scoreLabel = 'Anillos equipo';
        scoreValue = String(this.room.rings.size);
      } else if (this.kills > 0) {
        scoreLabel = 'Anillos · Drones';
        scoreValue = `${this.ringCount} · ${this.kills}`;
      }
      if (this.screen === 'playing' && this.alive) navTarget = this.rings.nearest(f.pos);
    }
    const lock = this.alive && this.screen === 'playing' ? this.guns.lock : null;
    this.hud.update({
      flight: f,
      scoreLabel,
      scoreValue,
      groundClearance: f.pos.y - this.gen.heightAt(f.pos.x, f.pos.z),
      navTarget,
      navLabel,
      navGate,
      camera: this.camera,
      cockpit: this.rig.mode === 'cockpit' && this.alive,
      hp01: this.hp / 100,
      ammo: this.guns.ammo,
      maxAmmo: MAX_AMMO,
      lockPos: lock?.pos ?? null,
      lockStrength: this.guns.lockStrength,
      lockName: lock?.name,
    });
    if (this.rig.mode === 'cockpit') this.layoutControls();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.layoutControls();
  }

  // ================================================================ Resultados
  private fillCrashPanel() {
    const rings = this.ringCount;
    const key = `best.${this.stage.id}`;
    const prevBest = Number(store.get(key) ?? 0);
    const best = Math.max(prevBest, rings);
    store.set(key, String(best));
    $('crash-rings').textContent = String(rings);
    $('crash-kills').textContent = String(this.kills);
    $('crash-best').textContent = String(best);
    const msg = $('crash-msg');
    msg.textContent = rings > prevBest && rings > 0 ? '¡Nuevo récord personal!' : '';
    if (firebase.enabled && rings > 0) {
      firebase
        .submit(this.stage.id, this.pilotName(), rings, this.flight.maxSpeedKmh)
        .then((saved) => {
          if (saved) msg.textContent = '¡Nuevo récord guardado en la clasificación!';
        })
        .catch(() => undefined);
    }
  }

  private onRaceFinished(time: number, splits: number[], best: boolean) {
    this.screen = 'results';
    this.hud.setTimer(formatTime(time));
    this.hud.split(`META · ${formatTime(time)}`, best ? 'good' : 'neutral');
    $('rr-title').textContent = best ? '¡Nuevo récord!' : '¡Carrera completada!';
    $('rr-time').textContent = formatTime(time);
    $('rr-course').textContent = `${this.courseDef.name} · ${this.stage.name}`;
    const list = $('rr-splits');
    list.replaceChildren(
      ...splits.map((s, i) => {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = i === splits.length - 1 ? 'Meta' : `Hito ${i + 1}`;
        const t = document.createElement('b');
        t.textContent = formatTime(s);
        li.append(label, t);
        return li;
      }),
    );
    $('rr-msg').textContent = '';
    if (this.room) {
      void this.room.submitResult(time);
      this.renderRoomResults();
    } else if (firebase.enabled) {
      firebase
        .submitTime(courseId(this.stage.id, this.courseDef), this.pilotName(), time)
        .then((saved) => {
          if (saved) $('rr-msg').textContent = 'Tiempo guardado en la clasificación online';
        })
        .catch(() => undefined);
    }
    show('rr-room', !!this.room);
    show('rr-solo-actions', !this.room);
    this.updateRoomResultButtons();
    setTimeout(() => {
      if (this.screen === 'results') this.setScreen('results');
    }, 1500);
  }

  private renderRoomResults() {
    if (!this.room) return;
    const round = this.room.meta?.round ?? 0;
    const rows = [...this.room.results.entries()].filter(([, r]) => r.round === round).sort((a, b) => a[1].time - b[1].time);
    const waiting = [...this.room.players.keys()].filter((uid) => !rows.some(([u]) => u === uid));
    const list = $('rr-room-list');
    list.replaceChildren(
      ...rows.map(([uid, r], i) => {
        const li = document.createElement('li');
        if (uid === this.room!.uid) li.classList.add('me');
        li.innerHTML = `<span class="pos">${i + 1}</span><span></span><b>${formatTime(r.time)}</b>`;
        (li.children[1] as HTMLElement).textContent = r.name;
        return li;
      }),
      ...waiting.map((uid) => {
        const li = document.createElement('li');
        li.className = 'waiting';
        li.innerHTML = '<span class="pos">·</span><span></span><b>en vuelo…</b>';
        (li.children[1] as HTMLElement).textContent = this.room!.players.get(uid)?.name ?? '';
        return li;
      }),
    );
  }

  private updateRoomResultButtons() {
    const host = !!this.room?.isHost;
    show('btn-rr-again', host);
    show('btn-rr-lobby', host);
    show('rr-wait-host', !!this.room && !host);
  }

  private pilotName() {
    return (this.settings.name || 'Piloto').slice(0, 16);
  }

  // ================================================================ Multijugador
  private async createRoom() {
    const mode = ($<HTMLSelectElement>('mp-mode').value as RoomMode) || 'free';
    const course = $<HTMLSelectElement>('mp-course').value || COURSES[0].id;
    this.setMpBusy(true);
    try {
      const room = await Room.create(this.pilotName(), mode, this.stage.id, course);
      this.attachRoom(room);
    } catch (e) {
      this.mpError(e);
    } finally {
      this.setMpBusy(false);
    }
  }

  private async joinRoom() {
    const code = normalizeCode($<HTMLInputElement>('mp-code').value);
    this.setMpBusy(true);
    try {
      const room = await Room.join(code, this.pilotName());
      this.attachRoom(room);
    } catch (e) {
      this.mpError(e);
    } finally {
      this.setMpBusy(false);
    }
  }

  private setMpBusy(b: boolean) {
    for (const id of ['btn-mp-create', 'btn-mp-join']) ($(id) as HTMLButtonElement).disabled = b;
    if (b) $('mp-error').textContent = 'Conectando…';
  }

  private mpError(e: unknown) {
    console.warn(e);
    $('mp-error').textContent = e instanceof NetError ? e.message : 'No se pudo conectar. Revisa tu conexión e inténtalo otra vez.';
  }

  private attachRoom(room: Room) {
    this.room = room;
    $('mp-error').textContent = '';
    show('mp-panel', false);
    this.myRound = room.meta?.round ?? 0;
    room.onPlayers = () => {
      this.remotes.sync(room.players, room.uid);
      this.renderLobby();
      if (this.screen === 'results') this.renderRoomResults();
    };
    room.onMeta = (m) => this.onRoomMeta(m);
    room.onState = (uid, s) => this.remotes.state(uid, s);
    room.onEvent = (e) => this.onNetEvent(e);
    room.onResults = () => {
      if (this.screen === 'results') this.renderRoomResults();
    };
    room.onRing = (id, uid) => {
      if (uid !== room.uid) {
        this.rings.takenByOther(id);
        if (this.screen === 'playing') this.hud.toast(`${room.players.get(uid)?.name ?? 'Equipo'}: +1 anillo`, 900);
      }
    };
    room.onClosed = (reason) => {
      this.detachRoom();
      this.setScreen('menu');
      this.hud.toast(reason, 2500);
    };
    this.setScreen('lobby');
    this.renderLobby();
    // Entrar a una partida libre que ya está en marcha
    if (room.meta && room.meta.mode === 'free' && room.meta.state !== 'lobby') this.onRoomMeta(room.meta);
  }

  private detachRoom() {
    this.remotes.dispose();
    this.room = null;
  }

  private async leaveRoom() {
    const r = this.room;
    this.detachRoom();
    this.setScreen('menu');
    await r?.leave();
  }

  private onRoomMeta(m: RoomMeta) {
    const room = this.room;
    if (!room) return;
    if (m.stage !== this.stage.id) this.loadStage(getStage(m.stage));
    this.renderLobby();
    if (this.screen === 'results') this.updateRoomResultButtons();
    if (m.state === 'lobby') {
      if (this.screen !== 'lobby') this.setScreen('lobby');
      return;
    }
    const joined = this.screen === 'lobby' || this.screen === 'results' || this.screen === 'menu';
    if ((m.state === 'countdown' || m.state === 'running') && (m.round > this.myRound || (joined && m.mode === 'free'))) {
      this.myRound = m.round;
      const order = [...room.players.entries()].sort((a, b) => a[1].joinedAt - b[1].joinedAt).map(([k]) => k);
      const idx = Math.max(0, order.indexOf(room.uid));
      if (m.mode === 'race') {
        const def = COURSES.find((c) => c.id === m.course) ?? COURSES[0];
        this.startRace(def, idx, Math.max(order.length, 1), m.startAt);
      } else {
        this.startCoopFree(idx);
      }
    }
  }

  private renderLobby() {
    const room = this.room;
    if (!room || !room.meta) return;
    const m = room.meta;
    $('lobby-code').textContent = formatCode(room.code);
    const list = $('lobby-players');
    list.replaceChildren(
      ...[...room.players.entries()]
        .sort((a, b) => a[1].joinedAt - b[1].joinedAt)
        .map(([uid, p]) => {
          const li = document.createElement('li');
          const dot = document.createElement('span');
          dot.className = 'dot';
          dot.style.background = `#${p.color.toString(16).padStart(6, '0')}`;
          const name = document.createElement('span');
          name.textContent = p.name + (uid === room.uid ? ' (tú)' : '');
          li.append(dot, name);
          if (uid === m.host) {
            const b = document.createElement('small');
            b.textContent = 'Anfitrión';
            li.append(b);
          }
          return li;
        }),
    );
    $('lobby-count').textContent = `${room.players.size}/${MAX_PLAYERS}`;
    const host = room.isHost;
    for (const id of ['lobby-mode', 'lobby-stage', 'lobby-course']) ($(id) as HTMLSelectElement).disabled = !host;
    $<HTMLSelectElement>('lobby-mode').value = m.mode;
    $<HTMLSelectElement>('lobby-stage').value = m.stage;
    $<HTMLSelectElement>('lobby-course').value = m.course;
    show('lobby-course-field', m.mode === 'race');
    show('btn-lobby-start', host);
    show('lobby-wait', !host);
    $('btn-lobby-start').textContent = m.mode === 'race' ? 'Empezar carrera' : 'Empezar vuelo';
    if (m.state !== 'lobby' && m.mode === 'free') $('lobby-wait').textContent = 'Partida en curso…';
    else $('lobby-wait').textContent = 'Esperando a que el anfitrión empiece…';
  }

  // ================================================================ UI
  private applySettings() {
    const s = this.settings;
    this.input.invertY = s.invertY;
    this.input.sensitivity = s.sensitivity;
    this.audio.setMuted(s.muted);
    this.audio.muted = s.muted;
    if (this.fx) this.fx.high = s.effects === 'high';
    this.layoutControls();
  }

  private persist() {
    saveSettings(this.settings);
    this.applySettings();
  }

  private setupUi() {
    const name = $<HTMLInputElement>('pilot-name');
    name.value = this.settings.name;
    name.addEventListener('change', () => {
      this.settings.name = name.value.trim().slice(0, 16);
      this.persist();
    });

    this.buildStageList($('stage-list'), (s) => {
      if (s.id !== this.stage.id) this.loadStage(s);
    });
    this.buildStageList($('stage-list-2'), (s) => {
      show('stage-picker', false);
      if (s.id !== this.stage.id) this.loadStage(s);
      this.startFree();
      this.hud.toast(s.name);
    });

    // Modos
    $('btn-start').addEventListener('click', () => this.startFree());
    $('btn-race').addEventListener('click', () => this.openCoursePicker());
    $('btn-mp').addEventListener('click', () => {
      show('mp-panel', true);
      $('mp-error').textContent = firebase.multiplayer
        ? ''
        : 'El multijugador necesita Firebase con Realtime Database (ver README). En esta versión de prueba no está disponible.';
    });

    // Juego
    $('btn-view').addEventListener('click', () => this.cycleCamera());
    $('btn-pause').addEventListener('click', () => this.setPaused(true));
    $('btn-resume').addEventListener('click', () => this.setPaused(false));
    $('btn-pause-menu').addEventListener('click', () => this.setScreen('menu'));
    $('btn-restart').addEventListener('click', () => {
      if (this.mode === 'race') this.startRace(this.courseDef);
      else this.startFree();
    });
    $('btn-leave-room').addEventListener('click', () => void this.leaveRoom());
    $('btn-room-lobby').addEventListener('click', () => void this.room?.backToLobby());
    $('btn-pause-settings').addEventListener('click', () => this.openSettings());
    $('btn-retry').addEventListener('click', () => this.startFree());
    $('btn-crash-menu').addEventListener('click', () => this.setScreen('menu'));
    $('btn-stage').addEventListener('click', () => {
      this.setPaused(true);
      show('pause', false);
      show('stage-picker', true);
    });
    $('btn-board').addEventListener('click', () => this.openBoard(this.stage.id));

    // Resultados de carrera
    $('btn-rr-retry').addEventListener('click', () => this.startRace(this.courseDef));
    $('btn-rr-menu').addEventListener('click', () => this.setScreen('menu'));
    $('btn-rr-again').addEventListener('click', () => void this.room?.startRound());
    $('btn-rr-lobby').addEventListener('click', () => void this.room?.backToLobby());
    $('btn-rr-leave').addEventListener('click', () => void this.leaveRoom());

    // Multijugador
    const mpCourse = $<HTMLSelectElement>('mp-course');
    const lobbyCourse = $<HTMLSelectElement>('lobby-course');
    for (const sel of [mpCourse, lobbyCourse]) {
      for (const c of COURSES) sel.append(new Option(c.name, c.id));
    }
    const lobbyStage = $<HTMLSelectElement>('lobby-stage');
    for (const s of STAGES) lobbyStage.append(new Option(s.name, s.id));
    $<HTMLSelectElement>('mp-mode').addEventListener('change', (e) => show('mp-course-field', (e.target as HTMLSelectElement).value === 'race'));
    $('btn-mp-create').addEventListener('click', () => void this.createRoom());
    $('btn-mp-join').addEventListener('click', () => void this.joinRoom());
    $<HTMLInputElement>('mp-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.joinRoom();
    });
    $('btn-lobby-leave').addEventListener('click', () => void this.leaveRoom());
    $('btn-lobby-start').addEventListener('click', () => void this.room?.startRound());
    $('lobby-mode').addEventListener('change', (e) => void this.room?.setMeta({ mode: (e.target as HTMLSelectElement).value as RoomMode }));
    lobbyStage.addEventListener('change', (e) => void this.room?.setMeta({ stage: (e.target as HTMLSelectElement).value as StageId }));
    lobbyCourse.addEventListener('change', (e) => void this.room?.setMeta({ course: (e.target as HTMLSelectElement).value }));
    $('btn-copy-code').addEventListener('click', () => {
      const code = this.room ? formatCode(this.room.code) : '';
      const done = () => this.hud.toast('Código copiado', 1000);
      navigator.clipboard?.writeText(code).then(done, () => selectText($('lobby-code')));
    });

    // Ajustes
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('btn-customize').addEventListener('click', () => {
      show('settings', false);
      const wasMenu = !$('menu').classList.contains('hidden');
      show('menu', false);
      this.editor.open(
        this.settings.controls,
        (layout) => {
          this.settings.controls = layout;
          this.persist();
          this.hud.toast('Controles guardados', 1200);
        },
        () => {
          if (wasMenu && this.screen === 'menu') show('menu', true);
          show('settings', true);
        },
      );
    });
    const sens = $<HTMLInputElement>('set-sensitivity');
    sens.addEventListener('input', () => {
      this.settings.sensitivity = Number(sens.value) / 100;
      $('set-sensitivity-val').textContent = `${sens.value} %`;
      this.persist();
    });
    const toggles: [string, () => boolean, () => void][] = [
      ['set-invert', () => this.settings.invertY, () => (this.settings.invertY = !this.settings.invertY)],
      ['set-aim', () => this.settings.aimAssist, () => (this.settings.aimAssist = !this.settings.aimAssist)],
      ['set-sound', () => !this.settings.muted, () => (this.settings.muted = !this.settings.muted)],
      ['set-effects', () => this.settings.effects === 'high', () => (this.settings.effects = this.settings.effects === 'high' ? 'low' : 'high')],
    ];
    for (const [id, get, flip] of toggles) {
      const el = $(id);
      el.addEventListener('click', () => {
        flip();
        this.persist();
        this.renderSettings();
      });
      void get;
    }

    document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) =>
      b.addEventListener('click', () => {
        const ov = b.closest('.overlay')!;
        ov.classList.add('hidden');
        if (this.screen === 'playing' && ov.id !== 'pause' && this.paused) show('pause', true);
      }),
    );

    const fb = $('fb-status');
    if (firebase.enabled) {
      fb.textContent = 'Conectando con Firebase…';
      firebase
        .user()
        .then((u) => (fb.textContent = u ? 'Clasificación online activa' : 'Sin conexión con Firebase'))
        .catch(() => (fb.textContent = 'Sin conexión con Firebase'));
    } else {
      fb.textContent = 'Modo local: configura Firebase (.env.local) para la clasificación y el multijugador';
    }
  }

  private openSettings() {
    this.renderSettings();
    show('settings', true);
    show('pause', false);
  }

  private renderSettings() {
    const s = this.settings;
    const set = (id: string, on: boolean, yes: string, no: string) => {
      const el = $(id);
      el.setAttribute('aria-pressed', String(on));
      el.querySelector('b')!.textContent = on ? yes : no;
    };
    set('set-invert', s.invertY, 'Invertido', 'Normal');
    set('set-aim', s.aimAssist, 'Activado', 'Desactivado');
    set('set-sound', !s.muted, 'Sí', 'No');
    set('set-effects', s.effects === 'high', 'Altos', 'Bajos');
    $<HTMLInputElement>('set-sensitivity').value = String(Math.round(s.sensitivity * 100));
    $('set-sensitivity-val').textContent = `${Math.round(s.sensitivity * 100)} %`;
  }

  private openCoursePicker() {
    const list = $('course-list');
    list.replaceChildren(
      ...COURSES.map((c) => {
        const b = document.createElement('button');
        b.className = 'stage-card';
        const best = loadBest(courseId(this.stage.id, c));
        const txt = document.createElement('span');
        const t = document.createElement('b');
        t.textContent = c.name;
        const d = document.createElement('small');
        d.textContent = `${c.description}${best ? ` · Tu récord ${formatTime(best.time)}` : ''}`;
        txt.append(t, d);
        b.append(txt);
        b.addEventListener('click', () => {
          show('course-picker', false);
          this.startRace(c);
        });
        return b;
      }),
    );
    $('course-stage').textContent = this.stage.name;
    show('course-picker', true);
  }

  private buildStageList(container: HTMLElement, onPick: (s: Stage) => void) {
    container.innerHTML = '';
    for (const s of STAGES) {
      const b = document.createElement('button');
      b.className = 'stage-card';
      b.dataset.stage = s.id;
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = `linear-gradient(180deg, ${s.sky.top} 0%, ${s.sky.horizon} 45%, ${s.palette.water[1]} 46%, ${s.palette.grass[0]} 75%, ${s.palette.buildings[0]} 100%)`;
      const txt = document.createElement('span');
      const t = document.createElement('b');
      t.textContent = s.name;
      const d = document.createElement('small');
      d.textContent = s.description;
      txt.append(t, d);
      b.append(sw, txt);
      b.addEventListener('click', () => onPick(s));
      container.append(b);
      this.stageListEls.push(b);
    }
  }

  private refreshStageLists() {
    for (const el of this.stageListEls) el.classList.toggle('active', el.dataset.stage === this.stage?.id);
  }

  private async openBoard(stageId: StageId) {
    show('board', true);
    const tabs = $('board-tabs');
    tabs.innerHTML = '';
    for (const s of STAGES) {
      const t = document.createElement('button');
      t.textContent = s.name;
      t.classList.toggle('active', s.id === stageId);
      t.addEventListener('click', () => this.openBoard(s.id));
      tabs.append(t);
    }
    const list = $('board-list');
    const li = (text: string, cls = 'empty') => {
      const el = document.createElement('li');
      el.className = cls;
      el.textContent = text;
      return el;
    };
    list.replaceChildren(li('Cargando…'));
    const localBest = Number(store.get(`best.${stageId}`) ?? 0);
    if (!firebase.enabled) {
      const rows: HTMLElement[] = [li('Tus récords en este dispositivo', 'heading'), li(`Vuelo libre: ${localBest} anillos`)];
      for (const c of COURSES) {
        const b = loadBest(courseId(stageId, c));
        rows.push(li(`${c.name}: ${b ? formatTime(b.time) : 'sin tiempo'}`));
      }
      rows.push(li('Configura Firebase para ver la clasificación global.'));
      list.replaceChildren(...rows);
      return;
    }
    try {
      const uid = await firebase.uid();
      const [rings, ...times] = await Promise.all([firebase.top(stageId), ...COURSES.map((c) => firebase.topTimes(courseId(stageId, c), 5))]);
      const rows: HTMLElement[] = [li('Vuelo libre · anillos', 'heading')];
      if (!rings.length) rows.push(li('Aún no hay puntuaciones.'));
      rings.forEach((r, i) => rows.push(this.boardRow(i + 1, r.name, `${r.maxSpeed} km/h`, `${r.rings} ◎`, r.uid === uid)));
      COURSES.forEach((c, k) => {
        rows.push(li(`${c.name} · tiempos`, 'heading'));
        if (!times[k].length) rows.push(li('Aún no hay tiempos.'));
        times[k].forEach((t, i) => rows.push(this.boardRow(i + 1, t.name, '', formatTime(t.timeMs / 1000), t.uid === uid)));
      });
      list.replaceChildren(...rows);
    } catch (e) {
      console.warn(e);
      list.replaceChildren(li('No se pudo cargar la clasificación.'));
    }
  }

  private boardRow(pos: number, name: string, extra: string, value: string, me: boolean) {
    const el = document.createElement('li');
    if (me) el.classList.add('me');
    const p = document.createElement('span');
    p.className = 'pos';
    p.textContent = String(pos);
    const n = document.createElement('span');
    n.textContent = name;
    const sp = document.createElement('span');
    sp.className = 'speed';
    sp.textContent = extra;
    const v = document.createElement('b');
    v.textContent = value;
    el.append(p, n, sp, v);
    return el;
  }
}

function selectText(el: HTMLElement) {
  const r = document.createRange();
  r.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

const game = new Game();
if (import.meta.env.DEV) (window as unknown as { __ff: Game }).__ff = game;
