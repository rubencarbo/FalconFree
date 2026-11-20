import * as THREE from 'three';
import type { Flight } from './jet';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const GREEN = '#46ff7a';


export interface HudData {
  flight: Flight;
  rings: number;
  groundClearance: number;
  ringTarget: THREE.Vector3 | null;
  camera: THREE.PerspectiveCamera;
  cockpit: boolean;
}

export class Hud {
  root = $('hud');
  private speed = $('hud-speed');
  private rings = $('hud-rings');
  private alt = $('hud-alt');
  private marker = $('ring-marker');
  private markerDist = $('ring-dist');
  private toastEl = $('toast');
  private warningEl = $('warning');
  private canvas = $<HTMLCanvasElement>('cockpit');
  private ctx = this.canvas.getContext('2d')!;
  private toastTimer = 0;
  private v = new THREE.Vector3();
  /** Altura del panel de instrumentos (CSS px) */
  panelH = 0;

  constructor() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
    if (!v) this.clearCockpit();
  }

  toast(text: string, ms = 1200) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  warning(on: boolean) {
    this.warningEl.classList.toggle('show', on);
  }

  setCockpit(on: boolean) {
    this.root.classList.toggle('cockpit', on);
    if (!on) {
      this.clearCockpit();
      this.root.style.removeProperty('--panel-h');
      this.panelH = 0;
    }
  }

  private clearCockpit() {
    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  update(d: HudData) {
    const f = d.flight;
    this.speed.textContent = String(Math.round(f.speedKmh));
    this.rings.textContent = String(d.rings);
    this.alt.textContent = String(Math.round(f.pos.y));
    this.updateMarker(d);
    if (d.cockpit) this.drawCockpit(d);
  }

  private updateMarker(d: HudData) {
    if (!d.ringTarget) {
      this.marker.style.display = 'none';
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight - (d.cockpit ? this.panelH : 0);
    const p = this.v.copy(d.ringTarget).project(d.camera);
    const behind = p.z > 1;
    let x = p.x;
    let y = p.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    const margin = 0.88;
    const offscreen = behind || Math.abs(x) > margin || Math.abs(y) > margin;
    if (offscreen) {
      const m = Math.max(Math.abs(x), Math.abs(y)) || 1;
      x = (x / m) * margin;
      y = (y / m) * margin;
    }
    const sx = ((x + 1) / 2) * W;
    const sy = ((1 - y) / 2) * H;
    this.marker.style.display = 'flex';
    this.marker.style.transform = `translate(${sx}px, ${sy}px)`;
    this.marker.classList.toggle('edge', offscreen);
    const dist = d.ringTarget.distanceTo(d.flight.pos);
    this.markerDist.textContent = dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
  }

  // ------------------------------------------------------------ Cabina
  private drawCockpit(d: HudData) {
    const ctx = this.ctx;
    const W = window.innerWidth;
    const H = window.innerHeight;
    ctx.clearRect(0, 0, W, H);
    const f = d.flight;
    const panelH = Math.min(190, Math.max(150, H * 0.22));
    if (panelH !== this.panelH) this.root.style.setProperty('--panel-h', `${panelH}px`);
    this.panelH = panelH;
    const viewH = H - panelH;

    // Escala: píxeles por grado según el FOV vertical de la cámara
    const ppd = H / d.camera.fov;
    const cx = W / 2;
    const cy = H / 2;
    const pitchDeg = THREE.MathUtils.radToDeg(f.pitch);
    const rollRad = f.roll;
    const headingDeg = (((-THREE.MathUtils.radToDeg(f.yaw)) % 360) + 360) % 360;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, viewH);
    ctx.clip();
    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.font = '600 12px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 3;

    // Escalera de cabeceo
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rollRad);
    for (let p = -90; p <= 90; p += 10) {
      if (p === 0) continue;
      const y = (pitchDeg - p) * ppd;
      if (Math.abs(y) > H * 0.4) continue;
      const w = Math.min(90, W * 0.12);
      const gap = Math.min(45, W * 0.06);
      ctx.setLineDash(p < 0 ? [8, 6] : []);
      ctx.beginPath();
      ctx.moveTo(-gap - w, y);
      ctx.lineTo(-gap, y);
      ctx.lineTo(-gap, y + (p > 0 ? 8 : -8));
      ctx.moveTo(gap + w, y);
      ctx.lineTo(gap, y);
      ctx.lineTo(gap, y + (p > 0 ? 8 : -8));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(String(Math.abs(p)), -gap - w - 16, y);
      ctx.fillText(String(Math.abs(p)), gap + w + 16, y);
    }
    // Horizonte
    const hy = pitchDeg * ppd;
    if (Math.abs(hy) < H * 0.45) {
      ctx.beginPath();
      ctx.moveTo(-W, hy);
      ctx.lineTo(-60, hy);
      ctx.moveTo(60, hy);
      ctx.lineTo(W, hy);
      ctx.stroke();
    }
    ctx.restore();

    // Marcador de trayectoria (W)
    ctx.beginPath();
    ctx.moveTo(cx - 26, cy);
    ctx.lineTo(cx - 14, cy);
    ctx.lineTo(cx - 7, cy + 8);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + 7, cy + 8);
    ctx.lineTo(cx + 14, cy);
    ctx.lineTo(cx + 26, cy);
    ctx.stroke();

    // Cinta de rumbo
    const tapeY = Math.max(70, viewH * 0.14);
    const tapeW = Math.min(320, W * 0.7);
    const pxPerDeg = tapeW / 60;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - tapeW / 2, tapeY - 30, tapeW, 50);
    ctx.clip();
    const start = Math.floor((headingDeg - 32) / 5) * 5;
    for (let h = start; h <= headingDeg + 32; h += 5) {
      const x = cx + (h - headingDeg) * pxPerDeg;
      const major = ((h % 30) + 30) % 30 === 0;
      ctx.beginPath();
      ctx.moveTo(x, tapeY);
      ctx.lineTo(x, tapeY + (major ? 12 : 6));
      ctx.stroke();
      if (major) {
        const hh = ((h % 360) + 360) % 360;
        ctx.fillText(String(hh / 10).padStart(2, '0'), x, tapeY - 12);
      }
    }
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(cx, tapeY + 16);
    ctx.lineTo(cx - 6, tapeY + 26);
    ctx.lineTo(cx + 6, tapeY + 26);
    ctx.closePath();
    ctx.fill();

    // Cajas de velocidad y altitud
    const boxW = 74;
    const boxH = 28;
    const boxY = cy - boxH / 2;
    const leftX = Math.max(12, cx - Math.min(W * 0.36, 260) - boxW / 2);
    const rightX = Math.min(W - 12 - boxW, cx + Math.min(W * 0.36, 260) - boxW / 2);
    ctx.strokeRect(leftX, boxY, boxW, boxH);
    ctx.strokeRect(rightX, boxY, boxW, boxH);
    ctx.font = '700 16px ui-monospace, Menlo, monospace';
    ctx.fillText(String(Math.round(f.speedKmh)), leftX + boxW / 2, cy);
    ctx.fillText(String(Math.round(f.pos.y)), rightX + boxW / 2, cy);
    ctx.font = '600 11px ui-monospace, Menlo, monospace';
    ctx.fillText('km/h', leftX + boxW / 2, boxY + boxH + 12);
    ctx.fillText('m', rightX + boxW / 2, boxY + boxH + 12);
    ctx.restore();

    this.drawPanel(d, panelH);
  }

  private drawPanel(d: HudData, panelH: number) {
    const ctx = this.ctx;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const f = d.flight;
    const y0 = H - panelH;

    // Fondo del panel con borde curvo superior
    ctx.save();
    const grd = ctx.createLinearGradient(0, y0, 0, H);
    grd.addColorStop(0, '#20242b');
    grd.addColorStop(1, '#0f1115');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(0, y0 + 10);
    ctx.quadraticCurveTo(W / 2, y0 - 10, W, y0 + 10);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a404a';
    ctx.lineWidth = 2;
    ctx.stroke();

    const innerW = Math.min(W - 20, 760);
    const x0 = (W - innerW) / 2;

    // Fila superior: anillos, empuje, distancia al suelo
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const rowY = y0 + 20;
    ctx.fillStyle = '#ffb347';
    ctx.textAlign = 'left';
    ctx.fillText(`Anillos ${d.rings}`, x0 + 6, rowY);
    ctx.fillStyle = '#cfd6e0';
    ctx.textAlign = 'center';
    const barW = Math.min(110, innerW * 0.22);
    ctx.fillText('Empuje', W / 2 - barW / 2 - 30, rowY);
    ctx.fillStyle = '#000';
    ctx.fillRect(W / 2 - barW / 2, rowY - 5, barW, 10);
    ctx.fillStyle = f.thrust > 0.8 ? '#ff5a1a' : '#ff8a2a';
    ctx.fillRect(W / 2 - barW / 2, rowY - 5, barW * f.thrust, 10);
    ctx.fillStyle = d.groundClearance < 80 ? '#ff5050' : '#cfd6e0';
    ctx.textAlign = 'right';
    ctx.fillText(`Al suelo ${Math.max(0, Math.round(d.groundClearance))} m`, x0 + innerW - 6, rowY);

    // Indicadores circulares
    const n = 5;
    const slot = innerW / n;
    const r = Math.min(slot * 0.4, (panelH - 60) / 2);
    const gy = y0 + 32 + r + 4;
    const labelY = gy + r + 12;
    const pitchDeg = THREE.MathUtils.radToDeg(f.pitch);
    const rollDeg = -THREE.MathUtils.radToDeg(f.roll);
    const heading = (((-THREE.MathUtils.radToDeg(f.yaw)) % 360) + 360) % 360;

    const gx = (i: number) => x0 + slot * (i + 0.5);
    this.dial(gx(0), gy, r, f.speedKmh / 2000, String(Math.round(f.speedKmh)), 'Vel. km/h');
    this.attitude(gx(1), gy, r, f.pitch, f.roll);
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '500 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Actitud ${Math.round(rollDeg)}° / ${Math.round(pitchDeg)}°`, gx(1), labelY);
    this.dial(gx(2), gy, r, (f.pos.y % 1000) / 1000, String(Math.round(f.pos.y)), 'Altitud m', true);
    const vs = THREE.MathUtils.clamp(f.verticalSpeed, -150, 150);
    this.dial(gx(3), gy, r, 0.5 + vs / 300, `${vs > 0 ? '+' : ''}${Math.round(vs)}`, 'Ascenso m/s');
    this.compass(gx(4), gy, r, heading);
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '500 10px system-ui, sans-serif';
    ctx.fillText(`Rumbo ${Math.round(heading)}°`, gx(4), labelY);
    ctx.restore();
  }

  private gaugeFace(x: number, y: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0b0e';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#59606b';
    ctx.stroke();
  }

  private dial(x: number, y: number, r: number, v: number, value: string, label: string, full = false) {
    const ctx = this.ctx;
    this.gaugeFace(x, y, r);
    const a0 = full ? -Math.PI / 2 : Math.PI * 0.75;
    const span = full ? Math.PI * 2 : Math.PI * 1.5;
    ctx.strokeStyle = '#d7dde5';
    ctx.lineWidth = 1;
    const ticks = full ? 10 : 10;
    for (let i = 0; i <= ticks; i++) {
      if (full && i === ticks) break;
      const a = a0 + (span * i) / ticks;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78);
      ctx.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92);
      ctx.stroke();
    }
    const a = a0 + span * THREE.MathUtils.clamp(v, 0, 1);
    ctx.strokeStyle = '#ff8a2a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.max(9, r * 0.32)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, x, y + r * 0.42);
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '500 10px system-ui, sans-serif';
    ctx.fillText(label, x, y + r + 12);
  }

  private attitude(x: number, y: number, r: number, pitch: number, roll: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(x, y);
    ctx.rotate(roll);
    const off = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(pitch) / 45, -1, 1) * r;
    ctx.fillStyle = '#3b8ee0';
    ctx.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2);
    ctx.fillStyle = '#9a5a2c';
    ctx.fillRect(-r * 2, off, r * 4, r * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r, off);
    ctx.lineTo(r, off);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#ffd040';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.55, y);
    ctx.lineTo(x - r * 0.15, y);
    ctx.lineTo(x, y + r * 0.12);
    ctx.lineTo(x + r * 0.15, y);
    ctx.lineTo(x + r * 0.55, y);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#59606b';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  private compass(x: number, y: number, r: number, heading: number) {
    const ctx = this.ctx;
    this.gaugeFace(x, y, r);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(THREE.MathUtils.degToRad(-heading));
    ctx.fillStyle = '#d7dde5';
    ctx.font = `700 ${Math.max(8, r * 0.26)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = ['N', 'E', 'S', 'O'];
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 2);
      ctx.fillStyle = i === 0 ? '#ff6a4a' : '#d7dde5';
      ctx.fillText(labels[i], 0, -r * 0.68);
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = '#ff8a2a';
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.45);
    ctx.lineTo(x - r * 0.18, y + r * 0.25);
    ctx.lineTo(x, y + r * 0.12);
    ctx.lineTo(x + r * 0.18, y + r * 0.25);
    ctx.closePath();
    ctx.fill();
  }
}


