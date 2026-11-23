import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { drawIcon, type IconId } from './identity';

/** Flecha 3D que flota delante del avión y apunta al siguiente objetivo */
/**
 * Flecha guía: una flecha plana y grande en el HUD, alrededor del avión.
 * Solo aparece cuando el objetivo no está a la vista y señala hacia dónde girar.
 */
export class GuideArrow {
  camera: THREE.Camera | null = null;
  private el: HTMLElement;
  private v = new THREE.Vector3();
  private shown = false;

  constructor(_scene?: THREE.Scene) {
    this.el = document.getElementById('guide-arrow')!;
  }

  private hide() {
    if (!this.shown) return;
    this.shown = false;
    this.el.classList.remove('show');
  }

  update(planePos: THREE.Vector3, yaw: number, target: THREE.Vector3 | null, visible: boolean, color?: number) {
    const cam = this.camera;
    if (!target || !visible || !cam) {
      this.hide();
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const p = this.v.copy(target).project(cam);
    const behind = p.z > 1;
    // Objetivo delante y dentro de la pantalla: basta con el rombo, sin flecha
    if (!behind && Math.abs(p.x) < 0.75 && Math.abs(p.y) < 0.7) {
      this.hide();
      return;
    }
    let ang: number;
    if (!behind) {
      // Dirección en pantalla hacia el objetivo (0 = arriba)
      ang = Math.atan2(p.x * W, p.y * H);
    } else {
      // Detrás: girar hacia el lado más corto (izquierda o derecha)
      const dx = target.x - planePos.x;
      const dz = target.z - planePos.z;
      const fwd = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
      const side = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
      const bearing = Math.atan2(side, fwd);
      ang = Math.sign(bearing || 1) * Math.min(Math.abs(bearing), Math.PI * 0.62);
    }
    const R = Math.min(W, H) * 0.2;
    const cx = W / 2 + Math.sin(ang) * R;
    const cy = H * 0.52 - Math.cos(ang) * R;
    this.el.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) rotate(${ang.toFixed(3)}rad)`;
    this.el.style.color = color !== undefined ? `#${color.toString(16).padStart(6, '0')}` : '#40e0ff';
    if (!this.shown) {
      this.shown = true;
      this.el.classList.add('show');
    }
  }

  dispose(_scene?: THREE.Scene) {
    this.hide();
  }
}

const TRAIL_MAX = 110;

export type TrailStyle = 'dots' | 'chevrons' | 'line' | 'near' | 'bright' | 'off';

interface TrailSpec {
  shape: 'dot' | 'chevron' | 'dash';
  /** separación entre marcas (m) */
  gap: number;
  /** tamaño base */
  size: number;
  /** opacidad (sin brillo: los colores nunca superan 1, así el bloom no los infla) */
  opacity: number;
  /** solo hasta el siguiente hito */
  nextOnly: boolean;
  /** distancia máxima dibujada (m) */
  maxDist: number;
  /** estilo antiguo, muy brillante (solo para comparar) */
  glow?: boolean;
}

export const TRAIL_STYLES: Record<Exclude<TrailStyle, 'off'>, TrailSpec> = {
  dots: { shape: 'dot', gap: 80, size: 2.3, opacity: 0.75, nextOnly: true, maxDist: 4000 },
  chevrons: { shape: 'chevron', gap: 120, size: 2.2, opacity: 0.7, nextOnly: true, maxDist: 4000 },
  line: { shape: 'dash', gap: 30, size: 2.4, opacity: 0.5, nextOnly: true, maxDist: 4000 },
  near: { shape: 'chevron', gap: 60, size: 1.8, opacity: 0.75, nextOnly: false, maxDist: 450 },
  bright: { shape: 'chevron', gap: 52, size: 1, opacity: 1, nextOnly: false, maxDist: 6000, glow: true },
};

export const TRAIL_LABELS: Record<TrailStyle, string> = {
  dots: 'Puntos',
  chevrons: 'Flechas sueltas',
  line: 'Línea fina',
  near: 'Solo cerca',
  bright: 'Brillante (antigua)',
  off: 'Sin estela',
};

export const TRAIL_HELP: Record<TrailStyle, string> = {
  chevrons: 'Flechas pequeñas y espaciadas hasta el siguiente hito: marcan el sentido sin formar un pasillo.',
  dots: 'Puntos suaves que dibujan la curva hasta el siguiente hito.',
  line: 'Trazos finos discontinuos, como una pista punteada en el cielo.',
  near: 'Solo unas pocas flechas en los próximos 450 m: hacia dónde girar ahora.',
  bright: 'Flechas de neón muy juntas hasta dos hitos.',
  off: 'Solo el rombo del hito, su haz de luz y la flecha guía.',
};

