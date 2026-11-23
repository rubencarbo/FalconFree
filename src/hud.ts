import * as THREE from 'three';
import type { Flight } from './jet';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const GREEN = '#46ff7a';

export interface PilotTag {
  id: string;
  name: string;
  glyph: string;
  color: string;
  pos: THREE.Vector3;
  enemy: boolean;
}

const _up = new THREE.Vector3(0, 7, 0);

export interface HudData {
  flight: Flight;
  /** Línea principal de puntuación (p. ej. "Anillos 3") */
  scoreLabel: string;
  scoreValue: string;
  groundClearance: number;
  /** Objetivo de navegación (anillo o hito) */
  navTarget: THREE.Vector3 | null;
  navLabel?: string;
  navGate?: boolean;
  camera: THREE.PerspectiveCamera;
  cockpit: boolean;
  hp01: number;
  ammo: number;
  maxAmmo: number;
  lockPos: THREE.Vector3 | null;
  lockStrength: number;
  lockName?: string;
}

export class Hud {
  root = $('hud');
  private speed = $('hud-speed');
  private rings = $('hud-rings');
  private ringsLabel = $('hud-rings-label');
  private hpBar = $('hud-hp');
  private ammoBar = $('hud-ammo');
  private ammoText = $('hud-ammo-text');
  private lockEl = $('lock');
  private lockName = $('lock-name');
  private hitEl = $('hitmarker');
  private navLabel = $('ring-label');
  private timerEl = $('race-timer');
  private splitEl = $('race-split');
  private countEl = $('countdown');
  private dmgEl = $('damage-flash');
  private lastLock = false;
  private splitTimer = 0;
  /** Se llama cuando se fija un objetivo nuevo */
  onLock?: () => void;
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

  private updateLock(d: HudData) {
    const has = !!d.lockPos;
    if (has && !this.lastLock) this.onLock?.();
    this.lastLock = has;
    if (!d.lockPos) {
      this.lockEl.style.display = 'none';
      return;
    }
    const p = this.v.copy(d.lockPos).project(d.camera);
    if (p.z > 1) {
      this.lockEl.style.display = 'none';
      return;
    }
    const sx = ((p.x + 1) / 2) * window.innerWidth;
    const sy = ((1 - p.y) / 2) * window.innerHeight;
    const size = 70 - d.lockStrength * 26;
    this.lockEl.style.display = 'block';
    this.lockEl.style.transform = `translate(${sx - size / 2}px, ${sy - size / 2}px)`;
    this.lockEl.style.width = this.lockEl.style.height = `${size}px`;
    this.lockEl.classList.toggle('locked', d.lockStrength >= 1);
    this.lockName.textContent = d.lockName ?? '';
  }

  private pilotEls = new Map<string, HTMLElement>();

