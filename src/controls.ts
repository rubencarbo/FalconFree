import {
  CONTROL_BASE_SIZE,
  CONTROL_IDS,
  CONTROL_LABELS,
  defaultControls,
  sanitize,
  clamp,
  type ControlId,
  type ControlLayout,
} from './settings';

const MARGIN = 8;

function safeTop() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--safe-top');
  return parseFloat(v) || 0;
}

/** Calcula el rectángulo (px) de un control respetando los bordes y el panel de cabina */
export function controlRect(id: ControlId, c: ControlLayout, W: number, H: number, bottomReserved = 0) {
  const size = CONTROL_BASE_SIZE[id] * c.scale;
  const half = size / 2;
  const cx = clamp(c.x * W, half + MARGIN, W - half - MARGIN);
  const cy = clamp(c.y * H, half + MARGIN + safeTop(), Math.max(half + MARGIN, H - bottomReserved - half - MARGIN));
  return { cx, cy, size };
}

/** Coloca los controles táctiles del HUD según la disposición guardada */
export function applyControlLayout(layout: Record<ControlId, ControlLayout>, bottomReserved = 0) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  for (const id of CONTROL_IDS) {
    const c = layout[id];
    const { cx, cy, size } = controlRect(id, c, W, H, bottomReserved);
    if (id === 'joy') {
      const zone = document.getElementById('joy-zone')!;
      const base = document.getElementById('joy-base')!;
      const zoneSize = size * 1.9;
      Object.assign(zone.style, {
        left: `${cx - zoneSize / 2}px`,
        top: `${cy - zoneSize / 2}px`,
        width: `${zoneSize}px`,
        height: `${zoneSize}px`,
      });
      Object.assign(base.style, { width: `${size}px`, height: `${size}px`, opacity: String(c.opacity) });
      const knob = document.getElementById('joy-knob')!;
      knob.style.width = knob.style.height = `${size * 0.45}px`;
    } else {
      const el = document.getElementById(`btn-${id}`)!;
      Object.assign(el.style, {
        left: `${cx - size / 2}px`,
        top: `${cy - size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        opacity: String(c.opacity),
        fontSize: `${Math.round(13 * Math.max(0.8, c.scale))}px`,
      });
    }
  }
}

/** Editor visual: arrastrar, cambiar tamaño y transparencia */
export class ControlsEditor {
  private root = document.getElementById('controls-editor')!;
  private stage = document.getElementById('ce-stage')!;
  private sizeInput = document.getElementById('ce-size') as HTMLInputElement;
  private opInput = document.getElementById('ce-opacity') as HTMLInputElement;
  private sizeVal = document.getElementById('ce-size-val')!;
  private opVal = document.getElementById('ce-opacity-val')!;
  private selName = document.getElementById('ce-selected')!;
  private draft: Record<ControlId, ControlLayout> = defaultControls();
  private els = new Map<ControlId, HTMLElement>();
  private selected: ControlId = 'joy';
  private onSave?: (l: Record<ControlId, ControlLayout>) => void;
  private onClose?: () => void;

  constructor() {
    for (const id of CONTROL_IDS) {
      const el = document.createElement('div');
      el.className = `ce-ctrl ce-${id}`;
      el.dataset.id = id;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', CONTROL_LABELS[id]);
      el.tabIndex = 0;
      if (id === 'joy') {
        el.innerHTML = '<span class="ce-knob"></span>';
      } else {
        el.textContent = CONTROL_LABELS[id];
      }
      this.stage.append(el);
      this.els.set(id, el);
      this.bindDrag(el, id);
      el.addEventListener('focus', () => this.select(id));
    }
    this.sizeInput.addEventListener('input', () => {
      this.draft[this.selected].scale = Number(this.sizeInput.value) / 100;
      this.render();
    });
    this.opInput.addEventListener('input', () => {
      this.draft[this.selected].opacity = Number(this.opInput.value) / 100;
      this.render();
    });
    document.getElementById('ce-save')!.addEventListener('click', () => {
      const out = {} as Record<ControlId, ControlLayout>;
      for (const id of CONTROL_IDS) out[id] = sanitize(this.normalized(id));
      this.onSave?.(out);
      this.close();
    });
    document.getElementById('ce-cancel')!.addEventListener('click', () => this.close());
    document.getElementById('ce-reset')!.addEventListener('click', () => {
      this.draft = defaultControls();
      this.select(this.selected);
      this.render();
    });
    window.addEventListener('resize', () => {
      if (!this.root.classList.contains('hidden')) this.render();
    });
  }

  open(layout: Record<ControlId, ControlLayout>, onSave: (l: Record<ControlId, ControlLayout>) => void, onClose: () => void) {
    this.draft = JSON.parse(JSON.stringify(layout));
    this.onSave = onSave;
    this.onClose = onClose;
    this.root.classList.remove('hidden');
    this.select('joy');
    this.render();
  }

  close() {
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  /** Devuelve la posición ya ajustada a los bordes, en fracciones */
  private normalized(id: ControlId): ControlLayout {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const r = controlRect(id, this.draft[id], W, H);
    return { ...this.draft[id], x: r.cx / W, y: r.cy / H };
  }

  private select(id: ControlId) {
    this.selected = id;
    for (const [k, el] of this.els) el.classList.toggle('selected', k === id);
    this.selName.textContent = CONTROL_LABELS[id];
    this.sizeInput.value = String(Math.round(this.draft[id].scale * 100));
    this.opInput.value = String(Math.round(this.draft[id].opacity * 100));
    this.updateLabels();
  }

  private updateLabels() {
    this.sizeVal.textContent = `${this.sizeInput.value} %`;
    this.opVal.textContent = `${this.opInput.value} %`;
  }

  private render() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const id of CONTROL_IDS) {
      const el = this.els.get(id)!;
      const c = this.draft[id];
      const { cx, cy, size } = controlRect(id, c, W, H);
      Object.assign(el.style, {
        left: `${cx - size / 2}px`,
        top: `${cy - size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        opacity: String(c.opacity),
        fontSize: `${Math.round(13 * Math.max(0.8, c.scale))}px`,
      });
    }
    this.updateLabels();
  }

  private bindDrag(el: HTMLElement, id: ControlId) {
    let start: { px: number; py: number; x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.select(id);
      el.setPointerCapture(e.pointerId);
      const n = this.normalized(id);
      this.draft[id].x = n.x;
      this.draft[id].y = n.y;
      start = { px: e.clientX, py: e.clientY, x: n.x, y: n.y };
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!start) return;
      this.draft[id].x = clamp(start.x + (e.clientX - start.px) / window.innerWidth, 0, 1);
      this.draft[id].y = clamp(start.y + (e.clientY - start.py) / window.innerHeight, 0, 1);
      this.render();
    });
    const end = () => {
      start = null;
      el.classList.remove('dragging');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // Teclado: flechas para mover el control seleccionado
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.05 : 0.01;
      const c = this.draft[id];
      if (e.key === 'ArrowLeft') c.x -= step;
      else if (e.key === 'ArrowRight') c.x += step;
      else if (e.key === 'ArrowUp') c.y -= step;
      else if (e.key === 'ArrowDown') c.y += step;
      else return;
      e.preventDefault();
      c.x = clamp(c.x, 0, 1);
      c.y = clamp(c.y, 0, 1);
      this.render();
    });
  }
}
