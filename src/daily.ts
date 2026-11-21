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

/** Desafío del día: escenario y circuito generados a partir de la fecha */
export function dailyChallenge(d = new Date()): { stage: Stage; def: CourseDef; key: string } {
  const n = dayNumber(d);
  const key = dayKey(d);
  const stage = STAGES[n % STAGES.length];
  const gates = 8 + (n % 4);
  const def: CourseDef = {
    id: `daily-${key}`,
    name: 'Desafío diario',
    description: `${gates} hitos · ${stage.name}`,
    gates,
    radius: 1000 + (n % 5) * 150,
    seedOffset: 1000 + (n % 9973),
  };
  return { stage, def, key };
}

/** Milisegundos hasta el siguiente desafío */
export function msToNextDaily(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