/**
 * Estela del camino: marcas discretas en el cielo hacia el siguiente hito
 * (y el posterior), entrando de frente por cada hito.
 */
export class RouteTrail {
  style: TrailStyle = 'chevrons';
  /** Ajustes del jugador (separación e intensidad); null = los de la forma */
  tune: { gap: number; opacity: number } | null = null;
  private meshes = new Map<string, THREE.InstancedMesh>();
  private mats: THREE.MeshBasicMaterial[] = [];
  private curve: THREE.CatmullRomCurve3 | null = null;
  private curveKey = '';
  private len = 0;
  private phase = 0;
  private refreshT = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private c = new THREE.Color();
  private base = new THREE.Color();
  private look = new THREE.Matrix4();
  private up = new THREE.Vector3(0, 1, 0);
  private p = new THREE.Vector3();
  private t = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    const arm = (side: number) => {
      const g = new THREE.BoxGeometry(1.1, 0.6, 8);
      g.rotateY(side * 0.62);
      g.translate(side * 2.3, 0, 1.8);
      return g.toNonIndexed();
    };
    this.add('chevron', mergeGeometries([arm(1), arm(-1)]), false);
    this.add('chevron-glow', mergeGeometries([arm(1), arm(-1)]), true);
    this.add('dot', new THREE.IcosahedronGeometry(2.2, 1), false);
    this.add('dash', new THREE.BoxGeometry(0.7, 0.7, 14), false);
  }

  private add(key: string, geo: THREE.BufferGeometry, glow: boolean) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      fog: !glow,
    });
    this.mats.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, TRAIL_MAX);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TRAIL_MAX * 3), 3);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    this.meshes.set(key, mesh);
  }

  /** points: camino (null para ocultar); nextEnd: índice del último punto hasta el siguiente hito */
  update(dt: number, points: THREE.Vector3[] | null, color = 0x40e0ff, nextEnd = Infinity) {
    for (const m of this.meshes.values()) m.count = 0;
    if (this.style === 'off' || !points || points.length < 2) {
      this.curve = null;
      return;
    }
    const base = TRAIL_STYLES[this.style];
    const spec = this.tune && !base.glow ? { ...base, gap: this.tune.gap, opacity: this.tune.opacity } : base;
    const pts = spec.nextOnly ? points.slice(0, Math.min(points.length, nextEnd + 1)) : points;
    if (pts.length < 2) return;
    this.refreshT -= dt;
    const key = `${this.style}|${pts.length}`;
    if (!this.curve || this.refreshT <= 0 || key !== this.curveKey) {
      this.refreshT = 0.15;
      this.curveKey = key;
      this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      this.len = this.curve.getLength();
    }
    const curve = this.curve;
    const L = Math.min(this.len, spec.maxDist);
    if (L < 20) return;
    const mesh = this.meshes.get(spec.glow ? 'chevron-glow' : spec.shape)!;
    (mesh.material as THREE.MeshBasicMaterial).opacity = spec.glow ? 1 : spec.opacity;
    this.phase = (this.phase + dt * (spec.shape === 'dash' ? 40 : 60)) % spec.gap;
    this.base.setHex(color);
    if (spec.glow) this.base.setHex(0x40e0ff).multiplyScalar(1.6);
    const n = Math.min(TRAIL_MAX, Math.floor(L / spec.gap) + 1);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const d = i * spec.gap + this.phase;
      if (d > L) break;
      const u = d / this.len;
      curve.getPointAt(u, this.p);
      curve.getTangentAt(u, this.t);
      this.look.lookAt(this.p, this.t.add(this.p), this.up);
      this.q.setFromRotationMatrix(this.look);
      // Nada justo delante del avión; aparece y se apaga encogiendo (no oscureciendo)
      const fadeIn = THREE.MathUtils.clamp((d - 70) / 160, 0, 1);
      const fadeOut = Math.min(1, (L - d) / (spec.maxDist < 1000 ? 160 : 80));
      const k01 = fadeIn * fadeOut;
      this.s.setScalar(spec.size * (1 + Math.min(1.6, d / 500)) * (spec.glow ? 1 : k01));
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(k, this.m);
      this.c.copy(this.base).multiplyScalar(spec.glow ? k01 : 1);
      mesh.setColorAt(k, this.c);
      k++;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

export type RadarKind = 'gate' | 'gate2' | 'ring' | 'power' | 'enemy' | 'ally' | 'drone' | 'ghost';

export interface RadarItem {
  pos: THREE.Vector3;
  kind: RadarKind;
  color?: string;
  label?: string;
  /** Icono del piloto (aliados y enemigos) */
  icon?: IconId;
}

const RADAR_COLORS: Record<RadarKind, string> = {
  gate: '#40e0ff',
  gate2: 'rgba(255,255,255,0.55)',
  ring: '#ff9a2a',
  power: '#5cff8a',
  enemy: '#ff4040',
  ally: '#5cc8ff',
  drone: '#ff6a6a',
  ghost: 'rgba(150,200,255,0.8)',
};

/** Radar circular orientado al rumbo del avión */
export class Radar {
  private ctx: CanvasRenderingContext2D;
  range = 2000;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  draw(me: THREE.Vector3, yaw: number, items: RadarItem[], route: THREE.Vector3[] = [], circles: { pos: THREE.Vector3; r: number; color: string }[] = []) {
    const c = this.canvas;
    const css = c.clientWidth || 120;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(css * dpr)) {
      c.width = c.height = Math.round(css * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = css / 2;
    ctx.clearRect(0, 0, css, css);

    // Fondo
    ctx.fillStyle = 'rgba(8,14,26,0.62)';
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,220,255,0.35)';
    ctx.lineWidth = 1;
    for (const k of [0.5, 1]) {
      ctx.beginPath();
      ctx.arc(R, R, (R - 2) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(R, 4);
    ctx.lineTo(R, css - 4);
    ctx.moveTo(4, R);
    ctx.lineTo(css - 4, R);
    ctx.strokeStyle = 'rgba(120,220,255,0.15)';
    ctx.stroke();

    const scale = (R - 8) / this.range;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // mundo -> radar (arriba = hacia donde apunta el morro)
    const toRadar = (p: THREE.Vector3) => {
      const dx = p.x - me.x;
      const dz = p.z - me.z;
      // rotar por el rumbo: el morro mira a (-sin, -cos)
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      return { x: rx * scale, y: rz * scale, dist: Math.hypot(dx, dz) };
    };

    // Zonas (tormenta de Supervivencia)
    if (circles.length) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, R - 2, 0, Math.PI * 2);
      ctx.clip();
      for (const c of circles) {
        const q = toRadar(c.pos);
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(R + q.x, R + q.y, Math.max(2, c.r * scale), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Ruta
    if (route.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, R - 3, 0, Math.PI * 2);
      ctx.clip();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(64,224,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      route.forEach((p, i) => {
        const q = toRadar(p);
        if (i === 0) ctx.moveTo(R + q.x, R + q.y);
        else ctx.lineTo(R + q.x, R + q.y);
      });
      ctx.stroke();
      ctx.restore();
    }

    for (const it of items) {
      const q = toRadar(it.pos);
      let x = q.x;
      let y = q.y;
      const len = Math.hypot(x, y);
      const max = R - 7;
      const outside = len > max;
      if (outside) {
        x = (x / len) * max;
        y = (y / len) * max;
      }
      const color = it.color ?? RADAR_COLORS[it.kind];
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      if (it.icon) {
        drawIcon(ctx, it.icon, R + x, R + y, outside ? 4.5 : 6.5, color);
        if (it.kind === 'enemy') {
          ctx.strokeStyle = '#ff3030';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(R + x, R + y, outside ? 7 : 9.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        continue;
      }
      ctx.save();
      ctx.translate(R + x, R + y);
      if (outside && (it.kind === 'gate' || it.kind === 'enemy' || it.kind === 'ally')) {
        // flecha en el borde
        ctx.rotate(Math.atan2(y, x) + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(5, 3);
        ctx.lineTo(-5, 3);
        ctx.closePath();
        ctx.fill();
      } else if (it.kind === 'gate' || it.kind === 'gate2') {
        ctx.rotate(Math.PI / 4);
        ctx.lineWidth = 2;
        const s = it.kind === 'gate' ? 6 : 4;
        ctx.strokeRect(-s / 2, -s / 2, s, s);
      } else if (it.kind === 'enemy' || it.kind === 'ally') {
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const s = it.kind === 'ring' ? 2.5 : 3;
        ctx.fillRect(-s / 2, -s / 2, s, s);
      }
      ctx.restore();
      if (it.label && !outside) {
        ctx.font = '700 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(it.label, R + x, R + y - 7);
      }
    }

    // Yo
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(R, R - 6);
    ctx.lineTo(R + 4.5, R + 5);
    ctx.lineTo(R, R + 2.5);
    ctx.lineTo(R - 4.5, R + 5);
    ctx.closePath();
    ctx.fill();
    // N
    const n = toRadar(new THREE.Vector3(me.x, 0, me.z - this.range * 2));
    const nl = Math.hypot(n.x, n.y) || 1;
    ctx.fillStyle = '#ff7a5a';
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', R + (n.x / nl) * (R - 9), R + (n.y / nl) * (R - 9));
    ctx.textBaseline = 'alphabetic';
  }
}
