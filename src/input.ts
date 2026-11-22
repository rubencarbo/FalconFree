import type { FlightInput } from './jet';

/** Agrupa joystick táctil, botones en pantalla, teclado y mando */
export class Input {
  invertY = false;
  sensitivity = 1;
  private touchFire = false;
  private mouseFire = false;
  private keys = new Set<string>();
  private joy = { x: 0, y: 0, id: -1 as number };
  private touchBoost = false;
  private touchClimb = false;
  onCamera?: () => void;
  onPause?: () => void;
  onBoostStart?: () => void;
  onMissile?: () => void;
  onFlare?: () => void;
  onResetRoute?: () => void;
  private prevBoost = false;
  private padPrev: boolean[] = [];

  constructor(
    private joyZone: HTMLElement,
    private joyBase: HTMLElement,
    private joyKnob: HTMLElement,
    boostBtn: HTMLElement,
    fireBtn: HTMLElement,
    canvas: HTMLElement,
    missileBtn: HTMLElement,
    flareBtn: HTMLElement,
  ) {
    this.bindTap(missileBtn, () => this.onMissile?.());
    this.bindTap(flareBtn, () => this.onFlare?.());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.onCamera?.();
      if (e.code === 'KeyP' || e.code === 'Escape') this.onPause?.();
      if (e.code === 'KeyQ') this.onMissile?.();
      if (e.code === 'KeyG') this.onFlare?.();
      if (e.code === 'KeyR') this.onResetRoute?.();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    this.bindHold(boostBtn, (v) => (this.touchBoost = v));
    this.bindHold(fireBtn, (v) => (this.touchFire = v));
    // Ratón: clic izquierdo dispara (solo con puntero fino)
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseFire = true;
      if (e.pointerType === 'mouse' && e.button === 2) this.onMissile?.();
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') this.mouseFire = false;
    });

    joyZone.addEventListener('pointerdown', (e) => {
      if (this.joy.id !== -1) return;
      this.joy.id = e.pointerId;
      joyZone.setPointerCapture(e.pointerId);
      this.moveJoy(e);
    });
    joyZone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joy.id) this.moveJoy(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy = { x: 0, y: 0, id: -1 };
      this.joyKnob.style.transform = 'translate(-50%, -50%)';
    };
    joyZone.addEventListener('pointerup', end);
    joyZone.addEventListener('pointercancel', end);
  }

  private bindHold(el: HTMLElement, set: (v: boolean) => void) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('pressed');
      set(true);
    });
    const up = () => {
      el.classList.remove('pressed');
      set(false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  private bindTap(el: HTMLElement, fn: () => void) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.classList.add('pressed');
      fn();
    });
    const up = () => el.classList.remove('pressed');
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  private moveJoy(e: PointerEvent) {
    const r = this.joyBase.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const max = r.width / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.joy.x = dx / max;
    this.joy.y = -dy / max;
    void this.joyZone;
  }

  read(): FlightInput {
    const k = this.keys;
    let x = this.joy.x;
    let y = this.joy.y;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    let boost = this.touchBoost || k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight');
    let climb = this.touchClimb || k.has('KeyE');
    let fire = this.touchFire || this.mouseFire || k.has('KeyF') || k.has('KeyJ') || k.has('ControlLeft');

    // Mando
    let pads: (Gamepad | null)[] = [];
    try {
      pads = navigator.getGamepads?.() ?? [];
    } catch {
      /* API de mandos bloqueada (p. ej. en un iframe) */
    }
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      if (Math.abs(ax) > 0.12) x += ax;
      if (Math.abs(ay) > 0.12) y -= ay;
      boost ||= !!(p.buttons[0]?.pressed || p.buttons[7]?.pressed);
      climb ||= !!p.buttons[1]?.pressed;
      fire ||= !!(p.buttons[2]?.pressed || p.buttons[6]?.pressed);
      const rb = !!p.buttons[5]?.pressed;
      const lb = !!p.buttons[4]?.pressed;
      if (rb && !this.padPrev[5]) this.onMissile?.();
      if (lb && !this.padPrev[4]) this.onFlare?.();
      this.padPrev[5] = rb;
      this.padPrev[4] = lb;
      const camBtn = !!p.buttons[3]?.pressed;
      const pauseBtn = !!p.buttons[9]?.pressed;
      if (camBtn && !this.padPrev[3]) this.onCamera?.();
      if (pauseBtn && !this.padPrev[9]) this.onPause?.();
      this.padPrev[3] = camBtn;
      this.padPrev[9] = pauseBtn;
      break;
    }

    x = Math.max(-1, Math.min(1, x * this.sensitivity));
    y = Math.max(-1, Math.min(1, y * this.sensitivity));
    if (this.invertY) y = -y;
    if (boost && !this.prevBoost) this.onBoostStart?.();
    this.prevBoost = boost;
    return { x, y, boost, climb, fire };
  }

  reset() {
    this.keys.clear();
    this.touchBoost = false;
    this.touchClimb = false;
    this.touchFire = false;
    this.mouseFire = false;
  }
}
