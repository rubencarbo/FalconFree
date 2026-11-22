/** Iconos de piloto: formas fáciles de distinguir en el radar y en las etiquetas */

export type IconId = 'x' | 'o' | 'square' | 'star' | 'triangle' | 'arrow' | 'diamond' | 'plus';

export const ICONS: IconId[] = ['x', 'o', 'square', 'star', 'triangle', 'arrow', 'diamond', 'plus'];

/** Glifo para la interfaz HTML */
export const ICON_GLYPH: Record<IconId, string> = {
  x: '✕',
  o: '●',
  square: '■',
  star: '★',
  triangle: '▲',
  arrow: '➤',
  diamond: '◆',
  plus: '✚',
};

export const ICON_NAMES: Record<IconId, string> = {
  x: 'Equis',
  o: 'Círculo',
  square: 'Cuadrado',
  star: 'Estrella',
  triangle: 'Triángulo',
  arrow: 'Flecha',
  diamond: 'Rombo',
  plus: 'Cruz',
};

export function isIcon(v: unknown): v is IconId {
  return typeof v === 'string' && (ICONS as string[]).includes(v);
}

/** Dibuja el icono centrado en (x, y) con tamaño s (radio aproximado) */
export function drawIcon(ctx: CanvasRenderingContext2D, icon: IconId, x: number, y: number, s: number, color: string, outline = 'rgba(0,0,0,0.75)') {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(1.5, s * 0.28);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (icon) {
    case 'x': {
      const w = s * 0.38;
      ctx.moveTo(-s, -s + w);
      ctx.lineTo(-s + w, -s);
      ctx.lineTo(0, -w);
      ctx.lineTo(s - w, -s);
      ctx.lineTo(s, -s + w);
      ctx.lineTo(w, 0);
      ctx.lineTo(s, s - w);
      ctx.lineTo(s - w, s);
      ctx.lineTo(0, w);
      ctx.lineTo(-s + w, s);
      ctx.lineTo(-s, s - w);
      ctx.lineTo(-w, 0);
      ctx.closePath();
      break;
    }
    case 'o':
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(-s * 0.88, -s * 0.88, s * 1.76, s * 1.76);
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.45 : s * 1.1;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(0, -s * 1.05);
      ctx.lineTo(s, s * 0.8);
      ctx.lineTo(-s, s * 0.8);
      ctx.closePath();
      break;
    case 'arrow':
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.2, -s);
      ctx.lineTo(-s * 0.2, -s * 0.4);
      ctx.lineTo(-s, -s * 0.4);
      ctx.lineTo(-s, s * 0.4);
      ctx.lineTo(-s * 0.2, s * 0.4);
      ctx.lineTo(-s * 0.2, s);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(0, -s * 1.1);
      ctx.lineTo(s * 0.8, 0);
      ctx.lineTo(0, s * 1.1);
      ctx.lineTo(-s * 0.8, 0);
      ctx.closePath();
      break;
    case 'plus': {
      const w = s * 0.36;
      ctx.moveTo(-w, -s);
      ctx.lineTo(w, -s);
      ctx.lineTo(w, -w);
      ctx.lineTo(s, -w);
      ctx.lineTo(s, w);
      ctx.lineTo(w, w);
      ctx.lineTo(w, s);
      ctx.lineTo(-w, s);
      ctx.lineTo(-w, w);
      ctx.lineTo(-s, w);
      ctx.lineTo(-s, -w);
      ctx.lineTo(-w, -w);
      ctx.closePath();
      break;
    }
  }
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

export const hexColor = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
