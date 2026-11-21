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
import { GuideArrow, Radar, type RadarItem } from './nav';
import { Weather, WEATHER_LABELS } from './weather';
import { GhostPlayer, GhostRecorder, loadGhost, saveGhost } from './ghost';
import { PowerUps, POWER_INFO, type PowerKind } from './powerups';
import { Missiles, MISSILE_DAMAGE, type MissileOwner } from './missiles';
import { Progress, ACHIEVEMENTS, PLANES, PAINTS, UPGRADES, type PlaneId, type UpgradeId } from './progress';
import { dailyChallenge, dayLabel, msToNextDaily } from './daily';
import { Bot, makeBotSpecs, TEAM_COLORS, type Team } from './bots';
import { Battle, BATTLE_LABELS, DEFAULT_BATTLE, type BattleConfig, type BattleKind, type BattleResult } from './battle';
import { ReplayPlayer, ReplayRecorder } from './replay';
import { Pwa, isStandalone } from './pwa';
import { Haptic, setHaptics } from './haptics';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, v: boolean) => $(id).classList.toggle('hidden', !v);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

type Screen = 'menu' | 'playing' | 'crashed' | 'results' | 'lobby';
type Mode = 'free' | 'race' | 'battle';

const isTouch = matchMedia('(hover: none), (pointer: coarse)').matches;

