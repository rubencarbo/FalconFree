import * as THREE from 'three';
import { Flight, JetModel, type PlaneVariant } from './jet';

export type PreviewMode = '3d' | 'top' | 'side';

interface Active {
  canvas: HTMLCanvasElement;
  variant: PlaneVariant;
  accent: number;
  body: number;
  mode: PreviewMode;
}

/**
 * Visor de aviones del hangar y de «Preparar vuelo».
 * Un único renderizador WebGL fuera de pantalla dibuja:
 *  - la vista 3D girando en el aire (se copia cada frame al lienzo visible)
 *  - vistas 2D fijas (planta y perfil) para las miniaturas de las fichas
 */
export class PlanePreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(30, 1, 0.5, 500);
  private ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
  private jet: JetModel | null = null;
  private jetKey = '';
  private radius = 10;
  private box = new THREE.Box3();
  private flight = new Flight();
  private thumbs = new Map<string, string>();
  private active: Active | null = null;
  private raf = 0;
  private t = 0;
  private last = 0;
  /** dejar hueco abajo para el texto (vista en lienzo grande) */
  private lift = false;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x404a5a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 12, 8);
    const rim = new THREE.DirectionalLight(0x9fd8ff, 0.7);
    rim.position.set(-8, 4, -10);
    this.scene.add(sun, rim);
  }

  private gl() {
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setClearColor(0x000000, 0);
      } catch {
        this.renderer = null;
      }
    }
    return this.renderer;
  }

  /** Prepara el modelo (reutiliza el actual si no cambia) */
  private model(variant: PlaneVariant, accent: number, body: number) {
    const key = `${variant}|${accent}|${body}`;
    if (this.jet && this.jetKey === key) return this.jet;
    if (this.jet) {
      this.scene.remove(this.jet.group);
      disposeGroup(this.jet.group);
    }
    this.jet = new JetModel(accent, body, variant);
    this.jetKey = key;
    this.scene.add(this.jet.group);
    // Tamaño para encuadrar
    this.flight.reset(0, 0, 0, 0);
    this.flight.thrust = 0.5;
    this.jet.update(this.flight, 0);
    this.jet.group.updateMatrixWorld(true);
    this.box.setFromObject(this.jet.group);
    this.radius = this.box.getBoundingSphere(new THREE.Sphere()).radius;
    return this.jet;
  }

  /** Coloca el avión quieto (vistas 2D) y ajusta la cámara ortográfica */
  private pose2d(mode: 'top' | 'side', aspect: number) {
    const jet = this.jet!;
    this.flight.pos.set(0, 0, 0);
    this.flight.yaw = 0;
    this.flight.pitch = 0;
    this.flight.roll = 0;
    this.flight.thrust = 0.45;
    jet.update(this.flight, 0);
    const b = this.box;
    const c = b.getCenter(new THREE.Vector3());
    const s = b.getSize(new THREE.Vector3());
    // ancho y alto visibles del avión en cada vista
    const w = mode === 'top' ? s.x : s.z;
    const h = mode === 'top' ? s.z : s.y;
    const half = Math.max(w / aspect, h) * 0.54;
    const cam = this.ortho;
    cam.left = -half * aspect;
    cam.right = half * aspect;
    cam.top = half;
    cam.bottom = -half;
    // Desplazar el avión un poco hacia arriba para dejar sitio al nombre (abajo)
    if (this.lift) {
      if (mode === 'top') c.z += half * 0.22;
      else c.y -= half * 0.22;
    }
    if (mode === 'top') {
      cam.position.set(c.x, 80, c.z);
      cam.up.set(0, 0, -1);
    } else {
      cam.position.set(80, c.y, c.z);
      cam.up.set(0, 1, 0);
    }
    cam.lookAt(c);
    cam.updateProjectionMatrix();
  }

  /** Miniatura 2D (vista en planta) en PNG. Se guarda en caché. */
  thumb(variant: PlaneVariant, accent: number, body: number, mode: 'top' | 'side' = 'top'): string {
    const key = `${variant}|${accent}|${body}|${mode}`;
    const hit = this.thumbs.get(key);
    if (hit) return hit;
    const r = this.gl();
    if (!r) return '';
    this.model(variant, accent, body);
    const W = 240;
    const H = 160;
    r.setPixelRatio(1);
    r.setSize(W, H, false);
    this.lift = false;
    this.pose2d(mode, W / H);
    r.render(this.scene, this.ortho);
    const url = r.domElement.toDataURL('image/png');
    this.thumbs.set(key, url);
    return url;
  }

  /** Muestra el avión en un lienzo visible (3D girando o 2D) */
  show(canvas: HTMLCanvasElement, variant: PlaneVariant, accent: number, body: number, mode: PreviewMode = '3d') {
    this.active = { canvas, variant, accent, body, mode };
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(() => this.loop());
    }
  }

  setMode(mode: PreviewMode) {
    if (this.active) this.active.mode = mode;
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.active = null;
  }

  private loop() {
    const a = this.active;
    // Se para solo cuando el lienzo deja de verse
    if (!a || !a.canvas.isConnected || a.canvas.offsetParent === null) {
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const r = this.gl();
    if (!r) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(a.canvas.clientWidth * dpr));
    const H = Math.max(1, Math.round(a.canvas.clientHeight * dpr));
    if (a.canvas.width !== W || a.canvas.height !== H) {
      a.canvas.width = W;
      a.canvas.height = H;
    }
    const jet = this.model(a.variant, a.accent, a.body);
    r.setPixelRatio(1);
    r.setSize(W, H, false);
    if (a.mode === '3d') {
      const t = this.t;
      const f = this.flight;
      f.pos.set(0, Math.sin(t * 1.3) * this.radius * 0.05, 0);
      f.yaw = t * 0.55;
      f.roll = Math.sin(t * 0.9) * 0.32;
      f.pitch = Math.sin(t * 0.7) * 0.1;
      f.thrust = 0.6 + Math.max(0, Math.sin(t * 0.5)) * 0.4;
      jet.update(f, t);
      const cam = this.persp;
      cam.aspect = W / H;
      const fit = this.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) / Math.min(1, cam.aspect);
      cam.position.set(0, this.radius * 0.5, fit * 0.72);
      cam.lookAt(0, -this.radius * 0.28, 0);
      cam.updateProjectionMatrix();
      r.render(this.scene, cam);
    } else {
      this.lift = true;
      this.pose2d(a.mode, W / H);
      r.render(this.scene, this.ortho);
    }
    const ctx = a.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(r.domElement, 0, 0, W, H);
  }
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
