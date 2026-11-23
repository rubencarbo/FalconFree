import { STAGES, type Stage } from './stages';
import type { CourseDef } from './race';

/** Clave del día en UTC (igual para todo el mundo): AAAAMMDD */
export function dayKey(d = new Date()) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function dayLabel(d = new Date()) {
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function dayNumber(d = new Date()) {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}

export type DailyVariant = 'day' | 'night';

/**
 * Desafío del día: circuito generado a partir de la fecha (igual para todo el mundo).
 * Se puede volar de día o de noche; cada versión tiene su escenario y su clasificación.
 */
export function dailyChallenge(d = new Date(), variant: DailyVariant = 'day'): { stage: Stage; def: CourseDef; key: string; variant: DailyVariant; baseKey: string } {
  const n = dayNumber(d);
  const baseKey = dayKey(d);
  const dayStages = STAGES.filter((s) => !s.night);
  const nightStage = STAGES.find((s) => s.night) ?? STAGES[0];
  const stage = variant === 'night' ? nightStage : dayStages[n % dayStages.length];
  const gates = 12 + (n % 4);
  const def: CourseDef = {
    id: `daily-${baseKey}`,
    name: 'Desafío diario',
    description: `${gates} hitos · ${stage.name}`,
    gates,
    radius: 1600 + (n % 5) * 200,
    seedOffset: 1000 + (n % 9973),
  };
  return { stage, def, key: variant === 'night' ? `${baseKey}n` : baseKey, variant, baseKey };
}

/** Milisegundos hasta el siguiente desafío */
export function msToNextDaily(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
