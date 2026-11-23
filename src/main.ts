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
import { Contrails, FarGround, Rings, Sky, RING_INFO, type RingPickup } from './effects';
import { ICONS, ICON_GLYPH, ICON_NAMES, hexColor, type IconId } from './identity';
import { Fx } from './fx';
import { Guns, MAX_AMMO, type Target } from './combat';
import { Drones } from './drones';
import { Race, SKIP_PENALTY, COURSES, buildCourse, courseId, formatTime, formatDelta, loadBest, type CourseDef, type RaceEvent } from './race';
import { Input } from './input';
import { Hud } from './hud';
import { GameAudio } from './audio';
import { firebase } from './firebase';
import { Room, NetError, formatCode, normalizeCode, MAX_PLAYERS, PLAYER_COLORS, type NetEvent, type PublicRoom, type RoomMeta, type RoomMode } from './net';
import { RemotePlayers, bodyTint } from './remote';
import { loadSettings, saveSettings, store, type Settings } from './settings';
import { applyControlLayout, ControlsEditor } from './controls';
import { GuideArrow, Radar, RouteTrail, type RadarItem } from './nav';
import { Weather, WEATHER_LABELS } from './weather';
import { GhostPlayer, GhostRecorder, loadGhost, saveGhost } from './ghost';
import { PowerUps, POWER_INFO, type PowerKind } from './powerups';
import { Missiles, MISSILE_DAMAGE, type MissileOwner } from './missiles';
import { Progress, ACHIEVEMENTS, PLANES, PAINTS, UPGRADES, WELCOME_CREDITS, type PlaneId, type UpgradeId } from './progress';
import { dailyChallenge, dayLabel, msToNextDaily, type DailyVariant } from './daily';
import { Bot, makeBotSpecs, TEAM_COLORS, type Team } from './bots';
import { Battle, BATTLE_LABELS, DEFAULT_BATTLE, isPointsMode, type BattleConfig, type BattleKind, type BattleResult } from './battle';
import { ReplayPlayer, ReplayRecorder } from './replay';
import { Pwa, isStandalone } from './pwa';
import { Stunts } from './stunts';
import { Delivery } from './delivery';
import { pickUpgrades, wavePlan, type UpgradeKey, type WaveUpgrade } from './waves';
import { KothZone } from './zone';
import { Season, SEASON_TIERS, XP_PER_TIER, seasonName, tierReward } from './season';
import { hash2 } from './world/noise';
import { Haptic, setHaptics } from './haptics';
import { Boss, PHASE_LABELS } from './boss';
import { CityEvents } from './events';
import { StormZone } from './zone';
import { CloudSave, formatRecovery } from './cloud';
import { QUICK_CHAT, CHAT_ICONS } from './chat';
import {
  MAX_GATES,
  MIN_GATES,
  MIN_GATE_GAP,
  circuitCourse,
  cleanCode,
  decodeGates,
  deleteCircuit,
  encodeGates,
  loadCircuits,
  longCode,
  parseLongCode,
  randomCode,
  upsertCircuit,
  type Circuit,
  type CircuitGate,
} from './circuits';
import type { GhostData } from './ghost';
import type { WeatherKind } from './weather';
import { VoicePlayer, VoiceRecorder, VOICE_MAX_MS } from './voice';
import { PlanePreview, type PreviewMode } from './planePreview';
import { AutoQuality, QUALITY_LABELS, qualityPreset, type QualityPreset } from './quality';
import type { QualityLevel, QualitySetting } from './settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, v: boolean) => $(id).classList.toggle('hidden', !v);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

type Screen = 'menu' | 'playing' | 'crashed' | 'results' | 'lobby';
type Mode = 'free' | 'race' | 'battle' | 'delivery' | 'waves' | 'editor';
/** Modos que se eligen en la pantalla «Un jugador» */
type PfMode = 'free' | 'delivery' | 'race' | 'daily' | 'battle' | 'koth' | 'tag' | 'waves' | 'royale' | 'boss' | 'circuits';

const PF_INFO: Record<PfMode, { title: string; desc: string }> = {
  free: { title: 'Vuelo libre', desc: 'Explora la ciudad, atraviesa aros de colores, derriba drones y recoge recompensas. Sin prisa.' },
  delivery: { title: 'Mensajero', desc: 'Recoge el paquete en la azotea verde y entrégalo en la naranja. Cada entrega suma 25 s; la propina sube si eres rápido y vuelas bajo.' },
  race: { title: 'Competición', desc: 'Pasa por todos los hitos en orden. Entre hitos elige ruta: la baja tiene anillos que restan 1 s y la alta anillos de acelerón. Corres contra tu fantasma.' },
  daily: { title: 'Desafío diario', desc: '' },
  battle: { title: 'Batalla', desc: 'Combate aéreo contra bots. Gana quien llegue antes a los derribos indicados.' },
  koth: { title: 'Rey del cielo', desc: 'Quédate solo dentro de la zona dorada para sumar 1 punto por segundo. La zona cambia de sitio cada minuto.' },
  tag: { title: 'Pilla-pilla', desc: 'Sin disparos. Quien «la lleva» tiene que tocar a otro avión. Sumas 1 punto por cada segundo sin llevarla.' },
  waves: { title: 'Oleadas', desc: 'Oleadas de drones y cazas cada vez más duras. Entre oleadas eliges una mejora. Una sola vida.' },
  royale: { title: 'Supervivencia', desc: 'Una sola vida. La tormenta violeta cierra el cielo poco a poco y fuera de la zona pierdes blindaje. Gana el último avión en pie.' },
  boss: { title: 'Jefe final', desc: 'Un dirigible gigante patrulla la ciudad. Fase 1: destruye sus 4 torretas. Fase 2: sus 2 motores (lanza misiles y cazas de escolta). Fase 3: el núcleo queda expuesto. Puedes llevar bots aliados.' },
  circuits: { title: 'Mis circuitos', desc: '' },
};

const isTouch = matchMedia('(hover: none), (pointer: coarse)').matches;