  /** Etiquetas de los otros pilotos: icono, nombre y distancia (en el borde si no se ven) */
  updatePilots(camera: THREE.PerspectiveCamera, me: THREE.Vector3, list: PilotTag[]) {
    const root = $('pilots');
    const W = window.innerWidth;
    const H = window.innerHeight - this.panelH;
    const seen = new Set<string>();
    for (const p of list) {
      seen.add(p.id);
      let el = this.pilotEls.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'pilot';
        el.innerHTML = '<span class="pi-icon"></span><span class="pi-name"></span><span class="pi-dist"></span>';
        root.append(el);
        this.pilotEls.set(p.id, el);
      }
      (el.children[0] as HTMLElement).textContent = p.glyph;
      (el.children[1] as HTMLElement).textContent = p.name;
      const d = p.pos.distanceTo(me);
      (el.children[2] as HTMLElement).textContent = d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
      el.style.setProperty('--pc', p.color);
      el.classList.toggle('enemy', p.enemy);
      const v = this.v.copy(p.pos).add(_up).project(camera);
      const behind = v.z > 1;
      let x = v.x;
      let y = v.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const m = 0.9;
      const edge = behind || Math.abs(x) > m || Math.abs(y) > m;
      if (edge) {
        const k = Math.max(Math.abs(x), Math.abs(y)) || 1;
        x = (x / k) * m;
        y = (y / k) * m;
      }
      el.classList.toggle('edge', edge);
      el.style.transform = `translate(${((x + 1) / 2) * W}px, ${((1 - y) / 2) * H}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.pilotEls) {
      if (!seen.has(id)) {
        el.remove();
        this.pilotEls.delete(id);
      }
    }
  }

  setWeapons(missiles: number, flares: number, flareWindow: boolean) {
    $('hud-missiles').textContent = String(missiles);
    $('hud-flares').textContent = String(flares);
    $('btn-missile').dataset.count = String(missiles);
    void flareWindow;
  }

  /** Aviso de misil entrante con su dirección en pantalla */
  missileWarning(on: boolean, angleDeg = 0) {
    const el = $('missile-warning');
    el.classList.toggle('show', on);
    if (on) (el.querySelector('.mw-arrow') as HTMLElement).style.transform = `rotate(${angleDeg}deg)`;
  }

  setPowerups(list: { name: string; color: string; left: number; total: number }[]) {
    const el = $('powerups');
    if (!list.length) {
      if (el.childElementCount) el.replaceChildren();
      return;
    }
    el.replaceChildren(
      ...list.map((p) => {
        const d = document.createElement('div');
        d.className = 'pw';
        d.style.setProperty('--c', p.color);
        d.style.setProperty('--k', String(p.left / p.total));
        d.innerHTML = `<b></b><span>${Math.ceil(p.left)} s</span>`;
        (d.firstChild as HTMLElement).textContent = p.name;
        return d;
      }),
    );
  }

  battleScore(text: string | null, time?: string) {
    const el = $('battle-score');
    el.classList.toggle('hidden', text === null);
    if (text !== null) el.innerHTML = `<span class="bs-time">${time ?? ''}</span><span class="bs-text"></span>`;
    if (text !== null) (el.querySelector('.bs-text') as HTMLElement).textContent = text;
  }

  killfeed(text: string, mine = false) {
    const el = $('killfeed');
    const row = document.createElement('div');
    row.textContent = text;
    if (mine) row.className = 'mine';
    el.prepend(row);
    while (el.childElementCount > 4) el.lastElementChild?.remove();
    setTimeout(() => row.remove(), 5000);
  }

  /** Rótulo del modo (¡LA LLEVAS!, ¡ZONA TUYA!…) */
  banner(text: string | null, kind: 'good' | 'bad' | 'warn' | 'info' = 'info') {
    const el = $('mode-banner');
    if (text === null) {
      el.className = '';
      return;
    }
    if (el.textContent !== text) el.textContent = text;
    el.className = `show ${kind}`;
  }

  private penTimer = 0;
  /** Aviso grande de penalización (hito saltado): rótulo rojo y cronómetro en rojo */
  penalty(title: string, amount: string) {
    const el = $('penalty');
    (el.querySelector('b') as HTMLElement).textContent = amount;
    (el.querySelector('span') as HTMLElement).textContent = title;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.timerEl.classList.add('penalized');
    clearTimeout(this.penTimer);
    this.penTimer = window.setTimeout(() => {
      el.classList.remove('show');
      this.timerEl.classList.remove('penalized');
    }, 2600);
  }

  /** Barra de vida del jefe final */
  bossBar(label: string | null, frac = 1) {
    const el = $('boss-bar');
    el.classList.toggle('show', label !== null);
    if (label === null) return;
    const name = el.querySelector('.bb-name') as HTMLElement;
    if (name.textContent !== label) name.textContent = label;
    (el.querySelector('.bb-track i') as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
  }

  /** Mensaje del chat rápido */
  chat(name: string, color: string, text: string) {
    const el = $('chat-feed');
    const row = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = `${name}:`;
    b.style.color = color;
    row.append(b, document.createTextNode(text));
    el.prepend(row);
    while (el.childElementCount > 5) el.lastElementChild?.remove();
    setTimeout(() => row.remove(), 6000);
  }

  /** Modo espectador (null para ocultar) */
  spectate(name: string | null) {
    $('spectate').classList.toggle('hidden', name === null);
    if (name !== null) $('spectate-name').textContent = name;
  }

  private comboShown = false;
  /** Contador de combo de acrobacias */
  combo(c: { last: string; mult: number; points: number; timeLeft: number } | null) {
    const el = $('combo');
    if (!c) {
      if (this.comboShown) {
        el.classList.remove('show');
        this.comboShown = false;
      }
      return;
    }
    this.comboShown = true;
    el.classList.add('show');
    (el.querySelector('.cb-name') as HTMLElement).textContent = c.last;
    (el.querySelector('.cb-mult') as HTMLElement).textContent = `×${c.mult}`;
    (el.querySelector('.cb-pts') as HTMLElement).textContent = String(c.points);
    (el.querySelector('.cb-bar i') as HTMLElement).style.transform = `scaleX(${c.timeLeft})`;
    el.dataset.mult = String(Math.min(8, c.mult));
  }

  formation(n: number) {
    const el = $('formation');
    el.classList.toggle('show', n > 0);
    if (n > 0) el.textContent = `EN FORMACIÓN ×${n + 1}`;
  }

  leash(on: boolean, dist: number) {
    const el = $('leash');
    el.classList.toggle('show', on);
    if (on) (el.querySelector('b') as HTMLElement).textContent = dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
  }

  offRoute(on: boolean) {
    $('offroute').classList.toggle('show', on);
  }

  private achTimer = 0;
  achievement(name: string, reward: number) {
    const el = $('ach-banner');
    (el.querySelector('b') as HTMLElement).textContent = name;
    (el.querySelector('small') as HTMLElement).textContent = `+${reward} créditos`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.achTimer);
    this.achTimer = window.setTimeout(() => el.classList.remove('show'), 3800);
  }

  hitMarker(kill = false) {
    this.hitEl.classList.remove('show', 'kill');
    void this.hitEl.offsetWidth;
    this.hitEl.classList.add('show');
    if (kill) this.hitEl.classList.add('kill');
  }

  damageFlash() {
    this.dmgEl.classList.remove('show');
    void this.dmgEl.offsetWidth;
    this.dmgEl.classList.add('show');
  }

  medalTarget(text: string | null) {
    const el = $('race-medal');
    el.classList.toggle('hidden', text === null);
    if (text !== null && el.textContent !== text) el.textContent = text;
  }

  setTimer(text: string | null) {
    this.timerEl.classList.toggle('hidden', text === null);
    if (text !== null) this.timerEl.textContent = text;
  }

  split(html: string, kind: 'good' | 'bad' | 'neutral') {
    this.splitEl.innerHTML = html;
    this.splitEl.className = `show ${kind}`;
    clearTimeout(this.splitTimer);
    this.splitTimer = window.setTimeout(() => (this.splitEl.className = ''), 2600);
  }

  countdown(text: string | null) {
    if (text === null) {
      this.countEl.className = '';
      return;
    }
    if (this.countEl.textContent === text && this.countEl.classList.contains('show')) return;
    this.countEl.textContent = text;
    this.countEl.className = '';
    void this.countEl.offsetWidth;
    this.countEl.className = 'show';
  }

  update(d: HudData) {
    const f = d.flight;
    this.speed.textContent = String(Math.round(f.speedKmh));
    this.ringsLabel.textContent = d.scoreLabel;
    this.rings.textContent = d.scoreValue;
    this.alt.textContent = String(Math.round(f.pos.y));
    const hp = Math.max(0, d.hp01);
    this.hpBar.style.transform = `scaleX(${hp})`;
    this.hpBar.classList.toggle('low', hp < 0.3);
    this.ammoBar.style.transform = `scaleX(${d.ammo / d.maxAmmo})`;
    this.ammoText.textContent = String(d.ammo);
    this.ammoBar.classList.toggle('low', d.ammo < d.maxAmmo * 0.15);
    this.updateMarker(d);
    this.updateLock(d);
    if (d.cockpit) this.drawCockpit(d);
  }

  private updateMarker(d: HudData) {
    if (!d.navTarget) {
      this.marker.style.display = 'none';
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight - (d.cockpit ? this.panelH : 0);
    const p = this.v.copy(d.navTarget).project(d.camera);
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
    const dist = d.navTarget.distanceTo(d.flight.pos);
    this.markerDist.textContent = dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
    this.marker.classList.toggle('gate', !!d.navGate);
    this.navLabel.textContent = d.navLabel ?? '';
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
    ctx.fillText(`${d.scoreLabel} ${d.scoreValue} · Balas ${d.ammo}`, x0 + 6, rowY);
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