/** Velocidad perpendicular (m/s) a partir de la cual un choque destruye el avión */
const HARD_IMPACT = 48;
/** Velocidad de aproximación (m/s) entre aviones a partir de la cual explotan */
const HARD_BUMP = 75;
const RESPAWN_TIME = 3;
const NET_RATE = 10;
const ROUTE_PENALTY = 3;
const ARENA = new THREE.Vector3(0, 0, 0);

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
  progress = new Progress();
  pwa = new Pwa();
  arrow: GuideArrow;
  radar = new Radar($<HTMLCanvasElement>('radar'));
  ghostRec = new GhostRecorder();
  recorder = new ReplayRecorder();

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
  missiles!: Missiles;
  powerups!: PowerUps;
  weather!: Weather;
  replayer!: ReplayPlayer;
  hemi!: THREE.HemisphereLight;
  sun!: THREE.DirectionalLight;
  remotes: RemotePlayers;

  screen: Screen = 'menu';
  mode: Mode = 'free';
  paused = false;
  room: Room | null = null;
  race: Race | null = null;
  ghost: GhostPlayer | null = null;
  battle: Battle | null = null;
  bots: Bot[] = [];
  courseDef: CourseDef = COURSES[0];
  isDaily = false;
  dailyKey = '';
  battleConfig: BattleConfig = { ...DEFAULT_BATTLE };

  // Estado del jugador
  hp = 100;
  maxHp = 100;
  alive = true;
  respawnTimer = 0;
  invuln = 0;
  bumpCooldown = 0;
  ringCount = 0;
  kills = 0;
  sessionCredits = 0;
  shield = 0;
  doubleDamage = 0;
  turbo = 0;
  /** Momento de salida (ms, en el reloj de la sala o local) */
  goAt = 0;
  myTarget: Target;
  private myRound = 0;
  private lastCountdown = -1;
  private replaying = false;
  private replayReturn: string | null = null;
  private routeBest = Infinity;
  private offRouteT = 0;
  private lowFlightT = 0;
  private remoteFlares = new Set<string>();
  private missileBeep = 0;

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
    this.arrow = new GuideArrow(this.scene);
    this.myTarget = { id: 'me', name: 'Tú', pos: this.flight.pos, vel: new THREE.Vector3(), radius: 9, alive: true };

    this.settings = loadSettings();
    this.input = new Input(
      $('joy-zone'),
      $('joy-base'),
      $('joy-knob'),
      $('btn-boost'),
      $('btn-climb'),
      $('btn-fire'),
      canvas,
      $('btn-missile'),
      $('btn-flare'),
    );
    this.applySettings();
    this.input.onCamera = () => this.cycleCamera();
    this.input.onPause = () => {
      if (this.replaying) this.endReplay();
      else if (this.screen === 'playing') this.setPaused(!this.paused);
    };
    this.input.onBoostStart = () => {
      if (this.screen === 'playing' && this.alive && !this.flight.frozen) this.hud.toast('¡Turbo!');
    };
    this.input.onMissile = () => this.fireMissile();
    this.input.onFlare = () => this.fireFlares();
    this.input.onResetRoute = () => this.resetToRoute();
    this.hud.onLock = () => this.audio.lockOn();

    this.progress.onUnlock = (a) => {
      this.sessionCredits += a.reward;
      this.hud.achievement(a.name, a.reward);
      this.audio.gate(true);
    };

    this.applyLoadout();
    this.loadStage(getStage(store.get('stage')));
    this.setupUi();
    this.setupPwa();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'playing' && !this.room) this.setPaused(true);
    });
    window.addEventListener('beforeunload', () => {
      void this.room?.leave();
    });
    this.handleLaunchParams();

    this.renderer.setAnimationLoop(() => this.frame());
  }

  get myId() {
    return this.room?.uid ?? 'me';
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
    this.powerups = new PowerUps(this.scene, this.gen);
    this.chunks.onChunkAdded = (cx, cz) => {
      this.rings.addChunk(cx, cz);
      this.powerups.addChunk(cx, cz);
      if (this.room) for (const id of this.room.rings) this.rings.takenByOther(id);
    };
    this.chunks.onChunkRemoved = (cx, cz) => {
      this.rings.removeChunk(cx, cz);
      this.powerups.removeChunk(cx, cz);
    };

    this.scene.background = new THREE.Color(stage.sky.horizon);
    const fog = new THREE.FogExp2(stage.sky.fog, stage.fogDensity);
    this.scene.fog = fog;
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
    this.missiles = new Missiles(this.scene, this.gen, this.fx);
    this.replayer = new ReplayPlayer(this.scene, this.camera, this.fx, this.guns);
    this.replayer.onEnd = () => this.endReplay();
    const skyU = (this.sky.mesh.material as THREE.ShaderMaterial).uniforms as unknown as {
      uTop: { value: THREE.Color };
      uHorizon: { value: THREE.Color };
    };
    this.weather = new Weather({
      scene: this.scene,
      fog,
      baseFogDensity: stage.fogDensity,
      baseFogColor: new THREE.Color(stage.sky.fog),
      hemi: this.hemi,
      sun: this.sun,
      baseHemi: stage.hemi.intensity,
      baseSun: stage.sun.intensity,
      skyUniforms: skyU,
      baseTop: new THREE.Color(stage.sky.top),
      baseHorizon: new THREE.Color(stage.sky.horizon),
    });
    this.weather.onLightning = (d) => this.audio.thunder(d);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.bloom.strength = stage.night ? 1 : 0.8;
    this.applyLoadout();

    this.spawnAt(new THREE.Vector3(0, this.safeAltitude(0, 0), 0), Math.random() * Math.PI * 2);
    this.chunks.warmup(this.flight.pos.x, this.flight.pos.z, 12);
    this.refreshStageLists();
  }

  private disposeWorld() {
    this.endBattle();
    this.race?.dispose();
    this.race = null;
    this.ghost?.dispose();
    this.ghost = null;
    this.replayer?.stop();
    this.chunks.dispose();
    this.rings.dispose();
    this.powerups.dispose();
    this.scene.remove(this.sky.mesh, this.far.mesh, this.hemi, this.sun);
    this.sky.dispose();
    this.far.dispose();
    this.contrails.dispose(this.scene);
    this.fx.dispose();
    this.guns.dispose();
    this.drones.dispose();
    this.missiles.dispose();
    this.weather.dispose();
  }

  /** Aplica avión, pintura y mejoras elegidos en el hangar */
  applyLoadout() {
    const pr = this.progress;
    const mods = pr.modifiers;
    const paint = pr.paint;
    const visible = this.jet.group.visible;
    this.scene.remove(this.jet.group);
    this.jet = new JetModel(paint.accent, paint.body, pr.p.plane);
    this.jet.group.visible = visible;
    this.scene.add(this.jet.group);
    this.flight.speedMul = mods.speed;
    this.flight.agility = mods.agility;
    this.maxHp = Math.round(100 * mods.armor);
    if (this.guns) {
      this.guns.maxAmmo = MAX_AMMO + mods.ammoBonus;
      this.guns.ammo = Math.min(this.guns.ammo, this.guns.maxAmmo);
    }
  }

  private safeAltitude(x: number, z: number) {
    return Math.max(420, this.gen.maxHeightNear(x, z, 400) + 120);
  }

  /** Coloca el avión y reinicia su estado de vuelo */
  spawnAt(pos: THREE.Vector3, yaw: number) {
    this.flight.reset(pos.x, pos.y, pos.z, yaw);
    this.prevPos.copy(this.flight.pos);
    this.hp = this.maxHp;
    this.alive = true;
    this.myTarget.alive = true;
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
    this.sessionCredits = 0;
    this.shield = this.doubleDamage = this.turbo = 0;
    this.guns.refill();
    this.missiles.reset();
    this.race?.dispose();
    this.race = null;
    this.ghost?.dispose();
    this.ghost = null;
    this.isDaily = false;
    this.endBattle();
    this.paused = false;
    this.hud.setTimer(null);
    this.hud.countdown(null);
    this.hud.battleScore(null);
    this.hud.offRoute(false);
    this.flight.frozen = false;
    this.recorder.reset();
    this.offRouteT = 0;
    this.routeBest = Infinity;
    this.weather.randomize(this.settings.weather, this.stage.night);
    if (this.weather.kind !== 'clear') setTimeout(() => this.hud.toast(WEATHER_LABELS[this.weather.kind], 1500), 1300);
    if (this.room) this.progress.add('mpGames');
  }

  /** Vuelo libre en solitario */
  startFree() {
    this.audio.init();
    this.mode = 'free';
    this.resetSession();
    this.spawnAt(new THREE.Vector3(0, this.safeAltitude(0, 0), 0), Math.random() * Math.PI * 2);
    this.rings.respawnAll(this.chunks.loaded());
    this.powerups.setEnabled(true, this.chunks.loaded());
    this.drones.setActive(true);
    this.setScreen('playing');
    this.hud.toast('¡Despegue!');
  }

  /** Carrera contrarreloj (solo o multijugador) */
  startRace(def: CourseDef, gridIndex = 0, gridSize = 1, goAt?: number, daily?: string) {
    this.audio.init();
    this.mode = 'race';
    this.courseDef = def;
    this.resetSession();
    this.isDaily = !!daily;
    this.dailyKey = daily ?? '';
    this.drones.setActive(false);
    this.rings.enabled = false;
    this.rings.respawnAll([]);
    this.powerups.setEnabled(false, []);
    const course = buildCourse(this.gen, def);
    this.race = new Race(this.scene, course);
    if (this.settings.ghost && !this.room) {
      const g = loadGhost(course.id);
      if (g) this.ghost = new GhostPlayer(this.scene, g);
    }
    this.ghostRec.reset();
    const right = new THREE.Vector3(Math.cos(course.start.yaw), 0, -Math.sin(course.start.yaw));
    const pos = course.start.pos.clone().addScaledVector(right, (gridIndex - (gridSize - 1) / 2) * 32);
    this.spawnAt(pos, course.start.yaw);
    this.chunks.warmup(pos.x, pos.z, 16);
    this.flight.frozen = true;
    this.goAt = goAt ?? this.now() + 3500;
    this.lastCountdown = -1;
    this.setScreen('playing');
  }

  startDaily() {
    const d = dailyChallenge();
    if (d.stage.id !== this.stage.id) this.loadStage(d.stage);
    this.startRace(d.def, 0, 1, undefined, d.key);
    this.hud.toast(`Desafío diario · ${d.stage.name}`, 1800);
  }

  /** Vuelo libre multijugador */
  startCoopFree(gridIndex: number) {
    this.audio.init();
    this.mode = 'free';
    this.resetSession();
    this.drones.setActive(false);
    const pos = new THREE.Vector3(gridIndex * 40 - 60, this.safeAltitude(0, 0), 0);
    this.spawnAt(pos, 0);
    this.rings.respawnAll(this.chunks.loaded());
    this.powerups.setEnabled(true, this.chunks.loaded());
    for (const id of this.room?.rings ?? []) this.rings.takenByOther(id);
    this.setScreen('playing');
    this.hud.toast('¡Vuelo en equipo!');
  }

  /** Batalla (solo contra bots o multijugador) */
  startBattle(config: BattleConfig, startAt?: number) {
    this.audio.init();
    this.mode = 'battle';
    this.battleConfig = config;
    this.resetSession();
    this.drones.setActive(false);
    this.rings.enabled = false;
    this.rings.respawnAll([]);
    this.powerups.setEnabled(true, this.chunks.loaded());
    const myId = this.myId;
    const b = new Battle(config, myId);
    this.battle = b;
    const room = this.room;
    const humans: { id: string; name: string; team: Team | null; color: number }[] = [];
    const humanTeam = (t?: Team): Team | null => (config.kind === 'ffa' ? null : config.kind === 'coop' ? 'A' : (t ?? 'A'));
    if (room) {
      for (const [uid, p] of room.players) humans.push({ id: uid, name: uid === room.uid ? this.pilotName() : p.name, team: humanTeam(p.team), color: p.color });
    } else {
      humans.push({ id: myId, name: this.pilotName(), team: humanTeam('A'), color: this.progress.paint.accent });
    }
    for (const h of humans) b.add({ ...h, isBot: false });
    // Bots: equilibrar equipos
    let a = humans.filter((h) => h.team === 'A').length;
    let bb = humans.filter((h) => h.team === 'B').length;
    const specs = makeBotSpecs(config.bots, () => {
      if (config.kind === 'ffa') return null;
      if (config.kind === 'coop') return 'B';
      if (a <= bb) {
        a++;
        return 'A';
      }
      bb++;
      return 'B';
    });
    for (const s of specs) b.add({ id: s.id, name: s.name, team: s.team, color: s.team ? TEAM_COLORS[s.team] : s.color, isBot: true });
    // Solo simula los bots quien tiene la autoridad (en solitario o el anfitrión)
    if (!room || room.isHost) {
      for (const s of specs) {
        const bot = new Bot(s, this.scene, this.gen, this.fx, 0.65);
        bot.spawn(ARENA.clone().setY(0), 1400);
        this.bots.push(bot);
      }
    }
    this.goAt = startAt ?? this.now();
    const pos = this.arenaSpawn();
    this.spawnAt(pos, Math.atan2(pos.x, pos.z));
    this.setScreen('playing');
    this.hud.toast(BATTLE_LABELS[config.kind], 1800);
    this.syncMyScore();
  }

  private arenaSpawn() {
    const a = Math.random() * Math.PI * 2;
    const r = 900 + Math.random() * 500;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    return new THREE.Vector3(x, this.safeAltitude(x, z), z);
  }

  private endBattle() {
    for (const bot of this.bots) bot.dispose();
    this.bots = [];
    this.battle = null;
    this.hud.battleScore(null);
    if (this.room?.isHost) void this.room.clearBots();
  }

  private now() {
    return this.room ? this.room.serverNow() : performance.now();
  }

  // ================================================================ Pantallas
  private setScreen(s: Screen) {
    this.screen = s;
    show('menu', s === 'menu');
    show('crash', false);
    show('race-results', s === 'results' && this.mode === 'race');
    show('battle-results', s === 'results' && this.mode === 'battle');
    show('lobby', s === 'lobby');
    show('pause', false);
    this.paused = false;
    this.hud.show(s === 'playing' || s === 'crashed' || s === 'results');
    if (s !== 'playing') this.input.reset();
    void this.pwa.keepAwake(s === 'playing');
    if (s === 'menu' || s === 'lobby') {
      this.rig.mode = 'chase';
      this.hud.setCockpit(false);
      this.hud.setTimer(null);
      this.hud.countdown(null);
      this.hud.offRoute(false);
      this.hud.missileWarning(false);
      this.drones.setActive(false);
      this.race?.dispose();
      this.race = null;
      this.ghost?.dispose();
      this.ghost = null;
      this.endBattle();
      this.flight.frozen = false;
      this.weather.set('clear');
      if (!this.rings.enabled) {
        this.rings.enabled = true;
        this.rings.respawnAll(this.chunks.loaded());
      }
      if (!this.alive) this.spawnAt(new THREE.Vector3(0, this.safeAltitude(0, 0), 0), Math.random() * 6);
      if (s === 'menu') this.refreshMenu();
    }
    $('btn-stage').classList.toggle('hidden', this.mode !== 'free' || !!this.room);
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
    $('btn-pause-replay').classList.toggle('hidden', !!this.room || !this.recorder.hasContent);
    this.input.reset();
    void this.pwa.keepAwake(!p);
    if (!p) this.timer.update();
  }

  cycleCamera() {
    if (this.screen !== 'playing' || this.paused || this.replaying) return;
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
  /** Daño recibido (balas, misiles, choques) */
  private takeDamage(amount: number, killer?: string, weapon = false) {
    if (!this.alive || this.invuln > 0) return;
    if (weapon && this.shield > 0) {
      for (let i = 0; i < 6; i++) this.fx.shieldSpark(this.flight.pos);
      return;
    }
    this.hp -= amount;
    this.hud.damageFlash();
    Haptic.hitTaken();
    if (this.hp <= 0) this.destroy(killer);
  }

  /** Explosión del avión propio */
  private destroy(killer?: string) {
    if (!this.alive) return;
    this.alive = false;
    this.myTarget.alive = false;
    this.hp = 0;
    this.audio.explosion();
    this.audio.engine(0, 0, false);
    Haptic.explosion();
    const vel = this.flight.forward().multiplyScalar(this.flight.speed);
    this.fx.explosion(this.flight.pos, vel, 1.2);
    this.recorder.event('explosion', this.flight.pos, 1.2);
    this.jet.group.visible = false;
    this.rig.addShake(6);
    this.hud.warning(false);
    this.hud.missileWarning(false);
    this.progress.add('deaths');
    if (this.rig.mode === 'cockpit') {
      this.rig.mode = 'chase';
      this.hud.setCockpit(false);
      this.rig.snap();
      this.layoutControls();
    }
    // Créditos del derribo
    if (this.battle) {
      this.battle.kill(killer ?? null, this.myId);
      const kName = killer ? (this.battle.fighters.get(killer)?.name ?? '?') : null;
      this.hud.killfeed(kName ? `${kName} ✕ ${this.pilotName()}` : `${this.pilotName()} se estrelló`);
      this.syncMyScore();
    }
    if (killer && this.room) {
      if (killer.startsWith('bot')) {
        if (this.room.isHost) this.syncBotScores();
        else this.room.sendEvent(this.room.meta!.host, 'kill', 1, killer);
      } else this.room.sendEvent(killer, 'kill', 1);
    }
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
    } else if (this.battle) {
      const p = this.arenaSpawn();
      this.spawnAt(p, Math.atan2(p.x, p.z));
    } else {
      const p = this.flight.pos.clone();
      p.y = Math.max(p.y + 150, this.safeAltitude(p.x, p.z));
      this.spawnAt(p, this.flight.yaw);
    }
    this.guns.reload(this.guns.maxAmmo / 2);
  }

  /** Choque contra el escenario: leve (rozadura) o fuerte (explosión) */
  private impact(normal: THREE.Vector3, box: Box | null) {
    const f = this.flight;
    const v = f.forward().multiplyScalar(f.speed);
    const into = -v.dot(normal);
    const dmg = 8 + into * 0.6;
    if (into > HARD_IMPACT || this.hp - dmg <= 0) {
      this.destroy();
      return;
    }
    this.hp -= dmg;
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
    this.recorder.event('scrape', f.pos);
    this.recorder.highlight('Por los pelos');
    this.audio.scrape();
    Haptic.scrape();
    this.rig.addShake(3);
    this.hud.damageFlash();
    this.hud.toast('¡Rozadura!', 900);
    this.progress.add('scrapes');
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
    if (!this.alive || this.bumpCooldown > 0 || this.invuln > 0) return;
    const myVel = this.myTarget.vel;
    const others: Target[] = [...this.remotes.targets(), ...this.bots.map((b) => b.target)];
    for (const t of others) {
      if (!t.alive) continue;
      const d = this.flight.pos.distanceTo(t.pos);
      if (d > 15) continue;
      const n = new THREE.Vector3().subVectors(this.flight.pos, t.pos).normalize();
      const closing = -new THREE.Vector3().subVectors(myVel, t.vel).dot(n);
      const isBot = t.id.startsWith('bot');
      if (closing > HARD_BUMP) {
        if (this.room && !isBot) this.room.sendEvent(t.id, 'crash', closing);
        if (isBot) this.botCrash(t.id);
        this.destroy();
      } else {
        if (this.room && !isBot) this.room.sendEvent(t.id, 'bump', Math.max(0, closing));
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
    Haptic.bump();
    this.rig.addShake(3);
    this.hud.toast('¡Choque!', 900);
    this.takeDamage(10);
  }

  // ================================================================ Combate
  /** Lista de objetivos enemigos para mis armas */
  private enemyTargets(): Target[] {
    if (this.battle) {
      const b = this.battle;
      const list: Target[] = [...this.remotes.targets(), ...this.bots.map((x) => x.target)];
      return list.filter((t) => b.enemies(this.myId, t.id));
    }
    if (this.room) return this.remotes.targets();
    return this.drones.active ? this.drones.list : [];
  }

  private gunContext(firing: boolean) {
    return {
      firing,
      pos: this.flight.pos,
      quat: this.jet.group.quaternion,
      vel: this.myTarget.vel,
      targets: this.enemyTargets(),
      aimAssist: this.settings.aimAssist,
      onHit: (t: Target, _p: THREE.Vector3, dmg: number) => this.onMyHit(t, dmg, false),
      onShot: () => {
        Haptic.shot();
        if (this.shotSoundTimer <= 0) {
          this.audio.shot();
          this.shotSoundTimer = 0.07;
        }
      },
      onEmpty: () => {
        this.audio.empty();
        this.hud.toast('Sin munición: busca un hito, anillo o recompensa', 1600);
      },
    };
  }

  /** Mis balas o misiles han alcanzado a t */
  private onMyHit(t: Target, dmg: number, missile: boolean) {
    this.audio.hitMarker();
    if (missile) {
      this.progress.add('missileHits');
      this.recorder.highlight('Impacto de misil');
    }
    if (t.id.startsWith('drone-')) {
      const destroyed = this.drones.damage(t.id, dmg);
      this.hud.hitMarker(destroyed);
      if (destroyed) {
        this.kills++;
        this.fx.explosion(t.pos, t.vel, 0.8);
        this.recorder.event('explosion', t.pos, 0.8);
        this.recorder.highlight('Dron derribado');
        this.audio.explosion();
        this.guns.reload(15);
        this.progress.add('drones');
        this.earn(15);
        this.hud.toast(`¡Dron derribado! · ${this.kills}`);
      }
      return;
    }
    if (t.id.startsWith('bot')) {
      const local = this.bots.find((b) => b.spec.id === t.id);
      if (local) this.damageBot(local, dmg, this.myId);
      else if (this.room?.meta) this.room.sendEvent(this.room.meta.host, 'bhit', dmg, t.id);
      this.hud.hitMarker(false);
      return;
    }
    if (this.room) {
      this.room.sendEvent(t.id, 'hit', dmg);
      this.hud.hitMarker(false);
    }
  }

  /** Daño a un bot simulado localmente */
  private damageBot(bot: Bot, dmg: number, shooter: string) {
    if (!bot.alive) return;
    bot.hp -= dmg;
    if (bot.hp > 0) return;
    bot.kill();
    this.fx.explosion(bot.flight.pos, bot.target.vel, 1);
    this.recorder.event('explosion', bot.flight.pos, 1);
    this.audio.explosion();
    const b = this.battle;
    if (!b) return;
    b.kill(shooter, bot.spec.id);
    const sName = b.fighters.get(shooter)?.name ?? '?';
    this.hud.killfeed(`${sName} ✕ ${bot.spec.name}`, shooter === this.myId);
    if (shooter === this.myId) this.onMyKill(bot.spec.name);
    else if (this.room && !shooter.startsWith('bot')) this.room.sendEvent(shooter, 'kill', 1, bot.spec.id);
    this.syncBotScores();
  }

  private botCrash(id: string) {
    const bot = this.bots.find((b) => b.spec.id === id);
    if (!bot || !bot.alive) return;
    bot.kill();
    this.fx.explosion(bot.flight.pos, bot.target.vel, 1);
    this.battle?.kill(null, id);
    this.syncBotScores();
  }

  private onMyKill(victim: string) {
    this.kills++;
    this.audio.ring();
    this.hud.hitMarker(true);
    this.hud.toast(`¡Has derribado a ${victim}!`, 1800);
    this.recorder.highlight(`Derribo: ${victim}`);
    this.progress.add('kills');
    this.earn(40);
    if (this.battle) this.progress.max('bestStreak', this.battle.streak);
    this.syncMyScore();
  }

  private syncMyScore() {
    if (!this.room || !this.battle) return;
    const me = this.battle.me;
    if (me) this.room.setScore(this.myId, me.kills, me.deaths);
  }

  private syncBotScores() {
    if (!this.room?.isHost || !this.battle) return;
    for (const bot of this.bots) {
      const f = this.battle.fighters.get(bot.spec.id);
      if (f) this.room.setScore(bot.spec.id, f.kills, f.deaths);
    }
  }

  fireMissile() {
    if (this.screen !== 'playing' || !this.alive || this.paused || this.flight.frozen || this.mode === 'race') return;
    const lock = this.guns.lock;
    if (!lock || this.guns.lockStrength < 1) {
      this.hud.toast('Fija un objetivo antes de lanzar', 1100);
      return;
    }
    if (this.missiles.count <= 0) {
      this.audio.empty();
      this.hud.toast('Sin misiles: recoge una recompensa de munición', 1400);
      return;
    }
    this.missiles.launch(this.flight.pos, this.jet.group.quaternion, this.myTarget.vel, lock, 'me', this.myId);
    this.audio.boostRing();
    Haptic.shot();
    this.hud.toast('¡Misil fuera!', 800);
    if (this.room && !lock.id.startsWith('bot')) this.room.sendEvent(lock.id, 'mlaunch', 0);
  }

  fireFlares() {
    if (this.screen !== 'playing' || !this.alive || this.paused) return;
    if (this.missiles.deployFlares(this.flight.pos, this.myTarget.vel)) {
      this.audio.reload();
      Haptic.pickup();
      this.sendNetState(true);
    } else this.hud.toast('Bengalas recargándose', 900);
  }

  private missileContext() {
    return {
      me: this.myTarget,
      hasFlares: (t: Target) => (t.id === this.myId ? this.missiles.myFlareWindow > 0 : !!t.flares),
      onHit: (m: { owner: MissileOwner; shooterId: string }, t: Target) => {
        this.recorder.event('explosion', t.pos, 0.6);
        if (m.owner === 'me') this.onMyHit(t, MISSILE_DAMAGE * this.guns.damageMul, true);
        else if (m.owner === 'bot') this.botHit(m.shooterId, t, MISSILE_DAMAGE);
        // 'remote': solo visual, el daño llega por evento
      },
      onDecoyed: (m: { owner: MissileOwner; target: Target | null }) => {
        if (m.target?.id === this.myId && this.missiles.myFlareWindow > 0) {
          this.progress.add('flaresDodged');
          this.hud.toast('¡Misil esquivado!', 1200);
        }
      },
    };
  }

  /** Un bot (simulado aquí) alcanza a t */
  private botHit(botId: string, t: Target, dmg: number) {
    if (t.id === this.myId) this.takeDamage(dmg, botId, true);
    else if (t.id.startsWith('bot')) {
      const victim = this.bots.find((b) => b.spec.id === t.id);
      if (victim) this.damageBot(victim, dmg, botId);
    } else if (this.room) this.room.sendEvent(t.id, 'hit', dmg, botId);
  }

  private applyPower(kind: PowerKind) {
    const info = POWER_INFO[kind];
    this.audio.boostRing();
    Haptic.pickup();
    this.progress.add('powerups');
    this.earn(3);
    switch (kind) {
      case 'shield':
        this.shield = info.duration;
        break;
      case 'ammo':
        this.guns.refill();
        this.missiles.addMissiles(2);
        break;
      case 'repair':
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
        break;
      case 'turbo':
        this.turbo = info.duration;
        this.flight.burst = info.duration;
        break;
      case 'damage':
        this.doubleDamage = info.duration;
        break;
    }
    this.hud.toast(info.name, 1300);
  }

  private earn(n: number) {
    this.sessionCredits += n;
    this.progress.credit(n, '');
  }

  private onNetEvent(e: NetEvent) {
    const room = this.room;
    const from = room?.players.get(e.from)?.name ?? 'Alguien';
    const other = this.remotes.get(e.from)?.target;
    switch (e.type) {
      case 'hit':
        if (!this.alive || this.invuln > 0) return;
        this.audio.damaged();
        this.fx.hit(this.flight.pos, this.myTarget.vel);
        this.takeDamage(e.v, e.b ?? e.from, true);
        if (!this.alive) this.hud.toast(`Te ha derribado ${e.b ? (this.battle?.fighters.get(e.b)?.name ?? 'un bot') : from}`, 2200);
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
        if (room?.isHost && e.b) {
          // Un bot mío ha derribado a e.from
          this.battle?.kill(e.b, e.from);
          this.hud.killfeed(`${this.battle?.fighters.get(e.b)?.name ?? 'Bot'} ✕ ${from}`);
          this.syncBotScores();
        } else {
          const victim = e.b ? (this.battle?.fighters.get(e.b)?.name ?? 'un bot') : from;
          if (this.battle) this.battle.kill(this.myId, e.b ?? e.from);
          this.hud.killfeed(`${this.pilotName()} ✕ ${victim}`, true);
          this.onMyKill(victim);
        }
        break;
      case 'bhit': {
        const bot = this.bots.find((b) => b.spec.id === e.b);
        if (bot) this.damageBot(bot, e.v, e.from);
        break;
      }
      case 'mlaunch': {
        const shooter = this.remotes.get(e.from);
        if (shooter && this.alive) {
          this.missiles.launch(shooter.target.pos, shooter.quat, shooter.target.vel, this.myTarget, 'remote', e.from);
        }
        break;
      }
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
      hp: (this.hp / this.maxHp) * 100,
      a: this.alive && playing ? 1 : 0,
      fl: this.missiles.myFlareWindow > 0 ? 1 : 0,
    });
    if (this.room.isHost && this.bots.length) {
      this.room.sendBots(
        this.bots.map((b) => ({
          x: b.flight.pos.x,
          y: b.flight.pos.y,
          z: b.flight.pos.z,
          yaw: b.flight.yaw,
          pitch: b.flight.pitch,
          roll: b.flight.roll,
          s: b.flight.speed,
          f: b.firing ? 1 : 0,
          hp: b.hp,
          a: b.alive ? 1 : 0,
          n: b.spec.name,
          c: b.spec.color,
          tm: b.spec.team ?? undefined,
        })),
      );
    }
  }

  // ================================================================ Bucle
  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.time += dt;
    this.netTimer -= dt;

    if (this.replaying) {
      this.replayer.update(dt, this.time);
      this.fx.update(dt);
      this.guns.update(dt, this.gunContext(false));
      this.chunks.update(this.replayer.subject.x, this.replayer.subject.z);
      this.far.update(this.replayer.subject);
      this.sky.update(this.camera);
      this.weather.update(dt, this.camera, new THREE.Vector3());
      this.render(dt);
      return;
    }

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
      for (const p of this.remotes.map.values()) {
        const on = p.target.flares === true;
        if (on && !this.remoteFlares.has(p.uid)) this.missiles.cosmeticFlares(p.target.pos, p.target.vel);
        if (on) this.remoteFlares.add(p.uid);
        else this.remoteFlares.delete(p.uid);
      }
      if (this.screen === 'lobby' || this.screen === 'results') this.sendNetState();
    }

    const frozen = this.paused && !this.room;
    if (!frozen) {
      this.fx.update(dt);
      this.drones.update(dt, this.flight.pos, this.flight.forward(), this.time);
      if (this.screen !== 'playing') this.guns.update(dt, this.gunContext(false));
      if (this.screen !== 'playing') this.missiles.update(dt, this.missileContext());
      const speedFactor = THREE.MathUtils.clamp((this.flight.speedKmh - CRUISE_KMH) / (BOOST_KMH - CRUISE_KMH), 0, 1);
      this.rig.update(this.alive ? dt : dt * 0.15, this.flight, this.alive ? speedFactor : 0);
    }
    this.jet.update(this.flight, this.time);
    if (!(this.screen === 'playing' && this.invuln > 0)) this.jet.group.visible = this.alive && this.rig.mode !== 'cockpit';
    this.contrails.setVisible(this.rig.mode !== 'cockpit');
    if (this.alive && !frozen) this.fx.damageTrail(this.flight.pos, this.hp / this.maxHp, dt);
    if (this.alive && this.shield > 0 && !frozen) this.fx.shieldSpark(this.flight.pos);

    this.chunks.update(this.flight.pos.x, this.flight.pos.z);
    this.far.update(this.flight.pos);
    this.sky.update(this.camera);
    if (!frozen) {
      const turb = this.weather.update(dt, this.camera, this.myTarget.vel);
      if (this.screen === 'playing' && this.alive && !this.flight.frozen) {
        this.flight.roll += turb.roll;
        this.flight.pitch += turb.pitch;
      }
    }
    this.sun.position.copy(this.flight.pos).add(new THREE.Vector3(...this.stage.sun.dir).multiplyScalar(100));
    this.sun.target.position.copy(this.flight.pos);
    this.sun.target.updateMatrixWorld();
    show('loading', this.chunks.loadingCount >= 30 && this.screen === 'playing');

    if (this.screen === 'playing' || this.screen === 'crashed' || this.screen === 'results') this.updateHud();
    else this.arrow.update(this.flight.pos, 0, null, false);

    this.render(dt);
  }

  private render(dt: number) {
    if (this.settings.effects === 'high') this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  private updatePlaying(dt: number) {
    const f = this.flight;
    this.invuln = Math.max(0, this.invuln - dt);
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    this.shotSoundTimer -= dt;
    this.shield = Math.max(0, this.shield - dt);
    this.doubleDamage = Math.max(0, this.doubleDamage - dt);
    this.turbo = Math.max(0, this.turbo - dt);
    this.guns.damageMul = this.doubleDamage > 0 ? 2 : 1;
    const input = this.paused ? { x: 0, y: 0, boost: false, climb: false, fire: false } : this.input.read();
    this.lastInput = input;
    this.myTarget.id = this.myId;
    this.myTarget.vel.copy(f.forward()).multiplyScalar(f.speed);
    this.myTarget.flares = this.missiles.myFlareWindow > 0;

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

    // Batalla
    if (this.battle) this.updateBattle(dt);

    // Recompensas y misiles (también muerto, para que sigan su curso)
    const pw = this.powerups.update(dt, this.time, this.alive ? f.pos : null, () => this.chunks.loaded());
    if (pw) this.applyPower(pw);
    this.missiles.update(dt, this.missileContext());

    // Grabación para la repetición
    this.recorder.tick(dt, () => this.sampleActors());

    if (!this.alive) {
      if (this.mode === 'race' || this.mode === 'battle' || this.room) {
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
    if (this.turbo > 0) input.boost = true;
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

    // Fantasma
    if (this.race?.started && !this.race.finished) {
      this.ghostRec.record(dt, f);
      this.ghost?.update(this.race.elapsed, this.time);
    } else if (this.ghost && this.race && !this.race.started) {
      this.ghost.update(0, this.time);
    }

    this.checkPlayerCollisions();
    this.guns.update(dt, this.gunContext(!!input.fire && !f.frozen && !this.paused));

    // Aviso de proximidad al suelo
    const ground = this.gen.maxHeightNear(f.pos.x, f.pos.z, 60);
    const clearance = f.pos.y - ground;
    const warn = clearance < 90 && f.pitch < -0.12;
    this.hud.warning(warn);
    if (warn) {
      this.warnTimer -= dt;
      if (this.warnTimer <= 0) {
        this.audio.warning();
        this.warnTimer = 0.45;
      }
    }
    // Logros de vuelo
    if (f.speedKmh > this.progress.p.stats.maxSpeed + 5) this.progress.max('maxSpeed', Math.round(f.speedKmh));
    if (f.pos.y - this.gen.heightAt(f.pos.x, f.pos.z) < 30 && f.speedKmh > 900) {
      this.lowFlightT += dt;
      if (this.lowFlightT >= 5 && this.progress.p.stats.lowFlight < 5) this.progress.max('lowFlight', 5);
    } else this.lowFlightT = 0;

    // Misil entrante
    const incoming = this.missiles.incomingTo(this.myId);
    if (incoming) {
      const to = incoming.pos.clone().sub(f.pos);
      const rel = Math.atan2(to.x, to.z) - Math.atan2(-Math.sin(f.yaw), -Math.cos(f.yaw));
      this.hud.missileWarning(true, (-THREE.MathUtils.radToDeg(rel) + 360) % 360);
      this.missileBeep -= dt;
      if (this.missileBeep <= 0) {
        this.missileBeep = Math.max(0.12, Math.min(0.6, to.length() / 1500));
        this.audio.warning();
        Haptic.missileWarning();
      }
    } else this.hud.missileWarning(false);

    // Fuera de ruta (carrera)
    if (this.race?.started && !this.race.finished) {
      const d = this.race.nextGatePos.distanceTo(f.pos);
      this.routeBest = Math.min(this.routeBest, d);
      const toGate = this.race.nextGatePos.clone().sub(f.pos).normalize();
      const away = f.forward().dot(toGate) < -0.2;
      if ((d > this.routeBest + 400 && d > 800) || (away && d > 700)) this.offRouteT += dt;
      else this.offRouteT = Math.max(0, this.offRouteT - dt * 2);
      this.hud.offRoute(this.offRouteT > 2.5);
    }

    this.audio.engine(THREE.MathUtils.clamp(f.speedKmh / BOOST_KMH, 0, 1), f.thrust, !f.frozen);
    const q = this.jet.group.quaternion;
    const tips = this.jet.wingTips.map((t) => t.clone().applyQuaternion(q).add(this.jet.group.position));
    this.jet.update(f, this.time);
    if (!f.frozen) this.contrails.update(tips);
    if (this.invuln > 0) this.jet.group.visible = Math.floor(this.time * 12) % 2 === 0 && this.rig.mode !== 'cockpit';
    this.sendNetState();
  }

  private updateBattle(dt: number) {
    const b = this.battle!;
    b.elapsed = (this.now() - this.goAt) / 1000;
    // Bots (solo con autoridad)
    for (const bot of this.bots) {
      if (!bot.alive) {
        bot.respawn -= dt;
        if (bot.respawn <= 0 && !b.finished) bot.spawn(ARENA, 1400);
        bot.update(dt, this.time, [], ARENA, this.missiles, () => undefined);
        continue;
      }
      const enemies: Target[] = [];
      if (b.enemies(bot.spec.id, this.myId) && this.alive) enemies.push(this.myTarget);
      for (const t of this.remotes.targets()) if (b.enemies(bot.spec.id, t.id)) enemies.push(t);
      for (const o of this.bots) if (o !== bot && o.alive && b.enemies(bot.spec.id, o.spec.id)) enemies.push(o.target);
      const crashed = bot.update(dt, this.time, enemies, ARENA, this.missiles, (t, dmg) => this.botHit(bot.spec.id, t, dmg));
      if (crashed) this.botCrash(bot.spec.id);
    }
    if (this.room) for (const [id, sc] of this.room.scores) if (id !== this.myId) b.setScore(id, sc.k, sc.d);
    const mins = Math.floor(b.timeLeft / 60);
    const secs = Math.floor(b.timeLeft % 60);
    this.hud.battleScore(b.scoreLine(), `${mins}:${String(secs).padStart(2, '0')}`);
    const res = b.check();
    if (res) this.onBattleFinished(res);
  }

  private sampleActors() {
    const out = [
      {
        id: this.myId,
        kind: 'jet' as const,
        color: this.progress.paint.accent,
        x: this.flight.pos.x,
        y: this.flight.pos.y,
        z: this.flight.pos.z,
        yaw: this.flight.yaw,
        pitch: this.flight.pitch,
        roll: this.flight.roll,
        alive: this.alive,
        fire: !!this.lastInput.fire && this.alive,
      },
    ];
    const near = (p: THREE.Vector3) => p.distanceToSquared(this.flight.pos) < 2500 * 2500;
    for (const d of this.drones.list)
      if (d.alive && near(d.pos)) out.push({ id: d.id, kind: 'drone' as never, color: 0xd8323a, x: d.pos.x, y: d.pos.y, z: d.pos.z, yaw: d.mesh.rotation.y, pitch: 0, roll: 0, alive: true, fire: false });
    for (const bot of this.bots) {
      const f = bot.flight;
      if (near(f.pos)) out.push({ id: bot.spec.id, kind: 'jet', color: bot.spec.team ? TEAM_COLORS[bot.spec.team] : bot.spec.color, x: f.pos.x, y: f.pos.y, z: f.pos.z, yaw: f.yaw, pitch: f.pitch, roll: f.roll, alive: bot.alive, fire: bot.firing });
    }
    for (const p of this.remotes.map.values()) {
      const t = p.target;
      if (!p.buffer.length || !near(t.pos)) continue;
      const e = new THREE.Euler().setFromQuaternion(p.quat, 'YXZ');
      out.push({ id: p.uid, kind: 'jet', color: p.info.team ? TEAM_COLORS[p.info.team] : p.info.color, x: t.pos.x, y: t.pos.y, z: t.pos.z, yaw: e.y, pitch: e.x, roll: e.z, alive: p.alive, fire: p.firing });
    }
    return out;
  }

  private onRingsCollected(got: number) {
    this.audio.ring();
    Haptic.pickup();
    if (this.room) {
      for (const id of this.rings.lastCollected) this.room.claimRing(id);
    } else {
      this.ringCount += got;
    }
    this.progress.add('rings', got);
    this.earn(5 * got);
    const added = this.guns.reload(40);
    this.hud.toast(added > 0 ? `+${got} anillo · +${added} balas` : `+${got} anillo`);
  }

  private onRaceEvent(ev: RaceEvent) {
    switch (ev.type) {
      case 'gate': {
        const added = this.guns.reload(this.guns.maxAmmo / 2);
        const better = ev.delta !== null && ev.delta < 0;
        this.audio.gate(better);
        Haptic.gate();
        this.routeBest = Infinity;
        this.offRouteT = 0;
        this.hud.offRoute(false);
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
          this.progress.add('timeBonuses');
        } else {
          this.audio.boostRing();
          this.flight.burst = 2.2;
          this.hud.toast('¡Acelerón!', 900);
          this.fx.sparks(ev.pos, null, 20, 40);
        }
        break;
      case 'finish':
        this.audio.gate(ev.best);
        this.recorder.highlight('Meta');
        this.onRaceFinished(ev.time, ev.splits, ev.best);
        break;
    }
  }

  /** Volver al último hito (penalización de tiempo) */
  resetToRoute() {
    if (!this.race?.started || this.race.finished || this.screen !== 'playing' || !this.alive) return;
    this.race.penalty(ROUTE_PENALTY);
    const p = this.race.respawnPoint();
    this.spawnAt(p.pos, p.yaw);
    this.routeBest = Infinity;
    this.offRouteT = 0;
    this.hud.offRoute(false);
    this.hud.toast(`De vuelta a la ruta · +${ROUTE_PENALTY} s`, 1500);
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
    this.myTarget.vel.copy(this.flight.forward()).multiplyScalar(this.flight.speed);
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
    const items: RadarItem[] = [];
    let route: THREE.Vector3[] = [];
    let arrowTarget: THREE.Vector3 | null = null;
    let arrowColor: number | undefined;

    if (this.race) {
      scoreLabel = 'Hito';
      scoreValue = `${Math.min(this.race.passed + 1, this.race.totalCheckpoints)}/${this.race.totalCheckpoints}`;
      if (!this.race.finished) {
        navTarget = this.race.nextGatePos;
        navGate = true;
        navLabel = this.race.nextGate === 0 ? 'META' : `HITO ${this.race.nextGate}`;
        arrowTarget = navTarget;
        items.push({ pos: navTarget, kind: 'gate', label: this.race.nextGate === 0 ? 'M' : String(this.race.nextGate) });
        if (this.race.nextGate !== 0) items.push({ pos: this.race.followingGatePos, kind: 'gate2' });
        route = [f.pos, navTarget, ...(this.race.nextGate !== 0 ? [this.race.followingGatePos] : [])];
      }
      if (this.ghost && !this.ghost.finished) items.push({ pos: this.ghost.pos, kind: 'ghost' });
      this.hud.setTimer(formatTime(this.race.started ? this.race.time : 0));
    } else if (this.battle) {
      scoreLabel = 'Derribos';
      scoreValue = String(this.battle.me?.kills ?? 0);
      const enemies = this.enemyTargets().filter((t) => t.alive);
      let nearest: Target | null = null;
      let nd = Infinity;
      for (const t of enemies) {
        items.push({ pos: t.pos, kind: 'enemy' });
        const d = t.pos.distanceTo(f.pos);
        if (d < nd) {
          nd = d;
          nearest = t;
        }
      }
      for (const t of [...this.remotes.targets(), ...this.bots.map((b) => b.target)]) {
        if (t.alive && !this.battle.enemies(this.myId, t.id)) items.push({ pos: t.pos, kind: 'ally' });
      }
      if (nearest && nd > 700) {
        arrowTarget = nearest.pos;
        arrowColor = 0xff4040;
        navTarget = nearest.pos;
        navLabel = nearest.name?.toUpperCase() ?? '';
      }
    } else {
      if (this.room) {
        scoreLabel = 'Anillos equipo';
        scoreValue = String(this.room.rings.size);
        for (const t of this.remotes.targets()) if (t.alive) items.push({ pos: t.pos, kind: 'ally' });
      } else if (this.kills > 0) {
        scoreLabel = 'Anillos · Drones';
        scoreValue = `${this.ringCount} · ${this.kills}`;
      }
      if (this.screen === 'playing' && this.alive) navTarget = this.rings.nearest(f.pos);
      for (const d of this.drones.list) if (d.alive) items.push({ pos: d.pos, kind: 'drone' });
    }
    if (this.mode !== 'race') {
      for (const p of this.powerups.positions()) items.push({ pos: p.pos, kind: 'power', color: POWER_INFO[p.kind].css });
      if (this.mode === 'free') {
        // anillos cercanos
        const near = this.rings.nearest(f.pos);
        if (near) items.push({ pos: near, kind: 'ring' });
      }
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
      hp01: this.hp / this.maxHp,
      ammo: this.guns.ammo,
      maxAmmo: this.guns.maxAmmo,
      lockPos: lock?.pos ?? null,
      lockStrength: this.guns.lockStrength,
      lockName: lock?.name,
    });
    this.hud.setWeapons(this.missiles.count, this.missiles.flares, this.missiles.myFlareWindow > 0);
    const pws: { name: string; color: string; left: number; total: number }[] = [];
    if (this.shield > 0) pws.push({ name: 'Escudo', color: POWER_INFO.shield.css, left: this.shield, total: POWER_INFO.shield.duration });
    if (this.doubleDamage > 0) pws.push({ name: 'Doble daño', color: POWER_INFO.damage.css, left: this.doubleDamage, total: POWER_INFO.damage.duration });
    if (this.turbo > 0) pws.push({ name: 'Turbo', color: POWER_INFO.turbo.css, left: this.turbo, total: POWER_INFO.turbo.duration });
    this.hud.setPowerups(pws);
    this.radar.draw(f.pos, f.yaw, items, route);
    this.arrow.update(f.pos, f.yaw, arrowTarget, this.alive && this.screen === 'playing' && this.rig.mode !== 'cockpit' && this.rig.mode !== 'top', arrowColor);
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

  // ================================================================ Repetición
  startReplay(returnTo: string) {
    if (!this.recorder.hasContent) return;
    const paint = this.progress.paint;
    const rec = this.recorder.snapshot(this.myId, [paint.body, paint.accent], this.progress.p.plane);
    if (!this.replayer.start(rec)) return;
    this.replaying = true;
    this.replayReturn = returnTo;
    for (const id of ['crash', 'race-results', 'battle-results', 'pause']) show(id, false);
    this.hud.show(false);
    this.jet.group.visible = false;
    this.arrow.update(this.flight.pos, 0, null, false);
    show('replay-ui', true);
    $('replay-label').textContent = this.replayer.label;
    this.audio.engine(0, 0, false);
  }

  endReplay() {
    if (!this.replaying) return;
    this.replayer.stop();
    this.replaying = false;
    show('replay-ui', false);
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    this.rig.snap();
    this.hud.show(this.screen === 'playing' || this.screen === 'crashed' || this.screen === 'results');
    if (this.replayReturn) show(this.replayReturn, true);
    this.replayReturn = null;
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
    $('crash-credits').textContent = `+${this.sessionCredits} créditos`;
    show('btn-crash-replay', this.recorder.hasContent);
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
    const id = this.race!.course.id;
    // Fantasma
    const prevGhost = this.ghost?.data.time;
    if (best) saveGhost(id, this.ghostRec.data(this.race!.elapsed));
    if (prevGhost !== undefined && time < prevGhost) {
      this.progress.add('ghostBeaten');
      this.recorder.highlight('¡Fantasma batido!');
    }
    this.progress.add('races');
    this.earn(60 + (best ? 40 : 0));
    if (this.isDaily) {
      const firstToday = this.progress.p.daily[this.dailyKey] === undefined;
      const prev = this.progress.p.daily[this.dailyKey] ?? Infinity;
      this.progress.p.daily[this.dailyKey] = Math.min(prev, time);
      this.progress.save();
      if (firstToday) {
        this.progress.add('dailies');
        this.earn(120);
      }
    }
    this.hud.setTimer(formatTime(time));
    this.hud.split(`META · ${formatTime(time)}`, best ? 'good' : 'neutral');
    $('rr-title').textContent = best ? '¡Nuevo récord!' : '¡Carrera completada!';
    $('rr-time').textContent = formatTime(time);
    $('rr-course').textContent = `${this.isDaily ? `Desafío diario · ${dayLabel()}` : this.courseDef.name} · ${this.stage.name}`;
    $('rr-credits').textContent = `+${this.sessionCredits} créditos`;
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
    show('btn-rr-replay', !this.room);
    this.updateRoomResultButtons();
    setTimeout(() => {
      if (this.screen === 'results' && !this.replaying) this.setScreen('results');
    }, 1500);
  }

  private onBattleFinished(res: BattleResult) {
    this.screen = 'results';
    this.progress.add('battles');
    if (res.iWon) {
      this.progress.add('battlesWon');
      this.earn(150);
    } else this.earn(40);
    $('br-title').textContent = res.winnerLabel;
    $('br-sub').textContent = res.iWon ? '¡Has ganado!' : BATTLE_LABELS[this.battleConfig.kind];
    $('br-credits').textContent = `+${this.sessionCredits} créditos`;
    const teams = $('br-teams');
    teams.classList.toggle('hidden', !res.teams);
    if (res.teams) {
      teams.innerHTML = res.teams
        .map((t) => `<div style="--c:${hex(TEAM_COLORS[t.team])}"><span>${this.battleConfig.kind === 'coop' ? (t.team === 'A' ? 'Escuadrón' : 'Máquina') : t.team === 'A' ? 'Naranja' : 'Azul'}</span><b>${t.kills}</b></div>`)
        .join('');
    }
    const list = $('br-list');
    list.replaceChildren(
      ...res.rows.map((r, i) => {
        const li = document.createElement('li');
        if (r.id === this.myId) li.classList.add('me');
        li.innerHTML = `<span class="pos">${i + 1}</span><span class="nm"></span><span class="speed">${r.deaths} caídas</span><b>${r.kills}</b>`;
        const nm = li.querySelector('.nm') as HTMLElement;
        nm.textContent = r.name + (r.isBot ? ' 🤖' : '');
        if (r.team) nm.style.color = hex(TEAM_COLORS[r.team]);
        return li;
      }),
    );
    const host = !this.room || this.room.isHost;
    show('btn-br-again', host);
    show('btn-br-lobby', !!this.room && this.room.isHost);
    show('btn-br-menu', !this.room);
    show('btn-br-leave', !!this.room);
    show('btn-br-replay', !this.room && this.recorder.hasContent);
    show('br-wait', !!this.room && !this.room.isHost);
    setTimeout(() => {
      if (this.screen === 'results' && !this.replaying) this.setScreen('results');
    }, 1200);
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
  private readBattleForm(prefix: string): BattleConfig {
    return {
      kind: ($<HTMLSelectElement>(`${prefix}-bkind`).value as BattleKind) || 'ffa',
      bots: Number($<HTMLInputElement>(`${prefix}-bots`).value) || 0,
      killLimit: Number($<HTMLSelectElement>(`${prefix}-blimit`).value) || 10,
      timeLimit: Number($<HTMLSelectElement>(`${prefix}-btime`).value) || 300,
    };
  }

  private async createRoom() {
    const mode = ($<HTMLSelectElement>('mp-mode').value as RoomMode) || 'free';
    const course = $<HTMLSelectElement>('mp-course').value || COURSES[0].id;
    const bc = this.readBattleForm('mp');
    this.setMpBusy(true);
    try {
      const room = await Room.create(this.pilotName(), mode, this.stage.id, course, { kind: bc.kind, bots: bc.bots, kill: bc.killLimit, time: bc.timeLimit });
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
    const resync = () => this.remotes.sync(room.players, room.uid, room.isHost ? undefined : room.bots);
    room.onPlayers = () => {
      resync();
      this.renderLobby();
      if (this.screen === 'results') this.renderRoomResults();
      if (this.battle) for (const [uid, p] of room.players) if (!this.battle.fighters.has(uid)) this.battle.add({ id: uid, name: p.name, team: this.battleConfig.kind === 'ffa' ? null : this.battleConfig.kind === 'coop' ? 'A' : (p.team ?? 'A'), color: p.color, isBot: false });
    };
    room.onBots = () => {
      if (!room.isHost) {
        resync();
        if (this.battle) for (const [id, bn] of room.bots) if (!this.battle.fighters.has(id)) this.battle.add({ id, name: bn.n, team: bn.tm ?? null, color: bn.c, isBot: true });
      }
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
      } else if (m.mode === 'battle') {
        this.startBattle({ kind: m.bk ?? 'ffa', bots: m.bb ?? 2, killLimit: m.bl ?? 10, timeLimit: m.bt ?? 300 }, m.startAt);
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
    const teamMode = m.mode === 'battle' && m.bk === 'teams';
    const list = $('lobby-players');
    list.replaceChildren(
      ...[...room.players.entries()]
        .sort((a, b) => a[1].joinedAt - b[1].joinedAt)
        .map(([uid, p]) => {
          const li = document.createElement('li');
          const dot = document.createElement('span');
          dot.className = 'dot';
          dot.style.background = hex(teamMode && p.team ? TEAM_COLORS[p.team] : p.color);
          const name = document.createElement('span');
          name.textContent = p.name + (uid === room.uid ? ' (tú)' : '');
          li.append(dot, name);
          if (teamMode && p.team) {
            const t = document.createElement('small');
            t.className = 'team';
            t.textContent = p.team === 'A' ? 'Naranja' : 'Azul';
            li.append(t);
          }
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
    for (const id of ['lobby-mode', 'lobby-stage', 'lobby-course', 'lobby-bkind', 'lobby-bots', 'lobby-blimit', 'lobby-btime']) ($(id) as HTMLSelectElement).disabled = !host;
    $<HTMLSelectElement>('lobby-mode').value = m.mode;
    $<HTMLSelectElement>('lobby-stage').value = m.stage;
    $<HTMLSelectElement>('lobby-course').value = m.course;
    $<HTMLSelectElement>('lobby-bkind').value = m.bk ?? 'ffa';
    $<HTMLInputElement>('lobby-bots').value = String(m.bb ?? 2);
    $('lobby-bots-val').textContent = String(m.bb ?? 2);
    $<HTMLSelectElement>('lobby-blimit').value = String(m.bl ?? 10);
    $<HTMLSelectElement>('lobby-btime').value = String(m.bt ?? 300);
    show('lobby-course-field', m.mode === 'race');
    show('lobby-battle', m.mode === 'battle');
    show('btn-team', teamMode);
    show('btn-lobby-start', host);
    show('lobby-wait', !host);
    $('btn-lobby-start').textContent = m.mode === 'race' ? 'Empezar carrera' : m.mode === 'battle' ? 'Empezar batalla' : 'Empezar vuelo';
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
    setHaptics(s.vibration);
    if (this.fx) this.fx.high = s.effects === 'high';
    this.layoutControls();
  }

  private persist() {
    saveSettings(this.settings);
    this.applySettings();
  }

  private setupPwa() {
    const btn = $('btn-install');
    const refresh = () => show('btn-install', this.pwa.canInstall);
    this.pwa.onInstallAvailable = refresh;
    this.pwa.onInstalled = () => {
      refresh();
      this.hud.toast('FalconFree instalado', 1800);
    };
    this.pwa.onUpdateReady = () => show('update-banner', true);
    refresh();
    btn.addEventListener('click', async () => {
      const r = await this.pwa.install();
      if (r === 'ios') show('install-help', true);
      else if (r === 'unavailable') this.hud.toast('Usa el menú del navegador → Instalar app', 2200);
    });
    $('btn-update').addEventListener('click', () => this.pwa.applyUpdate());
    $('btn-update-later').addEventListener('click', () => show('update-banner', false));
    this.pwa.register();
    if (isStandalone()) document.documentElement.classList.add('standalone');
  }

  /** Accesos directos de la app instalada (?mode=free|daily) */
  private handleLaunchParams() {
    const mode = new URLSearchParams(location.search).get('mode');
    if (!mode) return;
    history.replaceState(null, '', location.pathname);
    // El sonido necesita un gesto: se activa en el primer toque
    if (mode === 'free') this.startFree();
    else if (mode === 'daily') this.startDaily();
  }

  private refreshMenu() {
    const d = dailyChallenge();
    const best = this.progress.p.daily[d.key];
    $('daily-sub').textContent = `${d.stage.name} · ${d.def.gates} hitos${best !== undefined ? ` · tu mejor ${formatTime(best)}` : ''}`;
    $('menu-credits').textContent = `${this.progress.p.credits} créditos`;
    const done = Object.keys(this.progress.p.achievements).length;
    $('btn-achievements').textContent = `Logros ${done}/${ACHIEVEMENTS.length}`;
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
    $('btn-daily').addEventListener('click', () => this.startDaily());
    $('btn-battle').addEventListener('click', () => show('battle-picker', true));
    $('btn-battle-go').addEventListener('click', () => {
      show('battle-picker', false);
      this.startBattle(this.readBattleForm('bp'));
    });
    $('btn-mp').addEventListener('click', () => {
      show('mp-panel', true);
      $('mp-error').textContent = firebase.multiplayer
        ? ''
        : 'El multijugador necesita Firebase con Realtime Database (ver README). En esta versión de prueba no está disponible.';
    });
    for (const prefix of ['bp', 'mp', 'lobby']) {
      const r = $<HTMLInputElement>(`${prefix}-bots`);
      r.addEventListener('input', () => ($(`${prefix}-bots-val`).textContent = r.value));
    }

    // Juego
    $('btn-view').addEventListener('click', () => this.cycleCamera());
    $('btn-pause').addEventListener('click', () => this.setPaused(true));
    $('btn-resume').addEventListener('click', () => this.setPaused(false));
    $('btn-pause-menu').addEventListener('click', () => this.setScreen('menu'));
    $('btn-restart').addEventListener('click', () => {
      if (this.mode === 'race') this.isDaily ? this.startDaily() : this.startRace(this.courseDef);
      else if (this.mode === 'battle') this.startBattle(this.battleConfig);
      else this.startFree();
    });
    $('btn-pause-replay').addEventListener('click', () => this.startReplay('pause'));
    $('btn-leave-room').addEventListener('click', () => void this.leaveRoom());
    $('btn-room-lobby').addEventListener('click', () => void this.room?.backToLobby());
    $('btn-pause-settings').addEventListener('click', () => this.openSettings());
    $('btn-retry').addEventListener('click', () => this.startFree());
    $('btn-crash-menu').addEventListener('click', () => this.setScreen('menu'));
    $('btn-crash-replay').addEventListener('click', () => this.startReplay('crash'));
    $('btn-route-reset').addEventListener('click', () => this.resetToRoute());
    $('btn-replay-skip').addEventListener('click', () => this.endReplay());
    $('btn-stage').addEventListener('click', () => {
      this.setPaused(true);
      show('pause', false);
      show('stage-picker', true);
    });
    $('btn-board').addEventListener('click', () => this.openBoard(this.stage.id));

    // Resultados
    $('btn-rr-retry').addEventListener('click', () => (this.isDaily ? this.startDaily() : this.startRace(this.courseDef)));
    $('btn-rr-menu').addEventListener('click', () => this.setScreen('menu'));
    $('btn-rr-replay').addEventListener('click', () => this.startReplay('race-results'));
    $('btn-rr-again').addEventListener('click', () => void this.room?.startRound());
    $('btn-rr-lobby').addEventListener('click', () => void this.room?.backToLobby());
    $('btn-rr-leave').addEventListener('click', () => void this.leaveRoom());
    $('btn-br-again').addEventListener('click', () => (this.room ? void this.room.startRound() : this.startBattle(this.battleConfig)));
    $('btn-br-lobby').addEventListener('click', () => void this.room?.backToLobby());
    $('btn-br-menu').addEventListener('click', () => this.setScreen('menu'));
    $('btn-br-leave').addEventListener('click', () => void this.leaveRoom());
    $('btn-br-replay').addEventListener('click', () => this.startReplay('battle-results'));

    // Multijugador
    const mpCourse = $<HTMLSelectElement>('mp-course');
    const lobbyCourse = $<HTMLSelectElement>('lobby-course');
    for (const sel of [mpCourse, lobbyCourse]) for (const c of COURSES) sel.append(new Option(c.name, c.id));
    const lobbyStage = $<HTMLSelectElement>('lobby-stage');
    for (const s of STAGES) lobbyStage.append(new Option(s.name, s.id));
    $<HTMLSelectElement>('mp-mode').addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      show('mp-course-field', v === 'race');
      show('mp-battle', v === 'battle');
    });
    $('btn-mp-create').addEventListener('click', () => void this.createRoom());
    $('btn-mp-join').addEventListener('click', () => void this.joinRoom());
    $<HTMLInputElement>('mp-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.joinRoom();
    });
    $('btn-lobby-leave').addEventListener('click', () => void this.leaveRoom());
    $('btn-lobby-start').addEventListener('click', () => void this.room?.startRound());
    $('btn-team').addEventListener('click', () => {
      const me = this.room?.players.get(this.room.uid);
      if (me) void this.room!.setTeam(me.team === 'A' ? 'B' : 'A');
    });
    $('lobby-mode').addEventListener('change', (e) => void this.room?.setMeta({ mode: (e.target as HTMLSelectElement).value as RoomMode }));
    lobbyStage.addEventListener('change', (e) => void this.room?.setMeta({ stage: (e.target as HTMLSelectElement).value as StageId }));
    lobbyCourse.addEventListener('change', (e) => void this.room?.setMeta({ course: (e.target as HTMLSelectElement).value }));
    $('lobby-bkind').addEventListener('change', (e) => void this.room?.setMeta({ bk: (e.target as HTMLSelectElement).value as BattleKind }));
    $('lobby-bots').addEventListener('change', (e) => void this.room?.setMeta({ bb: Number((e.target as HTMLInputElement).value) }));
    $('lobby-blimit').addEventListener('change', (e) => void this.room?.setMeta({ bl: Number((e.target as HTMLSelectElement).value) }));
    $('lobby-btime').addEventListener('change', (e) => void this.room?.setMeta({ bt: Number((e.target as HTMLSelectElement).value) }));
    $('btn-copy-code').addEventListener('click', () => {
      const code = this.room ? formatCode(this.room.code) : '';
      const done = () => this.hud.toast('Código copiado', 1000);
      navigator.clipboard?.writeText(code).then(done, () => selectText($('lobby-code')));
    });

    // Hangar y logros
    $('btn-hangar').addEventListener('click', () => this.openHangar('planes'));
    $('btn-achievements').addEventListener('click', () => this.openAchievements());
    document.querySelectorAll<HTMLElement>('#hangar-tabs button').forEach((b) =>
      b.addEventListener('click', () => this.openHangar(b.dataset.tab as 'planes' | 'paints' | 'upgrades')),
    );

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
    const toggles: [string, () => void][] = [
      ['set-invert', () => (this.settings.invertY = !this.settings.invertY)],
      ['set-aim', () => (this.settings.aimAssist = !this.settings.aimAssist)],
      ['set-sound', () => (this.settings.muted = !this.settings.muted)],
      ['set-effects', () => (this.settings.effects = this.settings.effects === 'high' ? 'low' : 'high')],
      [
        'set-weather',
        () => {
          this.settings.weather = !this.settings.weather;
          if (!this.settings.weather) this.weather.set('clear');
        },
      ],
      ['set-vibration', () => (this.settings.vibration = !this.settings.vibration)],
      ['set-ghost', () => (this.settings.ghost = !this.settings.ghost)],
    ];
    for (const [id, flip] of toggles) {
      $(id).addEventListener('click', () => {
        flip();
        this.persist();
        this.renderSettings();
      });
    }

    document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) =>
      b.addEventListener('click', () => {
        const ov = b.closest('.overlay')!;
        ov.classList.add('hidden');
        if (this.screen === 'playing' && ov.id !== 'pause' && this.paused) show('pause', true);
        if (this.screen === 'menu') this.refreshMenu();
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
      fb.textContent = 'Modo local: configura Firebase para la clasificación y el multijugador';
    }
    this.refreshMenu();
    setTimeout(() => this.refreshMenu(), msToNextDaily() + 1000);
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
    set('set-weather', s.weather, 'Variable', 'Siempre despejado');
    set('set-vibration', s.vibration, 'Sí', 'No');
    set('set-ghost', s.ghost, 'Sí', 'No');
    $<HTMLInputElement>('set-sensitivity').value = String(Math.round(s.sensitivity * 100));
    $('set-sensitivity-val').textContent = `${Math.round(s.sensitivity * 100)} %`;
  }

  private openHangar(tab: 'planes' | 'paints' | 'upgrades') {
    const pr = this.progress;
    show('hangar', true);
    $('hangar-credits').textContent = `${pr.p.credits} créditos`;
    document.querySelectorAll<HTMLElement>('#hangar-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const list = $('hangar-list');
    const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i style="--v:${Math.min(1, v / 1.6)}"></i></div>`;
    const refresh = () => {
      this.applyLoadout();
      this.openHangar(tab);
      this.refreshMenu();
    };
    if (tab === 'planes') {
      list.replaceChildren(
        ...PLANES.map((pl) => {
          const owned = pr.p.planes.includes(pl.id);
          const sel = pr.p.plane === pl.id;
          const el = document.createElement('div');
          el.className = `hg-item${sel ? ' selected' : ''}`;
          el.innerHTML = `<div class="hg-head"><b></b><small></small></div><div class="plane-stats">${bar('Velocidad', pl.speed)}${bar('Agilidad', pl.agility)}${bar('Blindaje', pl.armor)}</div>`;
          (el.querySelector('b') as HTMLElement).textContent = pl.name;
          (el.querySelector('small') as HTMLElement).textContent = pl.description;
          const btn = document.createElement('button');
          btn.className = sel ? 'secondary' : owned ? 'secondary strong' : 'primary small';
          btn.textContent = sel ? 'En uso' : owned ? 'Usar' : `Comprar · ${pl.cost}`;
          btn.disabled = sel || (!owned && pr.p.credits < pl.cost);
          if (!owned && pl.achievement) btn.title = `También con el logro «${ACHIEVEMENTS.find((a) => a.id === pl.achievement)?.name}»`;
          btn.addEventListener('click', () => {
            if (owned) pr.select('plane', pl.id as PlaneId);
            else if (!pr.buyPlane(pl.id)) return;
            refresh();
          });
          el.append(btn);
          return el;
        }),
      );
    } else if (tab === 'paints') {
      list.replaceChildren(
        ...PAINTS.map((pt) => {
          const owned = pr.p.paints.includes(pt.id);
          const sel = pr.p.paint === pt.id;
          const el = document.createElement('div');
          el.className = `hg-item paint${sel ? ' selected' : ''}`;
          el.innerHTML = `<span class="swatch2" style="--a:${hex(pt.body)};--b:${hex(pt.accent)}"></span><div class="hg-head"><b></b><small></small></div>`;
          (el.querySelector('b') as HTMLElement).textContent = pt.name;
          const ach = pt.achievement ? ACHIEVEMENTS.find((a) => a.id === pt.achievement) : null;
          (el.querySelector('small') as HTMLElement).textContent = owned ? 'Disponible' : ach ? `Logro: ${ach.name}` : `${pt.cost} créditos`;
          const btn = document.createElement('button');
          btn.className = sel ? 'secondary' : 'secondary strong';
          btn.textContent = sel ? 'En uso' : owned ? 'Usar' : pt.cost !== undefined ? 'Comprar' : 'Bloqueado';
          btn.disabled = sel || (!owned && (pt.cost === undefined || pr.p.credits < pt.cost));
          btn.addEventListener('click', () => {
            if (owned) pr.select('paint', pt.id);
            else if (!pr.buyPaint(pt.id)) return;
            refresh();
          });
          el.append(btn);
          return el;
        }),
      );
    } else {
      list.replaceChildren(
        ...UPGRADES.map((u) => {
          const lvl = pr.p.upgrades[u.id];
          const cost = u.costs[lvl];
          const el = document.createElement('div');
          el.className = 'hg-item';
          el.innerHTML = `<div class="hg-head"><b></b><small></small></div><div class="levels">${u.costs.map((_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>`;
          (el.querySelector('b') as HTMLElement).textContent = `${u.name} · nivel ${lvl}/${u.costs.length}`;
          (el.querySelector('small') as HTMLElement).textContent = `${u.per} por nivel`;
          const btn = document.createElement('button');
          btn.className = 'primary small';
          btn.textContent = cost === undefined ? 'Al máximo' : `Mejorar · ${cost}`;
          btn.disabled = cost === undefined || pr.p.credits < cost;
          btn.addEventListener('click', () => {
            if (pr.buyUpgrade(u.id as UpgradeId)) refresh();
          });
          el.append(btn);
          return el;
        }),
      );
    }
  }

  private openAchievements() {
    const pr = this.progress;
    show('achievements', true);
    const done = Object.keys(pr.p.achievements).length;
    $('ach-count').textContent = `${done} de ${ACHIEVEMENTS.length} conseguidos`;
    $('ach-list').replaceChildren(
      ...ACHIEVEMENTS.map((a) => {
        const li = document.createElement('li');
        const got = !!pr.p.achievements[a.id];
        li.className = got ? 'got' : '';
        li.innerHTML = `<span class="medal"></span><div><b></b><small></small></div><em>+${a.reward}</em>`;
        (li.querySelector('b') as HTMLElement).textContent = a.name;
        (li.querySelector('small') as HTMLElement).textContent = a.description;
        return li;
      }),
    );
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
    const daily = dailyChallenge();
    const dailyId = courseId(daily.stage.id, daily.def);
    const localBest = Number(store.get(`best.${stageId}`) ?? 0);
    if (!firebase.enabled) {
      const rows: HTMLElement[] = [li('Tus récords en este dispositivo', 'heading'), li(`Vuelo libre: ${localBest} anillos`)];
      for (const c of COURSES) {
        const b = loadBest(courseId(stageId, c));
        rows.push(li(`${c.name}: ${b ? formatTime(b.time) : 'sin tiempo'}`));
      }
      const db = this.progress.p.daily[daily.key];
      rows.push(li(`Desafío de hoy: ${db !== undefined ? formatTime(db) : 'sin tiempo'}`));
      rows.push(li('Configura Firebase para ver la clasificación global.'));
      list.replaceChildren(...rows);
      return;
    }
    try {
      const uid = await firebase.uid();
      const [dailyTimes, rings, ...times] = await Promise.all([
        firebase.topTimes(dailyId, 10),
        firebase.top(stageId),
        ...COURSES.map((c) => firebase.topTimes(courseId(stageId, c), 5)),
      ]);
      const rows: HTMLElement[] = [li(`Desafío diario · ${dayLabel()}`, 'heading')];
      if (!dailyTimes.length) rows.push(li('Nadie lo ha completado todavía hoy.'));
      dailyTimes.forEach((t, i) => rows.push(this.boardRow(i + 1, t.name, '', formatTime(t.timeMs / 1000), t.uid === uid)));
      rows.push(li('Vuelo libre · anillos', 'heading'));
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