/** Velocidad perpendicular (m/s) a partir de la cual un choque destruye el avión */
const HARD_IMPACT = 48;
/** Velocidad de aproximación (m/s) entre aviones a partir de la cual explotan */
const HARD_BUMP = 75;
const RESPAWN_TIME = 3;
const NET_RATE = 10;
const ROUTE_PENALTY = 3;
const ARENA = new THREE.Vector3(0, 0, 0);
/** Cooperativo: distancia (m) a la que se avisa y a la que se reagrupa */
const LEASH_WARN = 1100;
const LEASH_MAX = 1700;

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
  trail: RouteTrail;
  radar = new Radar($<HTMLCanvasElement>('radar'));
  ghostRec = new GhostRecorder();
  autoQ = new AutoQuality(isTouch);
  gfx: QualityPreset = qualityPreset('medium', isTouch);
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
  dailyVariant: DailyVariant = store.get('dailyVariant') === 'night' ? 'night' : 'day';
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
  /** Anillos acumulados para el próximo misil (1 cada 5) */
  private ringsToMissile = 0;
  private pfMode: PfMode = 'free';
  private pfCourse: CourseDef = COURSES[0];
  stunts!: Stunts;
  season: Season;
  delivery: Delivery | null = null;
  zone: KothZone | null = null;
  private zoneSeed = 0;
  // Oleadas
  waveNo = 0;
  private waveLevels: Partial<Record<UpgradeKey, number>> = {};
  private waveChoosing = false;
  private shieldPulseT = 0;
  // Pilla-pilla
  private tagSeq = 0;
  private tagImmune = 0;
  private lastTagger: string | null = null;
  private lastTaggerUntil = 0;
  private tagFreeAcc = 0;
  // Formación
  private inFormation = 0;
  private formationAcc = 0;
  private scoreSyncT = 0;
  /** Crear la sala como pública */
  private mpPublic = false;
  private unwatchPublic: (() => void) | null = null;
  private leashT = 0;
  private leashTarget: THREE.Vector3 | null = null;

  // Modos nuevos
  storm: StormZone | null = null;
  boss: Boss | null = null;
  private bossWinAt = 0;
  cityEvents: CityEvents | null = null;
  private prevWeather: WeatherKind = 'clear';
  cloud = new CloudSave();
  worldGhost: GhostPlayer | null = null;
  private wgToken = 0;
  customCircuit: Circuit | null = null;
  /** Espectador: id del avión que se sigue */
  spectating: string | null = null;
  // Editor de circuitos
  private editGates: CircuitGate[] = [];
  private editPreview: Race | null = null;
  private editId = '';
  private savedCircuit: Circuit | null = null;
  // Chat rápido y mensajes de voz
  private chatCooldown = 0;
  private voiceRec = new VoiceRecorder();
  voicePlayer = new VoicePlayer();
  private talkPending = false;
  private talkTimer = 0;
  // Visor de aviones (hangar y preparar vuelo)
  preview = new PlanePreview();
  private hangarFocus: PlaneId | null = null;
  private hangarPaint: string | null = null;
  private previewMode: PreviewMode = '3d';

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
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.3, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.scene.add(this.jet.group);
    this.remotes = new RemotePlayers(this.scene);
    this.arrow = new GuideArrow(this.scene);
    this.arrow.camera = this.camera;
    this.trail = new RouteTrail(this.scene);
    this.myTarget = { id: 'me', name: 'Tú', pos: this.flight.pos, vel: new THREE.Vector3(), radius: 9, alive: true };

    this.settings = loadSettings();
    this.gfx = qualityPreset(this.qualityLevel, isTouch);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.gfx.maxPixelRatio));
    this.autoQ.onChange = (level, why) => {
      this.applyQuality();
      this.hud.toast(`Calidad gráfica ${why === 'down' ? 'reducida' : 'aumentada'}: ${QUALITY_LABELS[level]}`, 1600);
    };
    this.input = new Input(
      $('joy-zone'),
      $('joy-base'),
      $('joy-knob'),
      $('btn-boost'),
      $('btn-fire'),
      canvas,
      $('btn-missile'),
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

    this.season = new Season(this.progress, {
      onTier: (tier, r) => {
        this.hud.achievement(`Pase nivel ${tier}`, 0);
        this.hud.toast(`Pase de temporada · nivel ${tier}: ${r.label}`, 2200);
        this.audio.gate(true);
      },
      onMission: (m) => this.hud.toast(`Misión cumplida: ${m.text} · +${m.xp} XP`, 2200),
    });
    this.progress.onStats = () => this.season?.checkMissions();
    this.progress.onEarn = (n) => this.season?.addXp(n);
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
    if (this.progress.welcomeGranted) {
      // El HUD no se ve en el menú: aviso en la portada
      const gift = document.createElement('p');
      gift.className = 'gift-note';
      gift.textContent = `🎁 Regalo: +${WELCOME_CREDITS} créditos para estrenar aviones en el hangar`;
      $('btn-play').before(gift);
      setTimeout(() => gift.remove(), 15000);
    }

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
    this.chunks = new ChunkManager(this.scene, this.gen, this.gfx.radius);
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
    this.fx.high = this.gfx.fxHigh;
    this.guns = new Guns(this.scene, this.gen, this.fx);
    this.drones = new Drones(this.scene, this.gen, 14);
    this.stunts = new Stunts(this.gen, {
      onTrick: (name, pts, mult) => {
        if (mult >= 2) this.audio.hitMarker();
        void name;
        void pts;
      },
      onBank: (pts, mult) => {
        this.progress.add('stuntPoints', pts);
        this.progress.max('bestCombo', mult);
        this.earn(Math.floor(pts / 50));
        if (pts >= 100) this.hud.toast(`Combo ×${mult} · +${pts} de estilo`, 1400);
      },
      onLost: (pts) => {
        if (pts > 0) this.hud.toast(`Combo perdido (${pts})`, 1200);
      },
    });
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
    this.clearGhosts();
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
    this.endModes();
  }

  /** Limpia los modos especiales (mensajero, rey del cielo, oleadas) */
  private endModes() {
    this.delivery?.dispose();
    this.delivery = null;
    this.cityEvents?.dispose();
    this.cityEvents = null;
    this.endEditor();
    this.stopSpectating();
    this.hud.bossBar(null);
    show('chat-wheel', false);
    this.zone?.dispose();
    this.zone = null;
    this.waveChoosing = false;
    show('upgrades', false);
    this.hud.banner(null);
    this.hud.combo(null);
  }

  /** Aplica avión, pintura y mejoras elegidos en el hangar */
  applyLoadout() {
    const pr = this.progress;
    const mods = pr.modifiers;
    const paint = pr.paint;
    const visible = this.jet.group.visible;
    this.scene.remove(this.jet.group);
    // En multijugador el avión lleva el color elegido en la sala (igual que lo ven los demás)
    const mp = this.room?.players.get(this.room.uid);
    this.jet = mp ? new JetModel(mp.color, bodyTint(mp.color), pr.p.plane) : new JetModel(paint.accent, paint.body, pr.p.plane);
    this.jet.group.visible = visible;
    this.scene.add(this.jet.group);
    this.flight.speedMul = mods.speed;
    this.flight.agility = mods.agility;
    this.maxHp = Math.round(100 * mods.armor);
    if (this.guns) {
      this.guns.maxAmmo = MAX_AMMO + mods.ammoBonus;
      this.guns.ammo = Math.min(this.guns.ammo, this.guns.maxAmmo);
      this.guns.setWeapon(pr.plane.weapon);
    }
    if (this.missiles) this.missiles.max = pr.plane.weapon.missiles;
    // Que los demás vean mi modelo de avión
    if (this.room && mp && mp.plane !== pr.p.plane) void this.room.setProfile({ plane: pr.p.plane });
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
    if (this.spectating) this.stopSpectating();
  }

  // ================================================================ Sesiones
  private resetSession() {
    this.rings.enabled = true;
    this.ringCount = 0;
    this.ringsToMissile = 0;
    this.leashT = 0;
    this.leashTarget = null;
    this.kills = 0;
    this.sessionCredits = 0;
    this.shield = this.doubleDamage = this.turbo = 0;
    this.guns.refill();
    this.missiles.reset();
    this.race?.dispose();
    this.race = null;
    this.clearGhosts();
    this.customCircuit = null;
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
    this.endModes();
    this.stunts.reset();
    this.waveNo = 0;
    this.waveLevels = {};
    this.inFormation = 0;
    this.tagSeq = 0;
    this.season.refresh();
    this.applyLoadout();
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
    this.startCityEvents();
    this.setScreen('playing');
    this.hud.toast('¡Despegue!');
  }

  /** Eventos dinámicos de la ciudad (vuelo libre en solitario) */
  private startCityEvents() {
    this.cityEvents = new CityEvents(this.scene, this.gen, this.fx, {
      toast: (t, ms) => this.hud.toast(t, ms),
      reward: (credits, completed) => {
        if (credits) this.earn(credits);
        if (completed) {
          this.progress.add('cityEvents');
          this.stunts.trick('Evento', 300);
          this.recorder.highlight('Evento completado');
        }
      },
      damage: (amount) => {
        if (!this.alive || this.invuln > 0) return;
        this.fx.hit(this.flight.pos, this.myTarget.vel);
        this.audio.damaged();
        this.rig.addShake(5);
        this.hud.toast('¡Rayo!', 900);
        this.takeDamage(amount, undefined, true);
      },
      weather: (kind) => {
        if (kind) {
          this.prevWeather = this.weather.kind;
          this.weather.set(kind);
        } else this.weather.set(this.prevWeather);
      },
      sound: (k) => {
        if (k === 'start') this.audio.countdown(true);
        else if (k === 'pickup') this.audio.ring();
        else if (k === 'thunder') this.audio.thunder(0.1);
        else if (k === 'win') this.audio.gate(true);
        else this.audio.empty();
      },
    });
  }

  /** Carrera contrarreloj (solo o multijugador) */
  startRace(def: CourseDef, gridIndex = 0, gridSize = 1, goAt?: number, daily?: string, custom?: Circuit) {
    this.audio.init();
    if (custom && custom.stage !== this.stage.id) this.loadStage(getStage(custom.stage));
    this.mode = 'race';
    this.courseDef = def;
    this.resetSession();
    this.customCircuit = custom ?? null;
    this.isDaily = !!daily;
    this.dailyKey = daily ?? '';
    this.drones.setActive(false);
    this.rings.enabled = false;
    this.rings.respawnAll([]);
    this.powerups.setEnabled(false, []);
    const course = custom ? circuitCourse(custom) : buildCourse(this.gen, def);
    this.race = new Race(this.scene, course);
    if (this.settings.ghost && !this.room) {
      const g = loadGhost(course.id);
      if (g) this.ghost = new GhostPlayer(this.scene, g);
      this.loadWorldGhost(course.id);
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

  private clearGhosts() {
    this.wgToken++;
    this.ghost?.dispose();
    this.ghost = null;
    this.worldGhost?.dispose();
    this.worldGhost = null;
  }

  /** Fantasma del récord mundial (Firestore), en dorado */
  private loadWorldGhost(id: string) {
    if (!firebase.enabled) return;
    const token = ++this.wgToken;
    Promise.all([firebase.worldGhost(id), firebase.uid()])
      .then(([g, uid]) => {
        if (token !== this.wgToken || !g || !this.race || this.race.course.id !== id) return;
        if (g.uid === uid && this.ghost) return; // el récord es mío: ya está mi fantasma
        const data = JSON.parse(g.f) as GhostData;
        if (data.v !== 1 || !Array.isArray(data.f)) return;
        this.worldGhost = new GhostPlayer(this.scene, data, 0xffd040, 0xb08a30);
        this.hud.toast(`Fantasma dorado: récord mundial de ${g.name} · ${formatTime(g.timeMs / 1000)}`, 2600);
      })
      .catch(() => undefined);
  }

  startDaily(variant: DailyVariant = this.dailyVariant) {
    this.dailyVariant = variant;
    store.set('dailyVariant', variant);
    const d = dailyChallenge(new Date(), variant);
    if (d.stage.id !== this.stage.id) this.loadStage(d.stage);
    this.startRace(d.def, 0, 1, undefined, d.key);
    this.hud.toast(`Desafío diario · ${variant === 'night' ? 'de noche' : 'de día'} · ${d.stage.name}`, 1800);
  }

  /** Mejor tiempo de hoy en el desafío (día, noche o el mejor de los dos) */
  private dailyBest(variant?: DailyVariant) {
    const daily = this.progress.p.daily;
    const day = daily[dailyChallenge(new Date(), 'day').key];
    const night = daily[dailyChallenge(new Date(), 'night').key];
    if (variant === 'day') return day;
    if (variant === 'night') return night;
    const both = [day, night].filter((x): x is number => x !== undefined);
    return both.length ? Math.min(...both) : undefined;
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

  /** Mensajero urbano */
  startDelivery() {
    this.audio.init();
    this.mode = 'delivery';
    this.resetSession();
    this.drones.setActive(false);
    this.spawnAt(new THREE.Vector3(0, this.safeAltitude(0, 0), 0), Math.random() * Math.PI * 2);
    this.rings.respawnAll(this.chunks.loaded());
    this.powerups.setEnabled(true, this.chunks.loaded());
    this.delivery = new Delivery(this.scene, this.gen);
    this.delivery.start(this.flight.pos);
    this.setScreen('playing');
    this.hud.toast('Recoge el paquete en la azotea verde', 2200);
  }

  /** Oleadas: sobrevive y mejora tu avión entre oleadas */
  startWaves() {
    this.audio.init();
    this.mode = 'waves';
    this.resetSession();
    this.drones.setActive(false);
    this.spawnAt(new THREE.Vector3(0, this.safeAltitude(0, 0), 0), Math.random() * Math.PI * 2);
    this.rings.respawnAll(this.chunks.loaded());
    this.powerups.setEnabled(true, this.chunks.loaded());
    this.setScreen('playing');
    this.nextWave();
  }

  private nextWave() {
    this.waveNo++;
    const plan = wavePlan(this.waveNo);
    for (const bot of this.bots) bot.dispose();
    this.bots = [];
    const f = this.flight;
    this.drones.spawnWave(plan.drones, f.pos, f.forward(), plan.droneHp);
    const specs = makeBotSpecs(plan.bots, () => null);
    for (const s of specs) {
      const bot = new Bot(s, this.scene, this.gen, this.fx, plan.botSkill);
      bot.spawn(f.pos.clone().setY(0), 1500);
      this.bots.push(bot);
    }
    this.hud.countdown(`Oleada ${this.waveNo}`);
    setTimeout(() => this.hud.countdown(null), 1400);
    this.audio.countdown(true);
  }

  private updateWaves(dt: number) {
    if (this.waveChoosing) return;
    for (const bot of this.bots) {
      if (!bot.alive) {
        bot.update(dt, this.time, [], this.flight.pos, this.missiles, () => undefined);
        continue;
      }
      const crashed = bot.update(dt, this.time, this.alive ? [this.myTarget] : [], this.flight.pos, this.missiles, (t, dmg) => this.botHit(bot.spec.id, t, dmg));
      if (crashed) this.botCrash(bot.spec.id);
    }
    const left = this.drones.aliveCount + this.bots.filter((b) => b.alive).length;
    this.hud.battleScore(`Oleada ${this.waveNo} · quedan ${left}`, `${this.kills}✕`);
    if (left === 0 && this.alive) {
      this.progress.max('wavesBest', this.waveNo);
      this.earn(30 * this.waveNo);
      this.showUpgrades();
    }
    // Mejoras con efecto continuo
    const lv = this.waveLevels;
    if (lv.regen && this.alive) this.hp = Math.min(this.maxHp, this.hp + 2 * lv.regen * dt);
    if (lv.ammo) this.guns.reload(4 * lv.ammo * dt);
    if (lv.shield) {
      this.shieldPulseT += dt;
      if (this.shieldPulseT >= 20) {
        this.shieldPulseT = 0;
        this.shield = Math.max(this.shield, 4);
      }
    }
  }

  private showUpgrades() {
    this.waveChoosing = true;
    this.input.reset();
    const picks = pickUpgrades(this.waveLevels);
    $('up-title').textContent = `¡Oleada ${this.waveNo} superada!`;
    $('up-list').replaceChildren(
      ...picks.map((u) => {
        const b = document.createElement('button');
        b.className = 'up-card';
        const lvl = this.waveLevels[u.key] ?? 0;
        b.innerHTML = `<b></b><span></span><small>Nivel ${lvl + 1}/${u.max}</small>`;
        (b.querySelector('b') as HTMLElement).textContent = u.name;
        (b.querySelector('span') as HTMLElement).textContent = u.description;
        b.addEventListener('click', () => this.chooseUpgrade(u));
        return b;
      }),
    );
    show('upgrades', true);
  }

  private chooseUpgrade(u: WaveUpgrade) {
    const lv = (this.waveLevels[u.key] ?? 0) + 1;
    this.waveLevels[u.key] = lv;
    switch (u.key) {
      case 'armor':
        this.maxHp = Math.round(this.maxHp * 1.25);
        this.hp = this.maxHp;
        break;
      case 'missiles':
        this.missiles.max += 2;
        this.missiles.addMissiles(2);
        break;
      case 'speed':
        this.flight.speedMul *= 1.08;
        break;
      case 'ammo':
        this.guns.maxAmmo += 80;
        this.guns.refill();
        break;
    }
    this.applyWaveWeapon();
    show('upgrades', false);
    this.waveChoosing = false;
    this.timer.update();
    this.hud.toast(`${u.name} · nivel ${lv}`, 1400);
    this.nextWave();
  }

  /** Arma con las mejoras de oleadas (cadencia y puntería) */
  private applyWaveWeapon() {
    const base = this.progress.plane.weapon;
    const lv = this.waveLevels;
    this.guns.setWeapon({
      ...base,
      fireRate: base.fireRate * Math.pow(1.2, lv.rate ?? 0),
      cone: base.cone + 6 * (lv.aim ?? 0),
      lockRange: base.lockRange + 300 * (lv.aim ?? 0),
    });
  }

  /** Resumen final de Mensajero u Oleadas */
  private finishSummary() {
    this.screen = 'results';
    const d = this.delivery;
    if (this.mode === 'delivery' && d) {
      const key = 'best.delivery';
      const prev = Number(store.get(key) ?? 0);
      if (d.score > prev) store.set(key, String(d.score));
      $('sum-title').textContent = d.over ? '¡Se acabó el tiempo!' : 'Fin del reparto';
      $('sum-big').textContent = `${d.score}`;
      $('sum-unit').textContent = 'puntos';
      $('sum-rows').innerHTML = `<li><span>Entregas</span><b>${d.delivered}</b></li><li><span>Récord</span><b>${Math.max(prev, d.score)}</b></li><li><span>Estilo</span><b>${this.stunts.total}</b></li>`;
    } else {
      const key = 'best.waves';
      const prev = Number(store.get(key) ?? 0);
      const reached = Math.max(0, this.waveNo - (this.alive ? 0 : 1));
      if (reached > prev) store.set(key, String(reached));
      $('sum-title').textContent = 'Has caído';
      $('sum-big').textContent = `${reached}`;
      $('sum-unit').textContent = reached === 1 ? 'oleada superada' : 'oleadas superadas';
      $('sum-rows').innerHTML = `<li><span>Derribos</span><b>${this.kills}</b></li><li><span>Récord</span><b>${Math.max(prev, reached)} oleadas</b></li><li><span>Estilo</span><b>${this.stunts.total}</b></li>`;
    }
    $('sum-credits').textContent = `+${this.sessionCredits} créditos`;
    show('btn-sum-replay', this.recorder.hasContent);
    setTimeout(() => {
      if (this.screen === 'results' && !this.replaying) this.setScreen('results');
    }, 1300);
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
    const humanTeam = (t?: Team): Team | null => (config.kind === 'coop' || config.kind === 'boss' ? 'A' : config.kind === 'teams' ? (t ?? 'A') : null);
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
      if (config.kind === 'boss') return 'A';
      if (config.kind !== 'coop' && config.kind !== 'teams') return null;
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
    // Semilla común a todos los jugadores (zona del Rey del cielo, quién la lleva al empezar)
    this.zoneSeed = room ? [...room.code].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 100000 + (room.meta?.round ?? 0) : Math.floor(Math.random() * 100000);
    if (config.kind === 'koth') this.zone = new KothZone(this.scene, this.gen);
    if (config.kind === 'royale') this.storm = new StormZone(this.scene, this.zoneSeed, config.timeLimit);
    if (config.kind === 'boss') this.startBoss(humans.length, config.bots);
    if (config.kind === 'tag') {
      const ids = [...b.fighters.keys()].sort();
      b.it = ids[Math.floor(hash2(this.zoneSeed, 1, 3) * ids.length)] ?? null;
      this.tagImmune = 3;
    }
    const pos = this.arenaSpawn();
    this.spawnAt(pos, Math.atan2(pos.x, pos.z));
    this.setScreen('playing');
    this.hud.toast(BATTLE_LABELS[config.kind], 1800);
    if (config.kind === 'tag') setTimeout(() => this.hud.toast(b.it === this.myId ? '¡La llevas tú! Toca a otro avión' : `La lleva ${b.fighters.get(b.it ?? '')?.name ?? '?'}: ¡huye!`, 2200), 1900);
    this.syncMyScore();
  }

  /** Jefe final: crea el dirigible (lo simula el anfitrión o el juego en solitario) */
  private startBoss(humans: number, allies: number) {
    const boss = new Boss(this.scene, this.gen, this.fx, ARENA.clone(), 1 + 0.45 * (humans - 1) + 0.2 * allies);
    boss.authority = !this.room || this.room.isHost;
    this.bossWinAt = 0;
    boss.events = {
      onPartDestroyed: (kind, pos) => {
        this.audio.explosion();
        this.rig.addShake(pos.distanceTo(this.flight.pos) < 600 ? 5 : 2);
        this.recorder.event('explosion', pos, 1.3);
        this.hud.toast(kind === 'turret' ? '¡Torreta destruida!' : kind === 'engine' ? '¡Motor destruido!' : '¡Núcleo destruido!', 1300);
      },
      onPhase: (ph) => {
        this.hud.countdown(`Fase ${ph}`);
        setTimeout(() => this.hud.countdown(null), 1300);
        this.hud.toast(PHASE_LABELS[ph], 2200);
        this.audio.countdown(true);
        if (ph === 2 && boss.authority) this.spawnEscorts(2 + Math.min(3, humans - 1));
      },
      onDefeated: () => {
        this.recorder.highlight('¡Dirigible derribado!');
        this.hud.toast('¡EL DIRIGIBLE CAE!', 2500);
        this.audio.gate(true);
        this.bossWinAt = this.time + 4;
      },
    };
    this.boss = boss;
  }

  /** Fase 2 del jefe: cazas enemigos de escolta */
  private spawnEscorts(n: number) {
    const b = this.battle;
    const boss = this.boss;
    if (!b || !boss) return;
    const used = this.bots.length;
    const specs = makeBotSpecs(used + n, () => 'B').slice(used);
    for (const s of specs) {
      s.name = s.name.replace('Bot', 'Escolta');
      b.add({ id: s.id, name: s.name, team: 'B', color: TEAM_COLORS.B, isBot: true });
      const bot = new Bot(s, this.scene, this.gen, this.fx, 0.6);
      bot.spawn(boss.pos.clone().setY(0), 300);
      this.bots.push(bot);
    }
    this.hud.toast('¡Cazas de escolta en camino!', 1800);
  }

  /** Daño al dirigible (solo quien lo simula) */
  private damageBoss(partId: string, dmg: number, shooter: string) {
    const boss = this.boss;
    if (!boss) return;
    if (!boss.authority) return;
    const applied = boss.damage(partId, dmg);
    if (applied > 0 && this.battle && (shooter === this.myId || shooter.startsWith('bot'))) this.battle.addPoints(shooter, applied);
  }

  private updateBoss(dt: number) {
    const boss = this.boss!;
    // Si el anfitrión se va, el nuevo anfitrión pasa a simular el dirigible
    if (this.room && this.room.isHost && !boss.authority) boss.authority = true;
    const b = this.battle!;
    const enemies: Target[] = [];
    if (this.alive) enemies.push(this.myTarget);
    for (const t of this.remotes.targets()) if (t.alive && !t.id.startsWith('bot')) enemies.push(t);
    for (const bot of this.bots) if (bot.alive && bot.spec.team === 'A') enemies.push(bot.target);
    boss.update(dt, this.time, enemies, this.missiles, (t, dmg) => this.botHit('botboss', t, dmg));
    if (this.bossWinAt && this.time >= this.bossWinAt) b.bossOutcome = 'win';
    this.hud.bossBar(`Dirigible · ${boss.phaseLabel()}`, boss.defeated ? 0 : boss.phaseHealth());
    // Choque contra el casco
    if (this.alive && this.invuln <= 0 && boss.hits(this.flight.pos)) {
      this.destroy();
      this.hud.toast('¡Te has estrellado contra el dirigible!', 2000);
    }
  }

  /** Supervivencia: la tormenta se cierra y hace daño fuera de la zona */
  private stormHurtT = 0;
  private updateStorm(dt: number) {
    const st = this.storm!;
    const b = this.battle!;
    const t = Math.max(0, b.elapsed);
    st.update(t, this.time);
    const dps = st.damageAt(t);
    const out = st.outside(this.flight.pos);
    if (this.alive && out > 0 && !b.finished) {
      this.hp -= dps * dt;
      this.stormHurtT -= dt;
      if (this.stormHurtT <= 0) {
        this.stormHurtT = 0.8;
        this.hud.damageFlash();
        Haptic.hitTaken();
      }
      if (this.hp <= 0) {
        this.destroy();
        this.hud.toast('La tormenta te ha derribado', 2000);
      }
    }
    for (const bot of this.bots) {
      if (!bot.alive || st.outside(bot.flight.pos) <= 0) continue;
      bot.hp -= dps * dt;
      if (bot.hp <= 0) this.botCrash(bot.spec.id);
    }
    const left = b.survivors.length;
    const grace = st.graceLeft(t);
    if (!this.alive) return;
    if (out > 0) this.hud.banner(`¡FUERA DE LA ZONA! −${Math.round(dps)}/s · sigue la flecha violeta`, 'bad');
    else if (grace > 0) this.hud.banner(`La tormenta empieza a cerrarse en ${Math.ceil(grace)} s · quedan ${left}`, 'info');
    else this.hud.banner(`Zona segura ${Math.round(st.radius)} m · quedan ${left}`, out > -200 ? 'warn' : 'info');
  }

  // ---------------------------------------------------------------- Espectador
  private startSpectating() {
    this.spectating = null;
    this.nextSpectate();
  }

  private stopSpectating() {
    if (!this.spectating && $('spectate').classList.contains('hidden')) return;
    this.spectating = null;
    this.hud.spectate(null);
    this.rig.snap();
  }

  /** Pasa al siguiente avión vivo */
  private nextSpectate() {
    const list = [...this.remotes.targets(), ...this.bots.map((x) => x.target)].filter((t) => t.alive);
    if (!list.length) {
      this.spectating = null;
      this.hud.spectate('nadie en pie');
      return;
    }
    const i = list.findIndex((t) => t.id === this.spectating);
    const next = list[(i + 1) % list.length];
    this.spectating = next.id;
    this.hud.spectate(this.pilotInfo(next.id).name);
    this.rig.snap();
  }

  /** Vuelo del avión al que se sigue como espectador */
  private spectateFlight(): Flight | null {
    if (!this.spectating) return null;
    const bot = this.bots.find((x) => x.spec.id === this.spectating);
    if (bot?.alive) return bot.flight;
    const r = this.remotes.get(this.spectating);
    if (r?.alive && r.buffer.length) return r.flight;
    this.nextSpectate();
    return null;
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
    this.storm?.dispose();
    this.storm = null;
    if (this.boss) {
      this.boss.dispose();
      this.boss = null;
      if (this.room?.isHost) this.room.sendBoss(null);
    }
    this.hud.bossBar(null);
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
    show('summary', s === 'results' && (this.mode === 'delivery' || this.mode === 'waves'));
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
      this.clearGhosts();
      this.endBattle();
      this.endModes();
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
    show('btn-chat', !!this.room && s === 'playing');
    show('btn-talk', !!this.room && s === 'playing');
    if (s !== 'playing') this.toggleChat(false);
    if (s === 'menu' && this.cloud.enabled) void this.cloud.save(this.pilotName(), () => this.progress.flush(), false);
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

    this.stunts.crash();
    if (this.mode === 'waves') {
      this.finishSummary();
    } else if (this.mode === 'free' && !this.room) {
      this.screen = 'crashed';
      this.crashTimer = 0;
      this.fillCrashPanel();
    } else if (this.battle?.config.kind === 'royale') {
      // Supervivencia: una sola vida → espectador
      this.respawnTimer = Infinity;
      this.hud.banner(null);
      setTimeout(() => {
        if (this.battle?.config.kind === 'royale' && !this.alive && this.screen === 'playing') {
          this.startSpectating();
          this.hud.toast('Has caído. Modo espectador', 2000);
        }
      }, 1500);
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
    this.stunts.crash();
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
    if (this.mode === 'waves') return [...this.drones.list, ...this.bots.map((b) => b.target)];
    if (this.battle?.config.kind === 'tag') return [];
    if (this.battle) {
      const b = this.battle;
      const list: Target[] = [...this.remotes.targets(), ...this.bots.map((x) => x.target)];
      const enemies = list.filter((t) => b.enemies(this.myId, t.id));
      return this.boss ? [...enemies, ...this.boss.targets()] : enemies;
    }
    // Vuelo libre en equipo: sin fuego amigo
    if (this.room) return [];
    const evt = this.cityEvents?.targets() ?? [];
    return this.drones.active ? [...this.drones.list, ...evt] : evt;
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
    if (t.id.startsWith('boss-')) {
      this.hud.hitMarker(false);
      if (this.boss?.authority) this.damageBoss(t.id, dmg, this.myId);
      else if (this.room?.meta) {
        this.room.sendEvent(this.room.meta.host, 'bhit', dmg, `bot:${t.id}`);
        this.battle?.addPoints(this.myId, dmg);
      }
      return;
    }
    if (t.id.startsWith('evt-')) {
      const destroyed = this.cityEvents?.damage(t.id, dmg) ?? false;
      this.hud.hitMarker(destroyed);
      if (destroyed) {
        this.kills++;
        this.audio.explosion();
        this.earn(20);
        this.stunts.trick('Saqueador abatido', 120);
        this.hud.toast('¡Saqueador abatido!', 1000);
      }
      return;
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
        this.stunts.trick('Dron derribado', 80);
        if (this.waveLevels.vampire) this.hp = Math.min(this.maxHp, this.hp + 15 * this.waveLevels.vampire);
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
    if (!b) {
      if (shooter === this.myId) this.onMyKill(bot.spec.name);
      return;
    }
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
    this.stunts.trick('Derribo', 150);
    if (this.waveLevels.vampire) this.hp = Math.min(this.maxHp, this.hp + 15 * this.waveLevels.vampire);
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
    if (me) this.room.setScore(this.myId, this.battle.syncValue(this.myId), me.deaths);
  }

  private syncBotScores() {
    if (!this.room?.isHost || !this.battle) return;
    for (const bot of this.bots) {
      const f = this.battle.fighters.get(bot.spec.id);
      if (f) this.room.setScore(bot.spec.id, this.battle.syncValue(bot.spec.id), f.deaths);
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
          this.stunts.trick('Esquiva', 200);
          this.hud.toast('¡Misil esquivado!', 1200);
        }
      },
    };
  }

  /** Un bot (simulado aquí) alcanza a t */
  private botHit(botId: string, t: Target, dmg: number) {
    if (t.id.startsWith('boss-')) this.damageBoss(t.id, dmg, botId);
    else if (t.id === this.myId) this.takeDamage(dmg, botId, true);
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
        if (!this.alive) this.hud.toast(`Te ha derribado ${e.b === 'botboss' ? 'el dirigible' : e.b ? (this.battle?.fighters.get(e.b)?.name ?? 'un bot') : from}`, 2200);
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
        if (e.b?.startsWith('bot:boss-')) {
          this.damageBoss(e.b.slice(4), e.v, e.from);
          break;
        }
        const bot = this.bots.find((b) => b.spec.id === e.b);
        if (bot) this.damageBot(bot, e.v, e.from);
        break;
      }
      case 'chat': {
        const p = room?.players.get(e.from);
        const i = Math.max(0, Math.min(QUICK_CHAT.length - 1, Math.round(e.v)));
        this.hud.chat(p?.name ?? 'Piloto', hex(p?.color ?? 0xffffff), `${CHAT_ICONS[i]} ${QUICK_CHAT[i]}`);
        this.audio.hitMarker();
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
      sm: this.inFormation > 0 ? 1 : 0,
    });
    if (this.room.isHost && this.boss && this.screen === 'playing') this.room.sendBoss(this.boss.netState());
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
    const rawDt = this.timer.getDelta();
    const dt = Math.min(rawDt, 0.05);
    if (this.settings.quality === 'auto' && this.screen === 'playing' && !this.paused && !this.replaying) this.autoQ.sample(rawDt);
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

    if (this.screen === 'playing' && !(this.paused && !this.room) && !this.waveChoosing) this.updatePlaying(dt);
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
        if (p.smoke && p.alive && Math.random() < 0.7) this.fx.formationSmoke(p.target.pos, p.target.vel.clone().normalize().negate(), p.info.color);
      }
      if (this.screen === 'lobby' || this.screen === 'results') this.sendNetState();
    }

    const frozen = (this.paused && !this.room) || this.waveChoosing;
    if (!frozen) {
      this.fx.update(dt);
      this.drones.update(dt, this.flight.pos, this.flight.forward(), this.time);
      if (this.screen !== 'playing') this.guns.update(dt, this.gunContext(false));
      if (this.screen !== 'playing') this.missiles.update(dt, this.missileContext());
      const speedFactor = THREE.MathUtils.clamp((this.flight.speedKmh - CRUISE_KMH) / (BOOST_KMH - CRUISE_KMH), 0, 1);
      const spec = this.screen === 'playing' ? this.spectateFlight() : null;
      if (spec) this.rig.update(dt, spec, 0);
      else this.rig.update(this.alive ? dt : dt * 0.15, this.flight, this.alive ? speedFactor : 0);
    }
    this.chatCooldown -= dt;
    this.jet.update(this.flight, this.time);
    if (!(this.screen === 'playing' && this.invuln > 0)) this.jet.group.visible = this.alive && this.rig.mode !== 'cockpit';
    this.contrails.setVisible(this.rig.mode !== 'cockpit');
    if (this.alive && !frozen) this.fx.damageTrail(this.flight.pos, this.hp / this.maxHp, dt);
    if (this.alive && this.shield > 0 && !frozen) this.fx.shieldSpark(this.flight.pos);

    const focus = (this.spectating && this.spectateFlight()?.pos) || this.flight.pos;
    this.chunks.update(focus.x, focus.z);
    this.far.update(focus);
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

    this.lastHudDt = frozen ? 0 : dt;
    if (this.screen === 'playing' || this.screen === 'crashed' || this.screen === 'results') this.updateHud();
    else {
      this.arrow.update(this.flight.pos, 0, null, false);
      this.trail.update(dt, null);
    }

    this.render(dt);
  }

  private render(dt: number) {
    if (this.gfx.bloom) this.composer.render(dt);
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
    this.guns.damageMul = (this.doubleDamage > 0 ? 2 : 1) * (1 + 0.25 * (this.waveLevels.damage ?? 0));
    this.tagImmune = Math.max(0, this.tagImmune - dt);
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

    // Batalla y modos especiales
    if (this.battle) this.updateBattle(dt);
    if (this.mode === 'waves') this.updateWaves(dt);
    this.cityEvents?.update(dt, this.time, f.pos, f.forward(), this.alive);
    if (this.delivery && this.alive) {
      const ev = this.delivery.update(dt, f.pos, this.jet.group.quaternion, this.time);
      if (ev?.type === 'pickup') {
        this.audio.reload();
        Haptic.pickup();
        this.hud.toast('Paquete recogido · llévalo a la azotea naranja', 1800);
      } else if (ev?.type === 'deliver') {
        this.audio.gate(true);
        Haptic.gate();
        this.progress.add('deliveries');
        this.earn(Math.round((ev.reward ?? 0) / 10));
        this.stunts.trick(ev.label ?? 'Entrega', 120);
        this.hud.toast(`${ev.label} · +${ev.reward}${ev.tip ? ` (propina ${ev.tip})` : ''} · +25 s`, 2000);
      } else if (ev?.type === 'timeout') {
        this.audio.explosion();
        this.finishSummary();
      }
    }
    if (this.delivery && !this.delivery.over) {
      const t = Math.max(0, this.delivery.timeLeft);
      this.hud.battleScore(`${this.delivery.state === 'pickup' ? 'Recoge el paquete' : 'Entrega el paquete'} · ${this.delivery.delivered} entregas · ${this.delivery.score} pts`, `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
    }

    // Recompensas y misiles (también muerto, para que sigan su curso)
    const pw = this.powerups.update(dt, this.time, this.alive ? f.pos : null, () => this.chunks.loaded());
    if (pw) this.applyPower(pw);
    this.missiles.update(dt, this.missileContext());

    // Grabación para la repetición
    this.recorder.tick(dt, () => this.sampleActors());

    if (!this.alive) {
      if (this.mode === 'race' || this.mode === 'battle' || this.mode === 'delivery' || this.room) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) this.respawn();
      }
      this.race?.update(dt, f.pos, f.pos, this.time);
      this.guns.update(dt, this.gunContext(false));
      this.sendNetState();
      return;
    }

    // Tirón de emergencia: choque inminente + maniobra brusca hacia arriba → subida acentuada
    this.updatePullUp(dt, input);

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
        if (got.length) this.onRingsCollected(got);
      }
      if (!f.frozen && this.checkCollision()) break;
    }
    if (!this.alive) return;

    // Fantasma
    if (this.race?.started && !this.race.finished) {
      this.ghostRec.record(dt, f);
      this.ghost?.update(this.race.elapsed, this.time);
      this.worldGhost?.update(this.race.elapsed, this.time);
    } else if (this.race && !this.race.started) {
      this.ghost?.update(0, this.time);
      this.worldGhost?.update(0, this.time);
    }

    if (this.battle?.config.kind !== 'tag') this.checkPlayerCollisions();
    this.updateLeash(dt);
    this.updateFormation(dt);
    if (!this.race || this.race.started) this.stunts.update(dt, f);
    const canFire = this.battle?.config.kind !== 'tag';
    this.guns.update(dt, this.gunContext(canFire && !!input.fire && !f.frozen && !this.paused));

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
      // Bengalas automáticas cuando el misil está cerca
      if (to.length() < 450 && this.missiles.myFlareWindow <= 0 && this.missiles.flares > 0) {
        this.fireFlares();
        this.hud.toast('Bengalas automáticas', 900);
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
    // Turbo: chorro de fuego y chispas saliendo de las turbinas
    if ((input.boost || f.burst > 0) && !f.frozen) {
      const back = f.forward().negate();
      for (const n of this.jet.nozzles()) this.fx.afterburner(n, back, this.myTarget.vel);
    }
    const q = this.jet.group.quaternion;
    const tips = this.jet.wingTips.map((t) => t.clone().applyQuaternion(q).add(this.jet.group.position));
    this.jet.update(f, this.time);
    if (!f.frozen) this.contrails.update(tips);
    if (this.invuln > 0) this.jet.group.visible = Math.floor(this.time * 12) % 2 === 0 && this.rig.mode !== 'cockpit';
    this.sendNetState();
  }

  private prevInputY = 0;
  private inputJerk = 0;
  private pullUpShown = false;
  /** Segundos hasta chocar si sigue igual (Infinity si no hay peligro) */
  private timeToImpact() {
    const f = this.flight;
    const fwd = f.forward();
    for (let t = 0.25; t <= 2; t += 0.25) {
      const px = f.pos.x + fwd.x * f.speed * t;
      const py = f.pos.y + fwd.y * f.speed * t;
      const pz = f.pos.z + fwd.z * f.speed * t;
      if (py < Math.max(2, this.gen.maxHeightNear(px, pz, 18)) + 8) return t;
    }
    return Infinity;
  }

  private updatePullUp(dt: number, input: FlightInput) {
    const f = this.flight;
    // Brusquedad: cuánto ha cambiado el mando hacia arriba en muy poco tiempo
    const dy = input.climb ? 1 : input.y;
    const rate = (dy - this.prevInputY) / Math.max(dt, 1e-3);
    this.prevInputY = dy;
    this.inputJerk = Math.max(rate, this.inputJerk - dt * 6);
    const tti = f.frozen || this.mode === 'race' && !this.race?.started ? Infinity : this.timeToImpact();
    const danger = tti < 1.6;
    const abrupt = dy > 0.55 && (dy > 0.85 || this.inputJerk > 3);
    const want = danger && abrupt ? THREE.MathUtils.clamp(1.9 - tti, 0.5, 1) : 0;
    // Entra rápido y sale suave
    f.pullUpAssist += (want - f.pullUpAssist) * Math.min(1, dt * (want > f.pullUpAssist ? 10 : 2.5));
    if (f.pullUpAssist < 0.02) f.pullUpAssist = 0;
    if (want > 0 && !this.pullUpShown) {
      this.pullUpShown = true;
      this.hud.toast('¡Tirón de emergencia!', 900);
      Haptic.bump();
      this.rig.addShake(1.5);
    } else if (f.pullUpAssist === 0) this.pullUpShown = false;
  }

  private updateBattle(dt: number) {
    const b = this.battle!;
    b.elapsed = (this.now() - this.goAt) / 1000;
    // Bots (solo con autoridad)
    const kind = b.config.kind;
    const arena = this.storm ? this.storm.center : this.boss ? this.boss.pos.clone().setY(0) : ARENA;
    for (const bot of this.bots) {
      if (!bot.alive) {
        bot.respawn -= dt;
        const respawns = kind !== 'royale' && !(kind === 'boss' && bot.spec.team === 'B');
        if (bot.respawn <= 0 && !b.finished && respawns) bot.spawn(ARENA, 1400);
        bot.update(dt, this.time, [], arena, this.missiles, () => undefined);
        continue;
      }
      const enemies: Target[] = [];
      if (b.enemies(bot.spec.id, this.myId) && this.alive) enemies.push(this.myTarget);
      for (const t of this.remotes.targets()) if (b.enemies(bot.spec.id, t.id)) enemies.push(t);
      for (const o of this.bots) if (o !== bot && o.alive && b.enemies(bot.spec.id, o.spec.id)) enemies.push(o.target);
      if (this.boss && bot.spec.team === 'A') enemies.push(...this.boss.targets());
      const opts = this.botModeOpts(bot.spec.id, enemies);
      const crashed = bot.update(dt, this.time, opts.targets, arena, this.missiles, (t, dmg) => this.botHit(bot.spec.id, t, dmg), opts);
      if (crashed) this.botCrash(bot.spec.id);
    }
    if (this.storm) this.updateStorm(dt);
    if (this.boss) this.updateBoss(dt);
    if (this.room) for (const [id, sc] of this.room.scores) if (id !== this.myId) b.setScore(id, sc.k, sc.d);
    if (b.config.kind === 'koth') this.updateKoth(dt);
    if (b.config.kind === 'tag') this.updateTag(dt);
    this.scoreSyncT -= dt;
    if (this.scoreSyncT <= 0 && b.pointsMode) {
      this.scoreSyncT = 1;
      this.syncMyScore();
      this.syncBotScores();
    }
    const mins = Math.floor(b.timeLeft / 60);
    const secs = Math.floor(b.timeLeft % 60);
    this.hud.battleScore(b.scoreLine(), `${mins}:${String(secs).padStart(2, '0')}`);
    const res = b.check();
    if (res) this.onBattleFinished(res);
  }

  /** Objetivos y comportamiento de un bot según el modo de batalla */
  private botModeOpts(id: string, enemies: Target[]): { targets: Target[]; goal?: THREE.Vector3; flee?: THREE.Vector3; noFire?: boolean; chase?: boolean } {
    const b = this.battle!;
    if (b.config.kind === 'koth' && this.zone) return { targets: enemies, goal: this.zone.center };
    if (b.config.kind === 'royale' && this.storm) {
      const bot = this.bots.find((x) => x.spec.id === id);
      const st = this.storm;
      const near = bot ? st.outside(bot.flight.pos) > -st.radius * 0.3 : false;
      return { targets: enemies, goal: near ? st.center.clone().setY(bot!.flight.pos.y) : undefined };
    }
    if (b.config.kind === 'tag') {
      const all = this.allPlanes().filter((p) => p.id !== id && p.alive);
      if (b.it === id) {
        const ok = all.filter((p) => p.id !== this.lastTagger || this.time >= this.lastTaggerUntil);
        // Preferir pilotos humanos cercanos (es más divertido que perseguirse entre bots)
        const bot = this.bots.find((x) => x.spec.id === id);
        const humans = ok.filter((p) => !p.id.startsWith('bot') && (!bot || p.pos.distanceTo(bot.flight.pos) < 3000));
        return { targets: humans.length ? humans : ok, noFire: true, chase: true };
      }
      const it = all.find((p) => p.id === b.it);
      return { targets: [], flee: it?.pos, noFire: true };
    }
    return { targets: enemies };
  }

  /** Todos los aviones de la partida (yo, remotos y bots locales) */
  private allPlanes(): Target[] {
    const me = this.alive ? [this.myTarget] : [];
    return [...me, ...this.remotes.targets(), ...this.bots.map((x) => x.target)];
  }

  /** Rey del cielo: puntos por estar solo dentro de la zona */
  private updateKoth(dt: number) {
    const b = this.battle!;
    const z = this.zone!;
    z.update(dt, Math.max(0, b.elapsed), this.zoneSeed, this.time);
    const inside = this.allPlanes().filter((p) => p.alive && z.contains(p.pos));
    const meIn = inside.some((p) => p.id === this.myId);
    if (inside.length === 1) {
      const owner = inside[0].id;
      // cada uno suma lo suyo; el anfitrión (o el juego en solitario) suma a sus bots
      if (owner === this.myId) b.addPoints(this.myId, dt);
      else if (this.bots.some((x) => x.spec.id === owner)) b.addPoints(owner, dt);
      z.status = owner === this.myId ? 'mine' : 'enemy';
    } else z.status = inside.length > 1 ? 'contested' : 'free';
    const t = Math.ceil(z.timeToMove(Math.max(0, b.elapsed)));
    this.hud.banner(
      meIn ? (inside.length > 1 ? `ZONA DISPUTADA · se mueve en ${t} s` : `¡ZONA TUYA! +1/s · se mueve en ${t} s`) : `Ve a la zona dorada · se mueve en ${t} s`,
      meIn && inside.length === 1 ? 'good' : inside.length > 1 && meIn ? 'warn' : 'info',
    );
  }

  /** Pilla-pilla: quien la lleva pasa el testigo al tocar a otro avión */
  private updateTag(dt: number) {
    const b = this.battle!;
    const it = b.it;
    // Puntos: segundos sin llevarla
    if (this.alive && it !== this.myId) {
      b.addPoints(this.myId, dt);
      this.tagFreeAcc += dt;
      if (this.tagFreeAcc >= 1) {
        this.tagFreeAcc -= 1;
        this.progress.add('tagFree', 1);
      }
    }
    for (const bot of this.bots) if (bot.alive && bot.spec.id !== it) b.addPoints(bot.spec.id, dt);
    // ¿Quién toca a quién? Solo decide quien controla al que la lleva (yo, o el anfitrión con sus bots)
    const controlsIt = it === this.myId || (it !== null && this.bots.some((x) => x.spec.id === it));
    if (controlsIt && this.tagImmune <= 0) {
      const holder = this.allPlanes().find((p) => p.id === it);
      if (holder) {
        for (const p of this.allPlanes()) {
          if (p.id === it || !p.alive || (p.id === this.lastTagger && this.time < this.lastTaggerUntil)) continue;
          if (p.pos.distanceTo(holder.pos) < 24) {
            this.passTag(p.id, it!);
            break;
          }
        }
      }
    }
    this.flight.speedMul = this.progress.modifiers.speed * (it === this.myId ? 1.1 : 1);
    const holderName = b.fighters.get(it ?? '')?.name ?? '?';
    this.hud.banner(it === this.myId ? '¡LA LLEVAS! Toca a otro avión' : `La lleva ${holderName} · ¡huye!`, it === this.myId ? 'bad' : 'info');
  }

  private passTag(to: string, from: string) {
    const b = this.battle!;
    b.it = to;
    this.lastTagger = from;
    this.lastTaggerUntil = this.time + 6;
    this.tagImmune = 2.5;
    this.tagSeq++;
    this.room?.setTagIt(to, this.tagSeq);
    this.onTagChanged(to, from);
  }

  private onTagChanged(to: string, from: string | null) {
    const b = this.battle;
    if (!b) return;
    const name = b.fighters.get(to)?.name ?? '?';
    this.audio.gate(to !== this.myId);
    Haptic.bump();
    if (to === this.myId) this.hud.toast(`¡Te ha pillado ${b.fighters.get(from ?? '')?.name ?? 'alguien'}!`, 1600);
    else this.hud.toast(`¡La lleva ${name}!`, 1200);
    this.fx.sparks(this.allPlanes().find((p) => p.id === to)?.pos ?? this.flight.pos, null, 30, 60);
  }

  /** Vuelo en formación: cerca de un compañero, mismo rumbo y velocidad → humo de colores */
  private updateFormation(dt: number) {
    this.inFormation = 0;
    const coop = this.room && (this.mode === 'free' || (this.battle && ['teams', 'coop', 'boss'].includes(this.battle.config.kind)));
    if (!coop || !this.alive) {
      this.hud.formation(0);
      return;
    }
    const f = this.flight;
    const fwd = f.forward();
    for (const p of this.remotes.map.values()) {
      if (!p.alive || !p.buffer.length || p.uid.startsWith('bot')) continue;
      if (this.battle && this.battle.enemies(this.myId, p.uid)) continue;
      const d = p.target.pos.distanceTo(f.pos);
      if (d < 18 || d > 120) continue;
      const pf = p.target.vel.clone().normalize();
      if (pf.dot(fwd) < 0.9) continue;
      const ratio = p.target.vel.length() / Math.max(1, f.speed);
      if (ratio < 0.75 || ratio > 1.33) continue;
      this.inFormation++;
    }
    this.hud.formation(this.inFormation);
    if (!this.inFormation) return;
    const color = this.room?.myColor ?? 0xffffff;
    if (Math.random() < (this.gfx.fxHigh ? 0.9 : 0.5)) this.fx.formationSmoke(f.pos, fwd.clone().negate(), color);
    this.formationAcc += dt;
    if (this.formationAcc >= 1) {
      this.formationAcc -= 1;
      this.progress.add('formationTime', 1);
      this.earn(2 * this.inFormation);
      this.stunts.trick('Formación', 40 * this.inFormation);
    }
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

  private onRingsCollected(got: RingPickup[]) {
    Haptic.pickup();
    let value = 0;
    const msgs: string[] = [];
    for (const g of got) {
      const info = RING_INFO[g.kind];
      value += info.value;
      switch (g.kind) {
        case 'ammo':
          this.guns.refill();
          break;
        case 'repair':
          this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25);
          break;
        case 'missile':
          this.missiles.addMissiles(1);
          break;
        case 'turbo':
          this.flight.burst = 3;
          this.audio.boostRing();
          break;
        default:
          this.guns.reload(40);
      }
      if (g.kind !== 'normal') msgs.push(info.label);
      if (g.kind === 'gold' || g.kind === 'sea') this.fx.sparks(this.flight.pos, null, 40, 70);
      if (g.kind === 'sea') this.progress.add('seaRings');
      this.stunts.trick(this.flight.speedKmh > 1200 ? 'Aro supersónico' : g.kind === 'sea' ? 'Aro marino' : 'Aro', this.flight.speedKmh > 1200 ? 120 : 50);
    }
    this.audio.ring();
    if (this.room) {
      for (const id of this.rings.lastCollected) this.room.claimRing(id);
    } else {
      this.ringCount += value;
    }
    this.progress.add('rings', value);
    this.earn(5 * value);
    // Cada 5 anillos, un misil
    this.ringsToMissile += value;
    let newMissiles = 0;
    while (this.ringsToMissile >= 5) {
      this.ringsToMissile -= 5;
      this.missiles.addMissiles(1);
      newMissiles++;
    }
    if (newMissiles) msgs.push(`+${newMissiles} misil`);
    this.hud.toast(`+${value} ${value === 1 ? 'anillo' : 'anillos'}${msgs.length ? ' · ' + msgs.join(' · ') : ''}`, 1300);
  }

  /** Cooperativo: no alejarse demasiado del escuadrón */
  private updateLeash(dt: number) {
    this.leashTarget = null;
    const coop = this.room && ((this.mode === 'free' && !this.battle) || this.battle?.config.kind === 'coop');
    if (!coop || !this.alive) {
      this.hud.leash(false, 0);
      return;
    }
    let mate: { pos: THREE.Vector3; yaw: number } | null = null;
    let d = Infinity;
    // Ancla: compañero más cercano que entró antes que yo (el primero no se mueve nunca,
    // así dos pilotos separados no se teletransportan a la vez el uno hacia el otro)
    let anchor: { pos: THREE.Vector3; yaw: number } | null = null;
    let da = Infinity;
    const joined = (uid: string) => this.room!.players.get(uid)?.joinedAt ?? Infinity;
    const myJoin = joined(this.room!.uid);
    for (const p of this.remotes.map.values()) {
      if (!p.alive || !p.buffer.length || p.uid.startsWith('bot')) continue;
      const dd = p.target.pos.distanceTo(this.flight.pos);
      const m = { pos: p.target.pos, yaw: new THREE.Euler().setFromQuaternion(p.quat, 'YXZ').y };
      if (dd < d) {
        d = dd;
        mate = m;
      }
      if (joined(p.uid) < myJoin && dd < da) {
        da = dd;
        anchor = m;
      }
    }
    if (!mate) {
      this.hud.leash(false, 0);
      return;
    }
    const warn = d > LEASH_WARN;
    this.hud.leash(warn, d);
    if (warn) this.leashTarget = mate.pos;
    this.leashT = d > LEASH_MAX && anchor ? this.leashT + dt : 0;
    if (this.leashT > 4 && anchor) {
      this.leashT = 0;
      mate = anchor;
      const back = new THREE.Vector3(Math.sin(mate.yaw), 0, Math.cos(mate.yaw)).multiplyScalar(140);
      const pos = mate.pos.clone().add(back);
      pos.y = Math.max(pos.y + 20, this.gen.maxHeightNear(pos.x, pos.z, 120) + 60);
      this.spawnAt(pos, mate.yaw);
      this.hp = Math.min(this.maxHp, Math.max(this.hp, 1));
      this.hud.toast('Reagrupado con el escuadrón', 1600);
    }
  }

  /** Identidad visible de otro piloto o bot */
  private pilotInfo(id: string): { name: string; icon: IconId; color: string; teamColor: string } {
    const room = this.room;
    const p = room?.players.get(id);
    const bot = this.bots.find((b) => b.spec.id === id);
    const remote = this.remotes.get(id);
    const name = p?.name ?? bot?.spec.name ?? remote?.info.name ?? '?';
    const idx = Math.max(0, parseInt(id.replace(/\D/g, ''), 10) || 0);
    const icon: IconId = p?.icon ?? remote?.info.icon ?? ICONS[idx % ICONS.length];
    const color = p?.color ?? bot?.spec.color ?? remote?.info.color ?? 0xffffff;
    const team = this.battle?.teamOf(id);
    const teamColor = team && this.battle?.config.kind === 'teams' ? TEAM_COLORS[team] : color;
    return { name, icon, color: hexColor(color), teamColor: hexColor(teamColor) };
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
      case 'skip': {
        const names = ev.gates.map((g) => (g === 0 ? 'meta' : String(g))).join(', ');
        this.audio.empty();
        Haptic.bump();
        this.hud.penalty(`HITO ${names} SALTADO`, `+${ev.penalty} s`);
        this.routeBest = Infinity;
        this.offRouteT = 0;
        this.hud.offRoute(false);
        break;
      }
      case 'missed':
        this.hud.toast(`Hito ${ev.gate === 0 ? 'de meta' : ev.gate} fallado: vuelve, o sigue al siguiente (+${SKIP_PENALTY} s)`, 2600);
        this.audio.warning();
        break;
      case 'finish':
        this.audio.gate(ev.best);
        this.recorder.highlight('Meta');
        this.onRaceFinished(ev.time, ev.splits, ev.best);
        break;
    }
  }

  // ================================================================ Editor de circuitos
  startEditor(stage: Stage) {
    this.audio.init();
    if (stage.id !== this.stage.id) this.loadStage(stage);
    this.mode = 'editor';
    this.resetSession();
    this.drones.setActive(false);
    this.rings.enabled = false;
    this.rings.respawnAll([]);
    this.powerups.setEnabled(false, []);
    this.editGates = [];
    this.editId = randomCode(8);
    this.savedCircuit = null;
    this.spawnAt(new THREE.Vector3(0, this.safeAltitude(0, 0), 0), Math.random() * Math.PI * 2);
    show('editor-bar', true);
    this.updateEditorBar();
    this.setScreen('playing');
    this.hud.toast('Vuela por la ciudad y pulsa «Colocar hito» en cada punto del recorrido', 3000);
  }

  private endEditor() {
    this.editPreview?.dispose();
    this.editPreview = null;
    show('editor-bar', false);
    show('circuit-save', false);
  }

  private updateEditorBar() {
    const n = this.editGates.length;
    $('ed-count').textContent = `Hitos ${n}/${MAX_GATES}`;
    ($('btn-ed-save') as HTMLButtonElement).disabled = n < MIN_GATES;
    ($('btn-ed-undo') as HTMLButtonElement).disabled = n === 0;
    this.editPreview?.dispose();
    this.editPreview = null;
    if (n) {
      const c: Circuit = { id: this.editId, name: '', stage: this.stage.id, gates: this.editGates, mine: true };
      this.editPreview = new Race(this.scene, circuitCourse(c));
    }
  }

  private placeGate() {
    if (this.mode !== 'editor' || this.screen !== 'playing' || !this.alive || this.paused) return;
    const f = this.flight;
    if (this.editGates.length >= MAX_GATES) {
      this.hud.toast(`Máximo ${MAX_GATES} hitos: guarda el circuito`, 1600);
      return;
    }
    const last = this.editGates[this.editGates.length - 1];
    if (last && Math.hypot(last.x - f.pos.x, last.y - f.pos.y, last.z - f.pos.z) < MIN_GATE_GAP) {
      this.hud.toast(`Aléjate más del hito anterior (mínimo ${MIN_GATE_GAP} m)`, 1600);
      return;
    }
    if (f.pos.y - this.gen.maxHeightNear(f.pos.x, f.pos.z, 70) < 50) {
      this.hud.toast('Demasiado cerca del suelo o de un edificio: sube un poco', 1600);
      return;
    }
    this.editGates.push({ x: f.pos.x, y: f.pos.y, z: f.pos.z, yaw: f.yaw });
    this.updateEditorBar();
    this.audio.gate(true);
    Haptic.gate();
    const n = this.editGates.length;
    this.hud.toast(n === 1 ? 'Salida y meta colocada' : `Hito ${n - 1} colocado`, 1200);
  }

  private undoGate() {
    if (this.mode !== 'editor' || !this.editGates.length) return;
    this.editGates.pop();
    this.updateEditorBar();
    this.hud.toast('Último hito quitado', 900);
  }

  private openSaveCircuit() {
    const g = this.editGates;
    if (g.length < MIN_GATES) {
      this.hud.toast(`Coloca al menos ${MIN_GATES} hitos`, 1400);
      return;
    }
    const a = g[0];
    const b = g[g.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < MIN_GATE_GAP) {
      this.hud.toast('El último hito está demasiado cerca de la meta', 1600);
      return;
    }
    this.paused = true;
    this.input.reset();
    $<HTMLInputElement>('cs-name').value = `Circuito de ${this.pilotName()}`.slice(0, 28);
    show('cs-form', true);
    show('cs-done', false);
    $('cs-title').textContent = 'Guardar circuito';
    show('circuit-save', true);
  }

  private async saveCircuit() {
    const btn = $<HTMLButtonElement>('btn-cs-save');
    const name = $<HTMLInputElement>('cs-name').value.trim().slice(0, 28) || 'Mi circuito';
    const c: Circuit = { id: this.editId, name, stage: this.stage.id, gates: [...this.editGates], mine: true, author: this.pilotName() };
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    let note = '';
    if (firebase.enabled) {
      try {
        const code = randomCode(6);
        await firebase.publishCircuit(code, { author: c.author!, name, stage: c.stage, g: encodeGates(c.gates) });
        c.code = code;
      } catch (e) {
        console.warn(e);
        note = 'No se pudo publicar en Firebase: este código largo funciona igual.';
      }
    } else note = 'Sin Firebase: comparte este código largo (funciona igual).';
    btn.disabled = false;
    btn.textContent = 'Guardar y obtener código';
    upsertCircuit(c);
    this.progress.add('circuitsMade');
    this.savedCircuit = c;
    $('cs-title').textContent = '¡Circuito guardado!';
    $('cs-code').textContent = this.circuitShareCode(c);
    $('cs-code').classList.toggle('long', !c.code);
    $('cs-note').textContent = note;
    show('cs-form', false);
    show('cs-done', true);
  }

  private circuitShareCode(c: Circuit) {
    return c.code ? `${c.code.slice(0, 3)}-${c.code.slice(3)}` : longCode(c);
  }

  private shareCircuitText(c: Circuit) {
    const link = c.code ? `\n${location.origin}/?circuito=${c.code}` : '';
    return `¡Prueba mi circuito «${c.name}» en FalconSky! ✈️\nCódigo: ${this.circuitShareCode(c)}${link}`;
  }

  /** Pantalla «Mis circuitos» */
  private openCircuits() {
    show('play', false);
    $('cc-msg').textContent = '';
    this.renderCircuitList();
    show('circuits', true);
  }

  private renderCircuitList() {
    const list = loadCircuits();
    const ul = $('cc-list');
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Aún no tienes circuitos. ¡Crea el primero!';
      ul.replaceChildren(li);
      return;
    }
    ul.replaceChildren(
      ...list.map((c) => {
        const li = document.createElement('li');
        const info = document.createElement('div');
        info.className = 'cc-info';
        const b = document.createElement('b');
        b.textContent = c.name;
        const sm = document.createElement('small');
        const best = loadBest(circuitCourse(c).id);
        sm.textContent = `${getStage(c.stage).name} · ${c.gates.length - 1} hitos${c.mine ? '' : c.author ? ` · de ${c.author}` : ''}${c.code ? ` · ${c.code.slice(0, 3)}-${c.code.slice(3)}` : ''}${best ? ` · récord ${formatTime(best.time)}` : ''}`;
        info.append(b, sm);
        const run = document.createElement('button');
        run.className = 'primary small';
        run.textContent = 'Correr';
        run.addEventListener('click', () => {
          show('circuits', false);
          this.startRace(COURSES[0], 0, 1, undefined, undefined, c);
        });
        const share = document.createElement('button');
        share.className = 'secondary';
        share.textContent = 'Compartir';
        share.addEventListener('click', () => this.shareCircuit(c));
        const del = document.createElement('button');
        del.className = 'secondary';
        del.textContent = '✕';
        del.setAttribute('aria-label', 'Borrar circuito');
        del.addEventListener('click', () => {
          if (!confirm(`¿Borrar «${c.name}» de este dispositivo?`)) return;
          deleteCircuit(c.id);
          this.renderCircuitList();
        });
        li.append(info, run, share, del);
        return li;
      }),
    );
  }

  private async shareCircuit(c: Circuit) {
    const text = this.shareCircuitText(c);
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'FalconSky', text });
        return;
      } catch {
        /* cancelado */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  /** Carga un circuito por código corto (Firebase) o largo (FS1.…) */
  private async fetchCircuit(raw: string): Promise<Circuit> {
    const txt = raw.trim();
    if (txt.startsWith('FS1.')) {
      const p = parseLongCode(txt);
      if (!p) throw new Error('El código del circuito no es válido.');
      return { id: `l${randomCode(7)}`, name: 'Circuito compartido', stage: p.stage, gates: p.gates, mine: false };
    }
    const code = cleanCode(txt);
    if (code.length !== 6) throw new Error('El código tiene 6 caracteres (o es un código largo que empieza por FS1.).');
    const local = loadCircuits().find((c) => c.code === code);
    if (local) return local;
    if (!firebase.enabled) throw new Error('Los códigos cortos necesitan conexión con Firebase.');
    const sc = await firebase.loadCircuit(code);
    if (!sc) throw new Error(`No existe ningún circuito con el código ${code.slice(0, 3)}-${code.slice(3)}.`);
    const gates = decodeGates(sc.g);
    if (gates.length < MIN_GATES) throw new Error('Ese circuito está dañado.');
    const c: Circuit = { id: `s${code}`, name: sc.name, stage: sc.stage, gates, code, author: sc.author, mine: false };
    upsertCircuit(c);
    return c;
  }

  private async loadCircuitFromInput() {
    const msg = $('cc-msg');
    msg.textContent = 'Buscando circuito…';
    try {
      const c = await this.fetchCircuit($<HTMLInputElement>('cc-code').value);
      msg.textContent = '';
      show('circuits', false);
      this.startRace(COURSES[0], 0, 1, undefined, undefined, c);
    } catch (e) {
      msg.textContent = (e as Error).message || 'No se pudo cargar el circuito.';
    }
  }

  /** Añade mis circuitos publicados a un selector de circuito (salas) */
  private fillCourseSelect(sel: HTMLSelectElement) {
    const keep = sel.value;
    sel.replaceChildren(...COURSES.map((c) => new Option(c.name, c.id)));
    for (const c of loadCircuits()) if (c.code) sel.append(new Option(`★ ${c.name}`, `c:${c.code}`));
    if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }

  // ================================================================ Chat rápido
  private toggleChat(open?: boolean) {
    const el = $('chat-wheel');
    const v = open ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !v);
  }

  private sendChat(i: number) {
    const room = this.room;
    this.toggleChat(false);
    if (!room || this.chatCooldown > 0) return;
    this.chatCooldown = 1.2;
    for (const uid of room.players.keys()) if (uid !== room.uid) room.sendEvent(uid, 'chat', i);
    this.hud.chat(this.pilotName(), hex(room.myColor), `${CHAT_ICONS[i]} ${QUICK_CHAT[i]}`);
  }

  // ================================================================ Mensajes de voz
  /** Tocar: empieza a grabar · tocar otra vez: envía (o se envía solo a los 5 s) */
  private async toggleTalk() {
    const room = this.room;
    if (!room) return;
    this.voicePlayer.unlock();
    if (this.voiceRec.recording) {
      this.voiceRec.stop();
      return;
    }
    if (this.talkPending) return;
    if (!VoiceRecorder.supported) {
      this.hud.toast('Este navegador no permite grabar audio', 1800);
      return;
    }
    if (!room.canTalk()) {
      this.hud.toast(`Espera: está hablando ${room.talk?.n ?? 'otro piloto'}`, 1400);
      return;
    }
    this.talkPending = true;
    this.updateTalkUi();
    try {
      const ok = await room.takeTalk(VOICE_MAX_MS + 3000);
      if (!ok) {
        this.hud.toast(`Espera: está hablando ${room.talk?.n ?? 'otro piloto'}`, 1400);
        return;
      }
      this.voiceRec.onDone = async (clip) => {
        clearInterval(this.talkTimer);
        if (!clip) {
          room.releaseTalk();
          this.hud.toast('Mensaje demasiado corto', 1000);
        } else if (await room.takeTalk(clip.ms + 1500)) {
          // (se vuelve a pedir el turno por si hubiera caducado mientras se grababa)
          room.sendVoice(clip.data, clip.ms);
          // El turno dura lo que tardan los demás en oírlo
          setTimeout(() => {
            if (!this.voiceRec.recording) room.releaseTalk();
          }, clip.ms + 1500);
          this.hud.chat(this.pilotName(), hex(room.myColor), '🎙️ mensaje de voz enviado');
        } else {
          this.hud.toast(`No se ha enviado: ha empezado a hablar ${room.talk?.n ?? 'otro piloto'}`, 1800);
        }
        this.updateTalkUi();
      };
      try {
        await this.voiceRec.start();
      } catch {
        room.releaseTalk();
        this.hud.toast('Permite el micrófono en el navegador para hablar', 2200);
        return;
      }
      Haptic.pickup();
      clearInterval(this.talkTimer);
      this.talkTimer = window.setInterval(() => this.updateTalkUi(), 100);
    } finally {
      this.talkPending = false;
      this.updateTalkUi();
    }
  }

  /** Estado de los botones HABLAR (grabando, libre u ocupado por otro) */
  private updateTalkUi() {
    const room = this.room;
    const rec = this.voiceRec.recording;
    const other = room && !room.canTalk() ? room.talk : null;
    const left = rec ? Math.max(0, VOICE_MAX_MS - (performance.now() - this.voiceRec.startedAt)) : 0;
    for (const id of ['btn-talk', 'btn-talk-lobby']) {
      const b = $<HTMLButtonElement>(id);
      b.classList.toggle('rec', rec);
      b.classList.toggle('busy', !!other);
      b.disabled = !!other || this.talkPending;
      b.querySelector('b')!.textContent = rec ? `■ ENVIAR · ${Math.ceil(left / 1000)} s` : other ? `🔊 Habla ${other.n}` : this.talkPending ? '…' : '🎙️ HABLAR';
      (b.querySelector('.tk-bar') as HTMLElement).style.transform = `scaleX(${rec ? 1 - left / VOICE_MAX_MS : 0})`;
    }
  }

  private onVoice(v: { from: string; n: string; d: string }) {
    if (!this.settings.voice) return;
    const color = hex(this.room?.players.get(v.from)?.color ?? 0xffffff);
    this.voicePlayer.play(v.d, () => this.hud.chat(v.n, color, '🔊 …'));
  }

  // ================================================================ Perfil en la nube
  private renderCloud() {
    const c = this.cloud;
    const info = $('cloud-info');
    const on = c.enabled;
    const toggle = $('set-cloud') as HTMLButtonElement;
    toggle.disabled = !c.available;
    toggle.setAttribute('aria-pressed', String(on && c.available));
    toggle.querySelector('b')!.textContent = on && c.available ? 'Sí' : 'No';
    ($('btn-cloud-restore') as HTMLButtonElement).disabled = !c.available;
    show('cloud-code-row', on && c.available);
    $('cloud-code').textContent = formatRecovery(c.code);
    if (!c.available) info.textContent = 'Necesita el juego conectado a Firebase (en la versión publicada funciona).';
    else if (!on) info.textContent = 'Guarda créditos, aviones, logros, récords y circuitos en la nube. Con tu código de recuperación lo recuperas en otro móvil o navegador.';
    else info.textContent = c.lastSync ? `Última copia: ${new Date(c.lastSync).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}. Se guarda sola cada 2 minutos.` : 'Aún no hay copia: pulsa «Guardar ahora».';
  }

  private async cloudSaveNow(force: boolean) {
    const res = await this.cloud.save(this.pilotName(), () => this.progress.flush(), force);
    $('cloud-msg').textContent = res === 'saved' ? 'Copia guardada en la nube ✔' : res === 'same' ? 'La copia ya estaba al día ✔' : 'No se pudo guardar. Comprueba la conexión (y que Firestore esté creado).';
    this.renderCloud();
  }

  private async cloudRestore() {
    const code = $<HTMLInputElement>('cloud-restore-code').value;
    if (!confirm('Se sustituirá el progreso de este dispositivo por el de la copia. ¿Continuar?')) return;
    $('cloud-msg').textContent = 'Recuperando…';
    try {
      this.progress.locked = true;
      const name = await this.cloud.restore(code);
      if (name) {
        this.settings.name = name.slice(0, 16);
        saveSettings(this.settings);
      }
      $('cloud-msg').textContent = 'Perfil recuperado. Reiniciando el juego…';
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      this.progress.locked = false;
      $('cloud-msg').textContent = (e as Error).message || 'No se pudo recuperar.';
    }
  }

  private restartRace() {
    if (this.isDaily) this.startDaily();
    else this.startRace(this.courseDef, 0, 1, undefined, undefined, this.customCircuit ?? undefined);
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

  private lastHudDt = 0;
  /** Camino que dibuja la estela: hasta el siguiente hito y el posterior (o el reparto) */
  private routeEnd = Infinity;
  private routePoints(): THREE.Vector3[] | null {
    const f = this.flight;
    const fwd = f.forward();
    const start = f.pos.clone().addScaledVector(fwd, 55);
    this.routeEnd = Infinity;
    if (this.race && !this.race.finished) {
      const gates = this.race.course.gates;
      const pts = [start];
      let i = this.race.nextGate;
      for (let k = 0; k < 2; k++) {
        const g = gates[i];
        const dir = new THREE.Vector3(-Math.sin(g.yaw), 0, -Math.cos(g.yaw));
        // entrar de frente y salir recto por el hito
        const before = g.pos.clone().addScaledVector(dir, -140);
        if (before.distanceTo(start) > 160) pts.push(before);
        pts.push(g.pos.clone());
        if (k === 0) this.routeEnd = pts.length - 1;
        pts.push(g.pos.clone().addScaledVector(dir, 120));
        if (i === 0) break; // la meta es el final
        i = (i + 1) % gates.length;
      }
      return pts;
    }
    if (this.delivery && !this.delivery.over) {
      const t = this.delivery.target;
      return [start, t.clone().setY(Math.max(t.y + 60, (start.y + t.y) / 2)), t.clone().setY(t.y + 12)];
    }
    return null;
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
      if (this.worldGhost && !this.worldGhost.finished) items.push({ pos: this.worldGhost.pos, kind: 'ghost', color: '#ffd040' });
      this.hud.setTimer(formatTime(this.race.started ? this.race.time : 0));
    } else if (this.battle) {
      scoreLabel = 'Derribos';
      scoreValue = String(this.battle.me?.kills ?? 0);
      const enemies = this.enemyTargets().filter((t) => t.alive);
      let nearest: Target | null = null;
      let nd = Infinity;
      for (const t of enemies) {
        const pi = this.pilotInfo(t.id);
        items.push({ pos: t.pos, kind: 'enemy', icon: pi.icon, color: pi.teamColor });
        const d = t.pos.distanceTo(f.pos);
        if (d < nd) {
          nd = d;
          nearest = t;
        }
      }
      for (const t of [...this.remotes.targets(), ...this.bots.map((b) => b.target)]) {
        if (t.alive && !this.battle.enemies(this.myId, t.id)) {
          const pi = this.pilotInfo(t.id);
          items.push({ pos: t.pos, kind: 'ally', icon: pi.icon, color: pi.teamColor });
        }
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
        for (const t of this.remotes.targets()) {
          if (!t.alive) continue;
          const pi = this.pilotInfo(t.id);
          items.push({ pos: t.pos, kind: 'ally', icon: pi.icon, color: pi.color });
        }
        if (this.leashTarget) {
          arrowTarget = this.leashTarget;
          arrowColor = 0x5cff8a;
        }
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
        for (const r of this.rings.list()) items.push({ pos: r.pos, kind: 'ring', color: RING_INFO[r.kind].css });
      }
    }

    // Objetivos de los modos especiales (marcador, flecha y radar)
    if (this.delivery && !this.delivery.over) {
      const pick = this.delivery.state === 'pickup';
      navTarget = this.delivery.target;
      navGate = true;
      navLabel = pick ? 'RECOGER' : 'ENTREGAR';
      arrowTarget = navTarget;
      arrowColor = pick ? 0x5cff8a : 0xffa040;
      items.push({ pos: navTarget, kind: 'gate', color: pick ? '#5cff8a' : '#ffa040' });
    }
    if (this.zone) {
      navTarget = this.zone.center;
      navGate = true;
      navLabel = 'ZONA';
      if (!this.zone.contains(f.pos)) {
        arrowTarget = this.zone.center;
        arrowColor = 0xffd040;
      }
      items.push({ pos: this.zone.center, kind: 'gate', color: '#ffd040' });
    }
    if (this.battle?.config.kind === 'tag') {
      const it = this.battle.it;
      const holder = this.allPlanes().find((p) => p.id === it);
      if (it === this.myId) {
        let best: Target | null = null;
        let bd = Infinity;
        for (const p of this.allPlanes()) {
          if (p.id === this.myId || !p.alive) continue;
          const d = p.pos.distanceTo(f.pos);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        if (best) {
          arrowTarget = best.pos;
          arrowColor = 0xff4040;
        }
      } else if (holder) {
        navTarget = holder.pos;
        navLabel = 'LA LLEVA';
      }
    }
    if (this.mode === 'waves') scoreLabel = 'Derribos';
    if (this.mode === 'editor') {
      scoreLabel = 'Hitos';
      scoreValue = `${Math.max(0, this.editGates.length - 1)}`;
      navTarget = null;
      this.editGates.forEach((g, i) => items.push({ pos: new THREE.Vector3(g.x, g.y, g.z), kind: 'gate', label: i === 0 ? 'M' : String(i) }));
    }
    // Eventos de la ciudad
    const eh = this.cityEvents?.hud(f.pos) ?? null;
    if (this.cityEvents) this.hud.banner(eh ? eh.banner : null, eh?.kind);
    if (eh) {
      for (const it of eh.items) items.push({ pos: it.pos, kind: it.kind, color: it.color });
      if (eh.nav) {
        navTarget = eh.nav;
        navLabel = eh.navLabel;
        navGate = true;
        if (eh.nav.distanceTo(f.pos) > 250) {
          arrowTarget = eh.nav;
          arrowColor = eh.navColor;
        }
      }
    }
    // Supervivencia: zona en el radar y flecha si estás fuera
    const circles: { pos: THREE.Vector3; r: number; color: string }[] = [];
    if (this.storm) {
      circles.push({ pos: this.storm.center, r: this.storm.radius, color: 'rgba(170,110,255,0.9)' });
      if (this.storm.outside(f.pos) > -60) {
        arrowTarget = this.storm.center.clone().setY(f.pos.y);
        arrowColor = 0xa070ff;
      }
    }
    // Jefe final: el dirigible y su parte vulnerable más cercana
    if (this.boss && !this.boss.defeated) {
      const boss = this.boss;
      items.push({ pos: boss.pos, kind: 'enemy', color: '#ff6a2a', label: 'J' });
      let best: Target | null = null;
      let bd = Infinity;
      for (const t of boss.targets()) {
        const d = t.pos.distanceTo(f.pos);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      if (best && !lockFor(this)) {
        navTarget = best.pos;
        navLabel = (best.name ?? '').toUpperCase();
        navGate = false;
      }
      if (boss.pos.distanceTo(f.pos) > 900) {
        arrowTarget = boss.pos;
        arrowColor = 0xff6a2a;
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
    this.radar.draw(f.pos, f.yaw, items, route, circles);
    const night = this.stage.night;
    const trailColor = this.race ? (this.race.nextGate === 0 ? 0xffc040 : night ? 0x9fe8ff : 0xfff0a0) : 0xffb060;
    this.trail.update(this.lastHudDt, this.screen === 'playing' && this.alive ? this.routePoints() : null, trailColor, this.routeEnd);
    this.hud.combo(this.stunts.combo);
    // Etiquetas de los demás pilotos
    const tags = [];
    if (this.screen === 'playing' || this.screen === 'results') {
      const others: Target[] = [...this.remotes.targets(), ...this.bots.map((b) => b.target)];
      for (const t of others) {
        if (!t.alive) continue;
        const pi = this.pilotInfo(t.id);
        const tagMode = this.battle?.config.kind === 'tag';
        const enemy = tagMode ? t.id === this.battle!.it : this.battle ? this.battle.enemies(this.myId, t.id) : false;
        tags.push({ id: t.id, name: pi.name, glyph: ICON_GLYPH[pi.icon], color: pi.teamColor, pos: t.pos, enemy });
      }
    }
    this.hud.updatePilots(this.camera, f.pos, tags);
    this.arrow.update(f.pos, f.yaw, arrowTarget, this.alive && this.screen === 'playing' && this.rig.mode !== 'cockpit' && this.rig.mode !== 'top', arrowColor);
    if (this.rig.mode === 'cockpit') this.layoutControls();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(Math.round(w * this.gfx.bloomScale), Math.round(h * this.gfx.bloomScale));
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
    for (const id of ['crash', 'race-results', 'battle-results', 'pause', 'summary']) show(id, false);
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
    const ghostData = this.ghostRec.data(this.race!.elapsed);
    if (best) saveGhost(id, ghostData);
    const worldPrev = this.worldGhost?.data.time;
    if (worldPrev !== undefined && this.race!.elapsed < worldPrev) this.recorder.highlight('¡Fantasma dorado batido!');
    if (prevGhost !== undefined && time < prevGhost) {
      this.progress.add('ghostBeaten');
      this.recorder.highlight('¡Fantasma batido!');
    }
    this.progress.add('races');
    this.earn(60 + (best ? 40 : 0));
    if (this.isDaily) {
      // Cuenta como desafío del día la primera vez, sea de día o de noche
      const firstToday = this.dailyBest() === undefined;
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
    $('rr-course').textContent = `${this.isDaily ? `Desafío diario ${this.dailyVariant === 'night' ? 'de noche' : 'de día'} · ${dayLabel()}` : this.race!.course.name} · ${this.stage.name}`;
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
        .submitTime(id, this.pilotName(), time)
        .then((saved) => {
          if (saved) $('rr-msg').textContent = 'Tiempo guardado en la clasificación online';
          if (!saved || !best) return;
          return firebase.submitWorldGhost(id, this.pilotName(), time, JSON.stringify(ghostData)).then((w) => {
            if (w) $('rr-msg').textContent = '¡Récord mundial! Tu fantasma dorado ya está en la nube';
          });
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
    if (res.iWon && this.battleConfig.kind === 'koth') this.progress.add('kothWins');
    if (res.iWon && this.battleConfig.kind === 'royale') this.progress.add('royaleWins');
    if (res.iWon && this.battleConfig.kind === 'boss') this.progress.add('bossWins');
    this.stopSpectating();
    this.hud.banner(null);
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
        const pts = isPointsMode(this.battleConfig.kind);
        const kind = this.battleConfig.kind;
        const sub = kind === 'boss' ? 'daño' : kind === 'royale' ? (r.deaths === 0 ? 'en pie' : 'caído') + ` · ${r.kills} derribos` : pts ? 'puntos' : `${r.deaths} caídas`;
        li.innerHTML = `<span class="pos">${i + 1}</span><span class="nm"></span><span class="speed">${sub}</span><b>${pts ? Math.floor(r.points) : r.kills}</b>`;
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
    const custom = mode === 'race' && course.startsWith('c:') ? loadCircuits().find((c) => c.code === course.slice(2)) : null;
    if (custom && custom.stage !== this.stage.id) this.loadStage(getStage(custom.stage));
    const bc = this.readBattleForm('mp');
    this.setMpBusy(true);
    try {
      const room = await Room.create(this.pilotName(), mode, this.stage.id, course, { kind: bc.kind, bots: bc.bots, kill: bc.killLimit, time: bc.timeLimit }, this.mpPublic);
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
    const msg = String((e as { message?: string; code?: string })?.message ?? '') + String((e as { code?: string })?.code ?? '');
    if (/permission[_ ]denied/i.test(msg)) {
      // Casi siempre: las reglas de Realtime Database no se han publicado (siguen bloqueadas)
      $('mp-error').textContent =
        'Firebase ha rechazado la sala: las reglas del multijugador no están publicadas. Ejecuta «npm run deploy:multijugador» o pega database.rules.json en Realtime Database → Reglas (guía DESPLIEGUE.md).';
      return;
    }
    $('mp-error').textContent = e instanceof NetError ? e.message : 'No se pudo conectar. Revisa tu conexión e inténtalo otra vez.';
  }

  private attachRoom(room: Room) {
    this.room = room;
    $('mp-error').textContent = '';
    show('mp-panel', false);
    this.stopPublicList();
    this.myRound = room.meta?.round ?? 0;
    const resync = () => this.remotes.sync(room.players, room.uid, room.isHost ? undefined : room.bots);
    let myColor = -1;
    room.onPlayers = () => {
      resync();
      const me = room.players.get(room.uid);
      if (me && me.color !== myColor) {
        myColor = me.color;
        this.applyLoadout();
      }
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
    room.onTalk = () => this.updateTalkUi();
    room.onVoice = (v) => this.onVoice(v);
    this.updateTalkUi();
    room.onBoss = (st) => {
      if (st && this.boss && !room.isHost) this.boss.applyNet(st);
    };
    room.onTagIt = (id, seq) => {
      const b = this.battle;
      if (!b || b.config.kind !== 'tag' || id === b.it) return;
      const prev = b.it;
      b.it = id;
      this.tagSeq = Math.max(this.tagSeq, seq);
      this.lastTagger = prev;
      this.lastTaggerUntil = this.time + 6;
      this.tagImmune = 2.5;
      this.onTagChanged(id, prev);
    };
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

  /** Mensaje de invitación con enlace directo a la sala */
  private inviteText() {
    const code = this.room ? formatCode(this.room.code) : '';
    const url = `${location.origin}/?sala=${this.room?.code ?? ''}`;
    return `¡Únete a mi partida de FalconSky! ✈️\nCódigo: ${code}\n${url}`;
  }

  private renderVisibility(el: HTMLElement, pub: boolean) {
    el.setAttribute('aria-pressed', String(pub));
    (el.querySelector('.vis-icon') as HTMLElement).textContent = pub ? '🌍' : '🔑';
    (el.querySelector('b') as HTMLElement).textContent = pub ? 'Pública' : 'Privada';
    (el.querySelector('small') as HTMLElement).textContent = pub ? 'Aparece en la lista de partidas públicas' : 'Solo se entra con el código';
  }

  private openMpPanel(code?: string) {
    this.fillCourseSelect($<HTMLSelectElement>('mp-course'));
    this.fillCourseSelect($<HTMLSelectElement>('lobby-course'));
    show('mp-panel', true);
    if (code) $<HTMLInputElement>('mp-code').value = formatCode(code);
    if (!firebase.multiplayer) {
      $('mp-error').textContent = 'El multijugador necesita Firebase con Realtime Database (ver README). En esta versión de prueba no está disponible.';
      this.renderPublic(null);
      return;
    }
    $('mp-error').textContent = '';
    this.renderPublic([]);
    if (!this.unwatchPublic) {
      Room.watchPublic((list) => this.renderPublic(list))
        .then((u) => {
          if ($('mp-panel').classList.contains('hidden')) u();
          else this.unwatchPublic = u;
        })
        .catch((e) => this.mpError(e));
    }
  }

  private stopPublicList() {
    this.unwatchPublic?.();
    this.unwatchPublic = null;
  }

  private renderPublic(list: PublicRoom[] | null) {
    const ul = $('mp-public');
    const empty = (t: string) => {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = t;
      return li;
    };
    if (list === null) {
      ul.replaceChildren(empty('No disponible en esta versión.'));
      return;
    }
    if (!list.length) {
      ul.replaceChildren(empty('No hay partidas públicas ahora mismo. ¡Crea una y aparecerá aquí!'));
      return;
    }
    const modeLabel = (r: PublicRoom) =>
      r.mode === 'race' ? 'Carrera' : r.mode === 'battle' ? `Batalla · ${BATTLE_LABELS[r.bk ?? 'ffa']}` : 'Vuelo en equipo';
    ul.replaceChildren(
      ...list.map((r) => {
        const li = document.createElement('li');
        const info = document.createElement('div');
        info.className = 'pr-info';
        const b = document.createElement('b');
        b.textContent = `Partida de ${r.host}`;
        const sm = document.createElement('small');
        const running = r.state !== 'lobby';
        sm.textContent = `${modeLabel(r)} · ${getStage(r.stage).name} · ${r.n}/${MAX_PLAYERS} pilotos${running ? ' · en curso' : ''}`;
        info.append(b, sm);
        const btn = document.createElement('button');
        btn.className = 'primary small';
        btn.textContent = 'Unirse';
        btn.disabled = running && r.mode === 'race';
        btn.addEventListener('click', () => {
          $<HTMLInputElement>('mp-code').value = formatCode(r.code);
          void this.joinRoom();
        });
        li.append(info, btn);
        return li;
      }),
    );
  }

  private detachRoom() {
    this.voiceRec.cancel();
    clearInterval(this.talkTimer);
    this.remotes.dispose();
    this.room = null;
    this.applyLoadout();
    this.hud.updatePilots(this.camera, this.flight.pos, []);
  }

  private async leaveRoom() {
    const r = this.room;
    this.voiceRec.cancel();
    clearInterval(this.talkTimer);
    r?.releaseTalk();
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
      if (m.mode === 'race' && m.course.startsWith('c:')) {
        const n = Math.max(order.length, 1);
        this.fetchCircuit(m.course.slice(2))
          .then((c) => this.startRace(COURSES[0], idx, n, m.startAt, undefined, c))
          .catch((e) => this.hud.toast((e as Error).message || 'No se pudo cargar el circuito de la sala', 3000));
      } else if (m.mode === 'race') {
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
          dot.className = 'dot icon';
          dot.style.color = hex(teamMode && p.team ? TEAM_COLORS[p.team] : p.color);
          dot.textContent = ICON_GLYPH[p.icon ?? 'o'];
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
    const vis = $<HTMLButtonElement>('lobby-visibility');
    this.renderVisibility(vis, !!m.pub);
    vis.disabled = !room.isHost;
    // Mi piloto: nombre, color e icono (sin repetir los de otros)
    const mine = room.players.get(room.uid);
    const nameIn = $<HTMLInputElement>('lobby-name');
    if (document.activeElement !== nameIn) nameIn.value = mine?.name ?? this.pilotName();
    const others = [...room.players.entries()].filter(([k]) => k !== room.uid).map(([, p]) => p);
    $('lobby-colors').replaceChildren(
      ...PLAYER_COLORS.map((c) => {
        const b = document.createElement('button');
        b.className = 'swatch-btn';
        b.style.background = hex(c);
        const taken = others.some((p) => p.color === c);
        b.disabled = taken;
        b.classList.toggle('selected', mine?.color === c);
        b.setAttribute('aria-label', taken ? 'Color ocupado' : 'Elegir color');
        b.addEventListener('click', () => void room.setProfile({ color: c }));
        return b;
      }),
    );
    $('lobby-icons').replaceChildren(
      ...ICONS.map((ic) => {
        const b = document.createElement('button');
        b.className = 'icon-btn';
        b.textContent = ICON_GLYPH[ic];
        b.title = ICON_NAMES[ic];
        b.style.color = hex(mine?.color ?? 0xffffff);
        const taken = others.some((p) => p.icon === ic);
        b.disabled = taken;
        b.classList.toggle('selected', mine?.icon === ic);
        b.addEventListener('click', () => void room.setProfile({ icon: ic }));
        return b;
      }),
    );
    $('lobby-plane-name').textContent = this.progress.plane.name;
    this.renderPlaneStrip('lobby-planes', () => this.renderLobby());
    const host = room.isHost;
    for (const id of ['lobby-mode', 'lobby-stage', 'lobby-course', 'lobby-bkind', 'lobby-bots', 'lobby-blimit', 'lobby-btime']) ($(id) as HTMLSelectElement).disabled = !host;
    $<HTMLSelectElement>('lobby-mode').value = m.mode;
    $<HTMLSelectElement>('lobby-stage').value = m.stage;
    const lc = $<HTMLSelectElement>('lobby-course');
    if (![...lc.options].some((o) => o.value === m.course)) lc.append(new Option(m.course.startsWith('c:') ? '★ Circuito de la sala' : m.course, m.course));
    lc.value = m.course;
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
    this.applyQuality();
    this.layoutControls();
  }

  /** Nivel de calidad efectivo (el elegido o el que decide el modo automático) */
  get qualityLevel(): QualityLevel {
    return this.settings.quality === 'auto' ? this.autoQ.level : this.settings.quality;
  }

  /** Aplica resolución, bloom, partículas y distancia de dibujado */
  private applyQuality() {
    const prev = this.gfx;
    this.gfx = qualityPreset(this.qualityLevel, isTouch);
    if (!this.renderer) return;
    const pr = Math.min(window.devicePixelRatio || 1, this.gfx.maxPixelRatio);
    if (this.renderer.getPixelRatio() !== pr || prev.bloomScale !== this.gfx.bloomScale) {
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
      this.resize();
    }
    if (this.fx) this.fx.high = this.gfx.fxHigh;
    this.chunks?.setRadius(this.gfx.radius);
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
      this.hud.toast('FalconSky instalado', 1800);
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
    const params = new URLSearchParams(location.search);
    const sala = normalizeCode(params.get('sala') ?? '');
    const mode = params.get('mode');
    const circuito = cleanCode(params.get('circuito') ?? '');
    if (circuito.length === 6) {
      history.replaceState(null, '', location.pathname);
      this.openCircuits();
      $<HTMLInputElement>('cc-code').value = `${circuito.slice(0, 3)}-${circuito.slice(3)}`;
      return;
    }
    if (!mode && !sala) return;
    history.replaceState(null, '', location.pathname);
    // Enlace de invitación: abrir la sala directamente
    if (sala.length === 6) {
      this.openMpPanel(sala);
      if (firebase.multiplayer) void this.joinRoom();
      return;
    }
    // El sonido necesita un gesto: se activa en el primer toque
    if (mode === 'free') this.startFree();
    else if (mode === 'daily') this.startDaily();
  }

  private refreshMenu() {
    const d = dailyChallenge();
    const best = this.dailyBest();
    $('daily-sub').textContent = `${d.def.gates} hitos · de día o de noche${best !== undefined ? ` · tu mejor ${formatTime(best)}` : ''}`;
    $('menu-credits').textContent = `${this.progress.p.credits} créditos`;
    const done = Object.keys(this.progress.p.achievements).length;
    $('ach-badge').textContent = `${done}/${ACHIEVEMENTS.length}`;
    $('menu-name').textContent = this.pilotName();
    const last = store.get('lastMode') as PfMode | null;
    $('play-sub').textContent = last && PF_INFO[last] ? `Último: ${PF_INFO[last].title}` : 'Elige un modo para un jugador';
    this.season.refresh();
    const tier = this.season.tier;
    $('season-tier').textContent = tier >= SEASON_TIERS ? 'Completo' : `Nivel ${tier}/${SEASON_TIERS}`;
    $('season-bar').style.transform = `scaleX(${tier >= SEASON_TIERS ? 1 : (this.season.state.xp % XP_PER_TIER) / XP_PER_TIER})`;
  }

  private setupUi() {
    const name = $<HTMLInputElement>('pilot-name');
    name.value = this.settings.name;
    name.addEventListener('change', () => {
      this.settings.name = name.value.trim().slice(0, 16);
      this.persist();
      $('menu-name').textContent = this.pilotName();
    });

    this.buildStageList($('stage-list'), (s) => {
      if (s.id !== this.stage.id) this.loadStage(s);
      if (this.pfMode === 'race') this.renderCourses();
    });
    this.buildStageList($('stage-list-2'), (s) => {
      show('stage-picker', false);
      if (s.id !== this.stage.id) this.loadStage(s);
      this.startFree();
      this.hud.toast(s.name);
    });

    // Modos
    $('btn-play').addEventListener('click', () => this.openPlay());
    $('btn-daily').addEventListener('click', () => this.openPreflight('daily'));
    for (const v of ['day', 'night'] as const) {
      $(`dn-${v}`).addEventListener('click', () => {
        this.dailyVariant = v;
        store.set('dailyVariant', v);
        this.renderDailyChoice();
      });
    }
    document.querySelectorAll<HTMLElement>('#play .mode-card').forEach((b) => b.addEventListener('click', () => this.openPreflight(b.dataset.mode as PfMode)));
    $('pf-back').addEventListener('click', () => {
      show('preflight', false);
      this.openPlay();
    });
    $('btn-go').addEventListener('click', () => this.launchPreflight());
    $('bp-bkind').addEventListener('change', () => this.updateBattlePicker());
    $('btn-profile').addEventListener('click', () => {
      this.openSettings();
      setTimeout(() => $<HTMLInputElement>('pilot-name').focus(), 50);
    });
    $('btn-season').addEventListener('click', () => this.openSeason());
    $('btn-sum-retry').addEventListener('click', () => (this.mode === 'delivery' ? this.startDelivery() : this.startWaves()));
    $('btn-sum-menu').addEventListener('click', () => this.setScreen('menu'));
    $('btn-sum-replay').addEventListener('click', () => this.startReplay('summary'));
    $('btn-mp').addEventListener('click', () => this.openMpPanel());
    $('mp-visibility').addEventListener('click', () => {
      this.mpPublic = !this.mpPublic;
      this.renderVisibility($('mp-visibility'), this.mpPublic);
    });
    this.renderVisibility($('mp-visibility'), this.mpPublic);
    $('lobby-visibility').addEventListener('click', () => {
      if (this.room?.isHost) void this.room.setPublic(!this.room.meta?.pub);
    });
    $('btn-share-wa').addEventListener('click', () => {
      if (!this.room) return;
      window.open(`https://wa.me/?text=${encodeURIComponent(this.inviteText())}`, '_blank', 'noopener');
    });
    $('btn-share').addEventListener('click', async () => {
      if (!this.room) return;
      const text = this.inviteText();
      const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
      if (nav.share) {
        try {
          await nav.share({ title: 'FalconSky', text });
          return;
        } catch {
          /* cancelado */
        }
      }
      navigator.clipboard?.writeText(text).then(
        () => this.hud.toast('Invitación copiada: pégala en WhatsApp', 1600),
        () => selectText($('lobby-code')),
      );
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
      if (this.mode === 'race') this.restartRace();
      else if (this.mode === 'editor') this.startEditor(this.stage);
      else if (this.mode === 'battle') this.startBattle(this.battleConfig);
      else if (this.mode === 'delivery') this.startDelivery();
      else if (this.mode === 'waves') this.startWaves();
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

    // Espectador
    $('btn-spectate-next').addEventListener('click', () => this.nextSpectate());

    // Chat rápido
    $('chat-wheel').replaceChildren(
      ...QUICK_CHAT.map((t, i) => {
        const b = document.createElement('button');
        b.className = 'secondary';
        b.innerHTML = `<small>${i + 1}</small>`;
        b.append(`${CHAT_ICONS[i]} ${t}`);
        b.addEventListener('click', () => this.sendChat(i));
        return b;
      }),
    );
    $('btn-chat').addEventListener('click', () => this.toggleChat());
    for (const id of ['btn-talk', 'btn-talk-lobby']) $(id).addEventListener('click', () => void this.toggleTalk());
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (this.screen === 'lobby' && this.room && e.code === 'KeyV' && !e.repeat) void this.toggleTalk();
      if (this.screen !== 'playing') return;
      if (this.mode === 'editor' && e.code === 'KeyH') this.placeGate();
      if (!this.room) return;
      if (e.code === 'KeyV' && !e.repeat) void this.toggleTalk();
      if (e.code === 'KeyT') this.toggleChat();
      const m = /^Digit([1-8])$/.exec(e.code);
      if (m && !$('chat-wheel').classList.contains('hidden')) this.sendChat(Number(m[1]) - 1);
    });

    // Editor de circuitos
    $('btn-ed-place').addEventListener('click', () => this.placeGate());
    $('btn-ed-undo').addEventListener('click', () => this.undoGate());
    $('btn-ed-save').addEventListener('click', () => this.openSaveCircuit());
    $('btn-cs-save').addEventListener('click', () => void this.saveCircuit());
    $('btn-cs-cancel').addEventListener('click', () => {
      show('circuit-save', false);
      this.paused = false;
      this.timer.update();
    });
    $('btn-cs-copy').addEventListener('click', () => {
      const t = $('cs-code').textContent ?? '';
      navigator.clipboard?.writeText(t).then(
        () => this.hud.toast('Código copiado', 1000),
        () => selectText($('cs-code')),
      );
    });
    $('btn-cs-wa').addEventListener('click', () => {
      if (this.savedCircuit) window.open(`https://wa.me/?text=${encodeURIComponent(this.shareCircuitText(this.savedCircuit))}`, '_blank', 'noopener');
    });
    $('btn-cs-race').addEventListener('click', () => {
      const c = this.savedCircuit;
      show('circuit-save', false);
      if (c) this.startRace(COURSES[0], 0, 1, undefined, undefined, c);
    });
    $('btn-cs-menu').addEventListener('click', () => {
      this.setScreen('menu');
      this.openCircuits();
    });
    $('cc-back').addEventListener('click', () => {
      show('circuits', false);
      this.openPlay();
    });
    $('btn-cc-new').addEventListener('click', () => {
      show('circuits', false);
      store.set('lastMode', 'circuits');
      this.startEditor(this.stage);
    });
    $('btn-cc-load').addEventListener('click', () => void this.loadCircuitFromInput());
    $<HTMLInputElement>('cc-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.loadCircuitFromInput();
    });
    this.buildStageList($('cc-stage'), (st) => {
      if (st.id !== this.stage.id) this.loadStage(st);
    });

    // Perfil en la nube
    $('set-cloud').addEventListener('click', () => {
      if (!this.cloud.available) return;
      this.cloud.enabled = !this.cloud.enabled;
      this.renderCloud();
      if (this.cloud.enabled) void this.cloudSaveNow(true);
      else $('cloud-msg').textContent = 'Copia automática desactivada (la copia que ya hay en la nube se conserva).';
    });
    $('btn-cloud-save').addEventListener('click', () => void this.cloudSaveNow(true));
    $('btn-cloud-copy').addEventListener('click', () => {
      navigator.clipboard?.writeText(formatRecovery(this.cloud.code)).then(
        () => ($('cloud-msg').textContent = 'Código copiado. Guárdalo en un sitio seguro.'),
        () => selectText($('cloud-code')),
      );
    });
    $('btn-cloud-restore').addEventListener('click', () => void this.cloudRestore());
    this.cloud.startAuto(
      () => this.pilotName(),
      () => this.progress.flush(),
    );

    // Resultados
    $('btn-rr-retry').addEventListener('click', () => this.restartRace());
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
    for (const sel of [mpCourse, lobbyCourse]) this.fillCourseSelect(sel);
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
    $<HTMLInputElement>('lobby-name').addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value.trim().slice(0, 16) || 'Piloto';
      this.settings.name = v;
      this.persist();
      $<HTMLInputElement>('pilot-name').value = v;
      void this.room?.setProfile({ name: v });
    });
    $('btn-team').addEventListener('click', () => {
      const me = this.room?.players.get(this.room.uid);
      if (me) void this.room!.setTeam(me.team === 'A' ? 'B' : 'A');
    });
    $('lobby-mode').addEventListener('change', (e) => void this.room?.setMeta({ mode: (e.target as HTMLSelectElement).value as RoomMode }));
    lobbyStage.addEventListener('change', (e) => void this.room?.setMeta({ stage: (e.target as HTMLSelectElement).value as StageId }));
    lobbyCourse.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      const custom = v.startsWith('c:') ? loadCircuits().find((c) => c.code === v.slice(2)) : null;
      void this.room?.setMeta(custom ? { course: v, stage: custom.stage } : { course: v });
    });
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
    $('btn-hangar').addEventListener('click', () => {
      this.hangarFocus = null;
      this.openHangar('planes');
    });
    $('btn-achievements').addEventListener('click', () => this.openAchievements());
    document.querySelectorAll<HTMLElement>('#hangar-tabs button').forEach((b) =>
      b.addEventListener('click', () => this.openHangar(b.dataset.tab as 'planes' | 'paints' | 'upgrades')),
    );

    document.querySelectorAll<HTMLElement>('.sr-modes button').forEach((b) =>
      b.addEventListener('click', () => {
        this.previewMode = b.dataset.view as PreviewMode;
        this.updateShowroom();
      }),
    );
    $('pf-hangar').addEventListener('click', (e) => {
      e.preventDefault();
      this.hangarFocus = null;
      this.openHangar('planes');
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
    const toggles: [string, () => void][] = [
      ['set-invert', () => (this.settings.invertY = !this.settings.invertY)],
      ['set-aim', () => (this.settings.aimAssist = !this.settings.aimAssist)],
      ['set-sound', () => (this.settings.muted = !this.settings.muted)],
      [
        'set-quality',
        () => {
          const order: QualitySetting[] = ['auto', 'low', 'medium', 'high'];
          this.settings.quality = order[(order.indexOf(this.settings.quality) + 1) % order.length];
          this.autoQ.restart();
        },
      ],
      [
        'set-weather',
        () => {
          this.settings.weather = !this.settings.weather;
          if (!this.settings.weather) this.weather.set('clear');
        },
      ],
      ['set-vibration', () => (this.settings.vibration = !this.settings.vibration)],
      ['set-ghost', () => (this.settings.ghost = !this.settings.ghost)],
      ['set-voice', () => (this.settings.voice = !this.settings.voice)],
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
        if (ov.id === 'mp-panel') this.stopPublicList();
        if (this.screen === 'playing' && ov.id !== 'pause' && this.paused) show('pause', true);
        if (this.screen === 'menu') this.refreshMenu();
        // Al cerrar el hangar desde «Preparar vuelo», volver a mostrar el avión elegido
        if (ov.id === 'hangar' && !$('preflight').classList.contains('hidden')) this.renderPlanePicker();
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

  private updateBattlePicker() {
    const kind = $<HTMLSelectElement>('bp-bkind').value as BattleKind;
    const help: Record<BattleKind, string> = {
      ffa: 'Gana quien consiga antes los derribos indicados.',
      teams: 'Tú y bots aliados (naranja) contra bots azules.',
      coop: 'Tú solo contra todos los bots.',
      koth: 'Quédate solo dentro de la zona dorada para sumar 1 punto por segundo. La zona cambia de sitio cada minuto.',
      tag: 'Sin disparos. Quien «la lleva» tiene que tocar a otro avión para pasársela. Sumas 1 punto por cada segundo sin llevarla.',
      royale: 'Una sola vida. La tormenta cierra el cielo: gana el último en pie.',
      boss: 'Todos contra un dirigible gigante con tres fases.',
    };
    $('bp-help').textContent = help[kind];
    $('bp-limit-label').textContent = kind === 'koth' ? 'Puntos para ganar' : 'Derribos para ganar';
    const sel = $<HTMLSelectElement>('bp-blimit');
    for (const o of [...sel.options]) o.textContent = kind === 'koth' ? String(Number(o.value) * 10) : o.value;
    sel.closest('label')!.classList.toggle('hidden', kind === 'tag' || kind === 'royale' || kind === 'boss');
    const bots = $<HTMLInputElement>('bp-bots');
    bots.min = kind === 'boss' ? '0' : '1';
    if (Number(bots.value) < Number(bots.min)) bots.value = bots.min;
    $('bp-bots-label').firstChild!.textContent = kind === 'boss' ? 'Bots aliados ' : 'Bots ';
    $('bp-bots-val').textContent = bots.value;
  }

  private openSeason() {
    const se = this.season;
    se.refresh();
    const st = se.state;
    const tier = se.tier;
    show('season', true);
    $('season-name').textContent = seasonName(st.id);
    $('season-xp').textContent = tier >= SEASON_TIERS ? 'Completo' : `Nivel ${tier} · ${st.xp % XP_PER_TIER}/${XP_PER_TIER} XP`;
    $('season-bar2').style.transform = `scaleX(${tier >= SEASON_TIERS ? 1 : (st.xp % XP_PER_TIER) / XP_PER_TIER})`;
    const ms = new Date();
    const dayIdx = (ms.getUTCDay() + 6) % 7;
    $('season-week').textContent = `Cambian en ${7 - dayIdx} ${7 - dayIdx === 1 ? 'día' : 'días'}`;
    $('season-missions').replaceChildren(
      ...se.missions.map((m) => {
        const li = document.createElement('li');
        const done = st.done.includes(m.id);
        const p = se.progressOf(m);
        li.className = done ? 'done' : '';
        li.innerHTML = `<span></span><em>+${m.xp} XP</em><span class="sb-bar"><i style="transform:scaleX(${p / m.target})"></i></span><small>${done ? 'Completada' : `${Math.floor(p)}/${m.target}`}</small>`;
        (li.firstChild as HTMLElement).textContent = m.text;
        return li;
      }),
    );
    $('season-tiers').replaceChildren(
      ...Array.from({ length: SEASON_TIERS }, (_, i) => {
        const t = i + 1;
        const r = tierReward(t);
        const li = document.createElement('li');
        li.className = `${t <= st.tier ? 'got' : ''}${r.paint || r.plane ? ' big' : ''}`;
        li.innerHTML = `<b>Nivel ${t}</b><span></span>`;
        (li.querySelector('span') as HTMLElement).textContent = r.label;
        return li;
      }),
    );
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
    set('set-quality', s.quality !== 'low', s.quality === 'auto' ? `Automática · ${QUALITY_LABELS[this.autoQ.level]}` : QUALITY_LABELS[s.quality], QUALITY_LABELS.low);
    set('set-weather', s.weather, 'Variable', 'Siempre despejado');
    set('set-vibration', s.vibration, 'Sí', 'No');
    set('set-ghost', s.ghost, 'Sí', 'No');
    set('set-voice', s.voice, 'Sí', 'No');
    $<HTMLInputElement>('set-sensitivity').value = String(Math.round(s.sensitivity * 100));
    $('set-sensitivity-val').textContent = `${Math.round(s.sensitivity * 100)} %`;
    this.renderCloud();
  }

  private openHangar(tab: 'planes' | 'paints' | 'upgrades') {
    const pr = this.progress;
    show('hangar', true);
    $('hangar-credits').textContent = `${pr.p.credits} créditos`;
    document.querySelectorAll<HTMLElement>('#hangar-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const list = $('hangar-list');
    const withView = tab !== 'upgrades';
    show('showroom', withView);
    list.classList.toggle('with-view', withView);
    if (tab !== 'paints') this.hangarPaint = null;
    if (withView) this.updateShowroom();
    const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i style="--v:${Math.min(1, v / 1.6)}"></i></div>`;
    const refresh = () => {
      this.applyLoadout();
      this.openHangar(tab);
      this.refreshMenu();
    };
    if (tab === 'planes') {
      const section = (title: string, sub: string) => {
        const h = document.createElement('div');
        h.className = 'hg-section';
        h.innerHTML = `<b></b><small></small>`;
        (h.querySelector('b') as HTMLElement).textContent = title;
        (h.querySelector('small') as HTMLElement).textContent = sub;
        return h;
      };
      const item = (pl: (typeof PLANES)[number]) => {
        const owned = pr.p.planes.includes(pl.id);
        const sel = pr.p.plane === pl.id;
        const el = document.createElement('div');
        const focus = (this.hangarFocus ?? pr.p.plane) === pl.id;
        el.className = `hg-item plane${sel ? ' selected' : ''}${focus ? ' focus' : ''}${owned ? '' : ' locked'}${pl.tier === 'advanced' ? ' advanced' : ''}`;
        el.innerHTML = `<img class="hg-thumb" alt="" /><div class="hg-head"><b></b><small></small></div><div class="plane-stats">${bar('Velocidad', pl.speed)}${bar('Agilidad', pl.agility)}${bar('Blindaje', pl.armor)}</div><div class="weapon"><span class="wn"></span><span class="wd"></span></div>`;
        (el.querySelector('b') as HTMLElement).textContent = pl.name;
        (el.querySelector('small') as HTMLElement).textContent = pl.description;
        const img = el.querySelector('.hg-thumb') as HTMLImageElement;
        img.src = this.preview.thumb(pl.id, pr.paint.accent, pr.paint.body);
        img.alt = `Vista en planta del ${pl.name}`;
        el.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          this.hangarFocus = pl.id;
          list.querySelectorAll('.hg-item.plane').forEach((x) => x.classList.toggle('focus', x === el));
          this.updateShowroom();
        });
        (el.querySelector('.wn') as HTMLElement).textContent = pl.weapon.name;
        const missiles = pl.weapon.missiles > 4 ? ` · ${pl.weapon.missiles} misiles` : '';
        (el.querySelector('.wd') as HTMLElement).textContent = `${pl.weapon.description}${missiles}`;
        const btn = document.createElement('button');
        btn.className = sel ? 'secondary' : owned ? 'secondary strong' : 'primary small';
        btn.textContent = sel ? 'En uso' : owned ? 'Usar' : `Canjear · ${pl.cost}`;
        btn.disabled = sel || (!owned && pr.p.credits < pl.cost);
        if (!owned && pl.achievement) {
          const a = ACHIEVEMENTS.find((x) => x.id === pl.achievement);
          if (a) (el.querySelector('small') as HTMLElement).textContent += ` También con el logro «${a.name}».`;
        }
        btn.addEventListener('click', () => {
          if (owned) pr.select('plane', pl.id as PlaneId);
          else if (!pr.buyPlane(pl.id)) return;
          this.hangarFocus = pl.id;
          refresh();
        });
        el.append(btn);
        return el;
      };
      list.replaceChildren(
        section('Básicos', 'Diseños sencillos con cañones dobles.'),
        ...PLANES.filter((p) => p.tier === 'basic').map(item),
        section('Avanzados', 'Diseños evolucionados con armas mejores. Se canjean con créditos.'),
        ...PLANES.filter((p) => p.tier === 'advanced').map(item),
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
          (el.querySelector('small') as HTMLElement).textContent = owned ? 'Disponible' : ach ? `Logro: ${ach.name}` : pt.season ? `Pase de temporada · nivel ${pt.season}` : `${pt.cost} créditos`;
          el.style.cursor = 'pointer';
          el.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            this.hangarPaint = pt.id;
            this.updateShowroom();
          });
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

  /** Escaparate del hangar: avión enfocado girando en el aire (o en planta / perfil) */
  private updateShowroom() {
    const pr = this.progress;
    const pl = PLANES.find((x) => x.id === (this.hangarFocus ?? pr.p.plane)) ?? pr.plane;
    const paint = PAINTS.find((x) => x.id === this.hangarPaint) ?? pr.paint;
    $('sr-name').textContent = this.hangarPaint ? `${pl.name} · ${paint.name}` : pl.name;
    $('sr-desc').textContent = `${pl.weapon.name} · ${pl.description}`;
    $('showroom').classList.toggle('blueprint', this.previewMode !== '3d');
    document.querySelectorAll<HTMLElement>('.sr-modes button').forEach((b) => b.classList.toggle('active', b.dataset.view === this.previewMode));
    this.preview.show($<HTMLCanvasElement>('hangar-view'), pl.id, paint.accent, paint.body, this.previewMode);
  }

  /** Fichas de los aviones disponibles para elegir antes de jugar */
  private renderPlaneStrip(stripId: string, onPick: () => void) {
    const pr = this.progress;
    const owned = PLANES.filter((pl) => pr.p.planes.includes(pl.id));
    $(stripId).replaceChildren(
      ...owned.map((pl) => {
        const b = document.createElement('button');
        b.className = `plane-chip${pr.p.plane === pl.id ? ' selected' : ''}`;
        const img = document.createElement('img');
        img.src = this.preview.thumb(pl.id, pr.paint.accent, pr.paint.body);
        img.alt = '';
        b.append(img, pl.name);
        b.title = pl.description;
        b.addEventListener('click', () => {
          if (pr.p.plane === pl.id) return;
          pr.select('plane', pl.id);
          this.applyLoadout();
          onPick();
        });
        return b;
      }),
    );
  }

  /** Preparar vuelo: avión elegido en 3D + selector */
  private renderPlanePicker() {
    const pr = this.progress;
    const pl = pr.plane;
    $('pf-plane-name').textContent = pl.name;
    const sp = Math.round(pl.speed * 100);
    $('pf-plane-weapon').textContent = `${pl.weapon.name} · velocidad ${sp} % · blindaje ${Math.round(pl.armor * 100)} %`;
    this.renderPlaneStrip('pf-planes', () => this.renderPlanePicker());
    this.preview.show($<HTMLCanvasElement>('pf-plane-view'), pl.id, pr.paint.accent, pr.paint.body, '3d');
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

  /** Pantalla «Un jugador»: modos agrupados con el récord de cada uno */
  private openPlay() {
    const best = (k: string) => {
      switch (k) {
        case 'free': {
          const b = Number(store.get(`best.${this.stage.id}`) ?? 0);
          return b ? `Récord: ${b} anillos` : '';
        }
        case 'delivery': {
          const b = Number(store.get('best.delivery') ?? 0);
          return b ? `Récord: ${b} puntos` : '';
        }
        case 'waves': {
          const b = Number(store.get('best.waves') ?? 0);
          return b ? `Récord: oleada ${b}` : '';
        }
        case 'race': {
          const b = loadBest(courseId(this.stage.id, COURSES[0]));
          return b ? `Sprint: ${formatTime(b.time)}` : '';
        }
        case 'daily': {
          const t = this.dailyBest();
          return t !== undefined ? `Hoy: ${formatTime(t)}` : 'Sin completar hoy';
        }
      }
      return '';
    };
    document.querySelectorAll<HTMLElement>('#play [data-best]').forEach((el) => (el.textContent = best(el.dataset.best!)));
    const last = store.get('lastMode');
    document.querySelectorAll<HTMLElement>('#play .mode-card').forEach((b) => b.classList.toggle('last', b.dataset.mode === last));
    show('play', true);
  }

  /** Preparar vuelo: solo las opciones que necesita el modo elegido */
  private openPreflight(mode: PfMode) {
    if (mode === 'circuits') {
      this.openCircuits();
      return;
    }
    this.pfMode = mode;
    $('pf-title').textContent = PF_INFO[mode].title;
    $('pf-desc').textContent = PF_INFO[mode].desc;
    const battleLike = mode === 'battle' || mode === 'koth' || mode === 'tag' || mode === 'royale' || mode === 'boss';
    show('pf-course', mode === 'race');
    show('pf-stage', mode !== 'daily');
    show('pf-daily', mode === 'daily');
    if (mode === 'daily') {
      const d = dailyChallenge();
      $('pf-desc').textContent = `${dayLabel()}: el mismo circuito de ${d.def.gates} hitos para todos. Vuélalo de día o de noche; cada versión tiene su propia clasificación.`;
      this.renderDailyChoice();
    }
    show('pf-battle', battleLike);
    if (mode === 'race') this.renderCourses();
    if (battleLike) {
      const sel = $<HTMLSelectElement>('bp-bkind');
      const special = ['koth', 'tag', 'royale', 'boss'];
      for (const o of [...sel.options]) o.hidden = mode === 'battle' && special.includes(o.value);
      if (mode === 'battle') {
        if (special.includes(sel.value)) sel.value = 'ffa';
      } else sel.value = mode;
      const time = $<HTMLSelectElement>('bp-btime');
      if (mode === 'royale') time.value = '180';
      else if (mode === 'boss') time.value = '480';
      else if (time.value === '480') time.value = '300';
      if (mode === 'boss') $<HTMLInputElement>('bp-bots').value = '2';
      show('pf-bkind-field', mode === 'battle');
      show('bp-help', mode === 'battle');
      this.updateBattlePicker();
    }
    $('btn-go').textContent = 'Despegar';
    show('play', false);
    show('preflight', true);
    this.renderPlanePicker();
  }

  private renderDailyChoice() {
    for (const v of ['day', 'night'] as const) {
      const d = dailyChallenge(new Date(), v);
      const t = this.dailyBest(v);
      $(`dn-${v}-sub`).textContent = `${d.stage.name}${t !== undefined ? ` · tu mejor ${formatTime(t)}` : ''}`;
      $(`dn-${v}`).setAttribute('aria-pressed', String(this.dailyVariant === v));
    }
  }

  private renderCourses() {
    $('course-list').replaceChildren(
      ...COURSES.map((c) => {
        const b = document.createElement('button');
        b.className = `stage-card${c.id === this.pfCourse.id ? ' active' : ''}`;
        const best = loadBest(courseId(this.stage.id, c));
        const txt = document.createElement('span');
        const t = document.createElement('b');
        t.textContent = c.name;
        const d = document.createElement('small');
        d.textContent = `${c.description}${best ? ` · Tu récord ${formatTime(best.time)}` : ''}`;
        txt.append(t, d);
        b.append(txt);
        b.addEventListener('click', () => {
          this.pfCourse = c;
          this.renderCourses();
        });
        return b;
      }),
    );
  }

  private launchPreflight() {
    const mode = this.pfMode;
    store.set('lastMode', mode);
    show('preflight', false);
    switch (mode) {
      case 'free':
        this.startFree();
        break;
      case 'delivery':
        this.startDelivery();
        break;
      case 'waves':
        this.startWaves();
        break;
      case 'race':
        this.startRace(this.pfCourse);
        break;
      case 'daily':
        this.startDaily(this.dailyVariant);
        break;
      default:
        this.startBattle(this.readBattleForm('bp'));
    }
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
    const daily = dailyChallenge(new Date(), 'day');
    const dailyId = courseId(daily.stage.id, daily.def);
    const nightDaily = dailyChallenge(new Date(), 'night');
    const nightId = courseId(nightDaily.stage.id, nightDaily.def);
    const localBest = Number(store.get(`best.${stageId}`) ?? 0);
    if (!firebase.enabled) {
      const rows: HTMLElement[] = [li('Tus récords en este dispositivo', 'heading'), li(`Vuelo libre: ${localBest} anillos`)];
      for (const c of COURSES) {
        const b = loadBest(courseId(stageId, c));
        rows.push(li(`${c.name}: ${b ? formatTime(b.time) : 'sin tiempo'}`));
      }
      const db = this.dailyBest('day');
      const dn = this.dailyBest('night');
      rows.push(li(`Desafío de hoy (día): ${db !== undefined ? formatTime(db) : 'sin tiempo'}`));
      rows.push(li(`Desafío de hoy (noche): ${dn !== undefined ? formatTime(dn) : 'sin tiempo'}`));
      rows.push(li('Configura Firebase para ver la clasificación global.'));
      list.replaceChildren(...rows);
      return;
    }
    try {
      const uid = await firebase.uid();
      const [dailyTimes, nightTimes, rings, ...times] = await Promise.all([
        firebase.topTimes(dailyId, 10),
        firebase.topTimes(nightId, 10),
        firebase.top(stageId),
        ...COURSES.map((c) => firebase.topTimes(courseId(stageId, c), 5)),
      ]);
      const rows: HTMLElement[] = [];
      for (const [label, list] of [['de día', dailyTimes], ['de noche', nightTimes]] as const) {
        rows.push(li(`Desafío diario ${label} · ${dayLabel()}`, 'heading'));
        if (!list.length) rows.push(li('Nadie lo ha completado todavía hoy.'));
        list.forEach((t, i) => rows.push(this.boardRow(i + 1, t.name, '', formatTime(t.timeMs / 1000), t.uid === uid)));
      }
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

/** ¿Hay un objetivo fijado? (para no tapar su marcador) */
function lockFor(g: Game) {
  return !!(g.alive && g.guns.lock);
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
