import './style.css';
import * as THREE from 'three';
import { STAGES, getStage, type Stage, type StageId } from './stages';
import { CityGen } from './world/city';
import { ChunkManager } from './world/chunks';
import { Flight, JetModel, CRUISE_KMH, BOOST_KMH } from './jet';
import { CameraRig, CAMERA_LABELS, CAMERA_MODES } from './cameraRig';
import { Contrails, Explosion, FarGround, Rings, Sky } from './effects';
import { Input } from './input';
import { Hud } from './hud';
import { GameAudio } from './audio';
import { firebase } from './firebase';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type State = 'menu' | 'flying' | 'paused' | 'crashed';

const isTouch = matchMedia('(hover: none), (pointer: coarse)').matches;
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(`ff.${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(`ff.${k}`, v);
    } catch {
      /* sin almacenamiento */
    }
  },
};

class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 1, 9000);
  rig = new CameraRig(this.camera);
  flight = new Flight();
  jet = new JetModel();
  hud = new Hud();
  audio = new GameAudio();
  input: Input;

  stage!: Stage;
  gen!: CityGen;
  chunks!: ChunkManager;
  rings!: Rings;
  sky!: Sky;
  far!: FarGround;
  contrails!: Contrails;
  explosion!: Explosion;
  hemi!: THREE.HemisphereLight;
  sun!: THREE.DirectionalLight;

  state: State = 'menu';
  ringCount = 0;
  private clock = new THREE.Timer();
  private time = 0;
  private crashTimer = 0;
  private warnTimer = 0;
  private prevPos = new THREE.Vector3();
  private stageListEls: HTMLElement[] = [];

  constructor() {
    const canvas = $<HTMLCanvasElement>('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(this.jet.group);

    this.input = new Input($('joy-zone'), $('joy-base'), $('joy-knob'), $('btn-boost'), $('btn-climb'));
    this.input.invertY = store.get('invertY') === '1';
    this.input.onCamera = () => this.cycleCamera();
    this.input.onPause = () => (this.state === 'flying' ? this.pause() : this.state === 'paused' ? this.resume() : undefined);
    this.input.onBoostStart = () => {
      if (this.state === 'flying') this.hud.toast('¡Turbo!');
    };

    this.loadStage(getStage(store.get('stage')));
    this.setupUi();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'flying') this.pause();
    });

    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------ Mundo
  loadStage(stage: Stage) {
    if (this.chunks) this.disposeWorld();
    this.stage = stage;
    store.set('stage', stage.id);
    this.gen = new CityGen(stage);
    const radius = isTouch ? 5 : 7;
    this.chunks = new ChunkManager(this.scene, this.gen, radius);
    this.rings = new Rings(this.scene, this.gen);
    this.chunks.onChunkAdded = (cx, cz) => this.rings.addChunk(cx, cz);
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
    this.explosion = new Explosion(this.scene);
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.spawn();
    this.chunks.warmup(this.flight.pos.x, this.flight.pos.z, 12);
    this.refreshStageLists();
  }

  private disposeWorld() {
    this.chunks.dispose();
    this.rings.dispose();
    this.scene.remove(this.sky.mesh, this.far.mesh, this.hemi, this.sun);
    this.sky.dispose();
    this.far.dispose();
    this.contrails.dispose(this.scene);
    this.explosion.dispose(this.scene);
  }

  spawn() {
    const yaw = Math.random() * Math.PI * 2;
    const alt = Math.max(420, this.gen.maxHeightNear(0, 0, 400) + 120);
    this.flight.reset(0, alt, 0, yaw);
    this.prevPos.copy(this.flight.pos);
    this.ringCount = 0;
    this.jet.group.visible = true;
    this.contrails.reset();
    this.rings.respawnAll(this.chunks.loaded());
    this.rig.snap();
  }

  // ------------------------------------------------------------ Estados
  startFlight() {
    this.audio.init();
    this.spawn();
    this.setState('flying');
    this.hud.toast('¡Despegue!');
  }

  pause() {
    this.setState('paused');
  }

  resume() {
    this.setState('flying');
    this.clock.update();
  }

  toMenu() {
    this.spawn();
    this.setState('menu');
  }

  private setState(s: State) {
    this.state = s;
    $('menu').classList.toggle('hidden', s !== 'menu');
    $('pause').classList.toggle('hidden', s !== 'paused');
    $('crash').classList.add('hidden');
    this.hud.show(s === 'flying' || s === 'paused' || s === 'crashed');
    if (s !== 'flying') this.input.reset();
    if (s === 'menu') {
      this.rig.mode = 'chase';
      this.hud.setCockpit(false);
      this.jet.group.visible = true;
    }
    this.updateViewButton();
  }

  cycleCamera() {
    if (this.state !== 'flying') return;
    const i = CAMERA_MODES.indexOf(this.rig.mode);
    this.rig.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    this.rig.snap();
    this.hud.setCockpit(this.rig.mode === 'cockpit');
    this.hud.toast(`Vista: ${CAMERA_LABELS[this.rig.mode]}`);
    this.updateViewButton();
  }

  private updateViewButton() {
    $('btn-view').textContent = `Vista: ${CAMERA_LABELS[this.rig.mode]}`;
  }

  private crash() {
    if (this.state !== 'flying') return;
    this.state = 'crashed';
    this.audio.explosion();
    this.audio.engine(0, 0, false);
    this.explosion.trigger(this.flight.pos, this.flight.forward().multiplyScalar(this.flight.speed));
    this.jet.group.visible = false;
    this.rig.addShake(6);
    this.hud.warning(false);
    if (this.rig.mode === 'cockpit') {
      this.rig.mode = 'chase';
      this.hud.setCockpit(false);
      this.rig.snap();
    }
    this.crashTimer = 0;

    const rings = this.ringCount;
    const key = `best.${this.stage.id}`;
    const prevBest = Number(store.get(key) ?? 0);
    const best = Math.max(prevBest, rings);
    store.set(key, String(best));
    $('crash-rings').textContent = String(rings);
    $('crash-speed').textContent = `${Math.round(this.flight.maxSpeedKmh)}`;
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

  private pilotName() {
    return ($<HTMLInputElement>('pilot-name').value.trim() || 'Piloto').slice(0, 16);
  }

  // ------------------------------------------------------------ Bucle
  private frame() {
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;

    if (this.state === 'flying') this.updateFlying(dt);
    else if (this.state === 'menu') this.updateMenu(dt);
    else if (this.state === 'crashed') {
      this.crashTimer += dt;
      if (this.crashTimer > 1.4 && $('crash').classList.contains('hidden')) $('crash').classList.remove('hidden');
    }

    this.explosion.update(dt);
    if (this.state !== 'paused') {
      const speedFactor = THREE.MathUtils.clamp((this.flight.speedKmh - CRUISE_KMH) / (BOOST_KMH - CRUISE_KMH), 0, 1);
      if (this.state !== 'crashed') this.rig.update(dt, this.flight, speedFactor);
      else this.rig.update(dt * 0.15, this.flight, 0);
    }
    this.jet.update(this.flight, this.time);
    this.jet.group.visible = this.state !== 'crashed' && this.rig.mode !== 'cockpit';
    this.contrails.setVisible(this.rig.mode !== 'cockpit');

    this.chunks.update(this.flight.pos.x, this.flight.pos.z);
    this.far.update(this.flight.pos);
    this.sky.update(this.camera);
    this.sun.position.copy(this.flight.pos).add(new THREE.Vector3(...this.stage.sun.dir).multiplyScalar(100));
    this.sun.target.position.copy(this.flight.pos);
    this.sun.target.updateMatrixWorld();
    $('loading').classList.toggle('hidden', this.chunks.loadingCount < 30 || this.state === 'menu');

    if (this.state !== 'menu') {
      this.hud.update({
        flight: this.flight,
        rings: this.ringCount,
        groundClearance: this.flight.pos.y - this.gen.heightAt(this.flight.pos.x, this.flight.pos.z),
        ringTarget: this.state === 'flying' ? this.rings.nearest(this.flight.pos) : null,
        camera: this.camera,
        cockpit: this.rig.mode === 'cockpit' && this.state !== 'crashed',
      });
    }

    this.renderer.render(this.scene, this.camera);
  }

  private updateFlying(dt: number) {
    const input = this.input.read();
    const f = this.flight;
    // Subpasos para no atravesar edificios a gran velocidad
    const steps = Math.max(1, Math.ceil((f.speed * dt) / 4));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.prevPos.copy(f.pos);
      f.update(sdt, input);
      const got = this.rings.update(sdt, this.prevPos, f.pos);
      if (got) {
        this.ringCount += got;
        this.audio.ring();
        this.hud.toast(`+${got} anillo · ${this.ringCount}`);
      }
      if (this.checkCollision()) {
        this.crash();
        return;
      }
    }

    // Aviso de proximidad al suelo
    const clearance = f.pos.y - this.gen.maxHeightNear(f.pos.x, f.pos.z, 60);
    const sinking = f.pitch < -0.12;
    const warn = clearance < 90 && sinking;
    this.hud.warning(warn);
    if (warn) {
      this.warnTimer -= dt;
      if (this.warnTimer <= 0) {
        this.audio.warning();
        this.warnTimer = 0.45;
      }
    }

    const speed01 = THREE.MathUtils.clamp(f.speedKmh / BOOST_KMH, 0, 1);
    this.audio.engine(speed01, f.thrust, true);

    // Estelas desde las puntas de las alas
    const q = this.jet.group.quaternion;
    const tips = this.jet.wingTips.map((t) => t.clone().applyQuaternion(q).add(this.jet.group.position));
    this.jet.update(f, this.time);
    this.contrails.update(tips);
  }

  private checkCollision(): boolean {
    const f = this.flight;
    if (f.pos.y < 1.5) return true;
    const fwd = f.forward(new THREE.Vector3());
    const nose = f.pos.clone().addScaledVector(fwd, 9);
    const right = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
    const tilt = Math.sin(f.roll) * 6;
    const pts = [
      f.pos,
      nose,
      f.pos.clone().addScaledVector(right, 6).setY(f.pos.y - tilt),
      f.pos.clone().addScaledVector(right, -6).setY(f.pos.y + tilt),
    ];
    for (const p of pts) {
      if (p.y < 1) return true;
      const h = this.gen.heightAt(p.x, p.z);
      if (h > 0 && p.y < h + 0.5) return true;
    }
    return false;
  }

  private updateMenu(dt: number) {
    // Vuelo automático de fondo
    const cruiseAlt = Math.max(420, this.gen.maxHeightNear(this.flight.pos.x, this.flight.pos.z, 300) + 120);
    const input = { x: 0.18, y: THREE.MathUtils.clamp((cruiseAlt - this.flight.pos.y) / 200, -1, 1), boost: false, climb: false };
    this.prevPos.copy(this.flight.pos);
    this.flight.update(dt, input);
    if (this.checkCollision()) this.spawn();
    const q = this.jet.group.quaternion;
    const tips = this.jet.wingTips.map((t) => t.clone().applyQuaternion(q).add(this.jet.group.position));
    this.contrails.update(tips);
    this.audio.engine(0, 0, false);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ UI
  private setupUi() {
    const name = $<HTMLInputElement>('pilot-name');
    name.value = store.get('name') ?? '';
    name.addEventListener('change', () => store.set('name', name.value.trim()));

    this.buildStageList($('stage-list'), (s) => {
      if (s.id !== this.stage.id) this.loadStage(s);
    });
    this.buildStageList($('stage-list-2'), (s) => {
      $('stage-picker').classList.add('hidden');
      if (s.id !== this.stage.id) this.loadStage(s);
      else this.spawn();
      this.setState('flying');
      this.hud.toast(s.name);
    });

    $('btn-start').addEventListener('click', () => {
      store.set('name', name.value.trim());
      this.startFlight();
    });
    $('btn-view').addEventListener('click', () => this.cycleCamera());
    $('btn-pause').addEventListener('click', () => this.pause());
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-pause-menu').addEventListener('click', () => this.toMenu());
    $('btn-retry').addEventListener('click', () => this.startFlight());
    $('btn-crash-menu').addEventListener('click', () => this.toMenu());
    $('btn-stage').addEventListener('click', () => {
      if (this.state === 'flying') this.state = 'paused';
      this.input.reset();
      $('stage-picker').classList.remove('hidden');
    });
    $('btn-board').addEventListener('click', () => this.openBoard(this.stage.id));

    const sound = $('btn-sound');
    const applySound = () => (sound.textContent = `Sonido: ${this.audio.muted ? 'no' : 'sí'}`);
    this.audio.muted = store.get('muted') === '1';
    applySound();
    sound.addEventListener('click', () => {
      this.audio.setMuted(!this.audio.muted);
      store.set('muted', this.audio.muted ? '1' : '0');
      applySound();
    });

    const inv = $('btn-invert');
    const applyInv = () => (inv.textContent = `Eje Y: ${this.input.invertY ? 'invertido' : 'normal'}`);
    applyInv();
    inv.addEventListener('click', () => {
      this.input.invertY = !this.input.invertY;
      store.set('invertY', this.input.invertY ? '1' : '0');
      applyInv();
    });

    document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) =>
      b.addEventListener('click', () => {
        const ov = b.closest('.overlay')!;
        ov.classList.add('hidden');
        if (ov.id === 'stage-picker' && this.state === 'paused') {
          this.state = 'flying';
          this.clock.update();
        }
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
      fb.textContent = 'Modo local: configura Firebase (.env.local) para la clasificación online';
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
    $('board').classList.remove('hidden');
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
    const li = (text: string) => {
      const el = document.createElement('li');
      el.className = 'empty';
      el.textContent = text;
      return el;
    };
    list.replaceChildren(li('Cargando…'));
    const localBest = Number(store.get(`best.${stageId}`) ?? 0);
    if (!firebase.enabled) {
      list.replaceChildren(li(`Tu récord local: ${localBest} anillos`), li('Configura Firebase para ver la clasificación global.'));
      return;
    }
    try {
      const [rows, uid] = await Promise.all([firebase.top(stageId), firebase.uid()]);
      if (!rows.length) {
        list.replaceChildren(li('Aún no hay puntuaciones. ¡Sé el primero!'));
        return;
      }
      list.replaceChildren(
        ...rows.map((r, i) => {
          const el = document.createElement('li');
          if (r.uid === uid) el.classList.add('me');
          const pos = document.createElement('span');
          pos.className = 'pos';
          pos.textContent = String(i + 1);
          const n = document.createElement('span');
          n.textContent = r.name;
          const sp = document.createElement('span');
          sp.className = 'speed';
          sp.textContent = `${r.maxSpeed} km/h`;
          const rg = document.createElement('b');
          rg.textContent = `${r.rings} ◎`;
          el.append(pos, n, sp, rg);
          return el;
        }),
      );
    } catch (e) {
      console.warn(e);
      list.replaceChildren(li('No se pudo cargar la clasificación.'));
    }
  }
}

new Game();
