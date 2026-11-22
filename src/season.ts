import type { Progress, Stats } from './progress';
import { PAINTS, PLANES } from './progress';
import { hash2 } from './world/noise';

/** Pase de temporada gratuito: 30 niveles al mes y misiones semanales */

export const SEASON_TIERS = 30;
export const XP_PER_TIER = 600;

export interface MissionDef {
  id: string;
  text: string;
  stat: keyof Stats;
  target: number;
  xp: number;
  /** la estadística es un máximo (no un contador) */
  max?: boolean;
}

const POOL: MissionDef[] = [
  { id: 'rings', text: 'Atraviesa 30 anillos', stat: 'rings', target: 30, xp: 500 },
  { id: 'drones', text: 'Derriba 10 drones', stat: 'drones', target: 10, xp: 500 },
  { id: 'races', text: 'Completa 3 carreras', stat: 'races', target: 3, xp: 600 },
  { id: 'stunts', text: 'Consigue 5000 puntos de estilo', stat: 'stuntPoints', target: 5000, xp: 600 },
  { id: 'deliv', text: 'Entrega 6 paquetes en Mensajero', stat: 'deliveries', target: 6, xp: 600 },
  { id: 'waves', text: 'Llega a la oleada 5', stat: 'wavesBest', target: 5, xp: 700, max: true },
  { id: 'koth', text: 'Gana una partida de Rey del cielo', stat: 'kothWins', target: 1, xp: 700 },
  { id: 'tag', text: 'Aguanta 120 s sin llevarla en Pilla-pilla', stat: 'tagFree', target: 120, xp: 600 },
  { id: 'form', text: 'Vuela 60 s en formación con tu equipo', stat: 'formationTime', target: 60, xp: 700 },
  { id: 'power', text: 'Recoge 8 recompensas', stat: 'powerups', target: 8, xp: 400 },
  { id: 'kills', text: 'Derriba 15 enemigos en batalla', stat: 'kills', target: 15, xp: 700 },
  { id: 'sea', text: 'Atraviesa 3 aros marinos', stat: 'seaRings', target: 3, xp: 500 },
  { id: 'daily', text: 'Completa 2 desafíos diarios', stat: 'dailies', target: 2, xp: 600 },
  { id: 'combo', text: 'Haz un combo ×5', stat: 'bestCombo', target: 5, xp: 600, max: true },
];

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function seasonId(d = new Date()) {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export function seasonName(id: number) {
  return `Temporada de ${MONTHS[id % 12]} ${Math.floor(id / 12)}`;
}

/** Semana (lunes a domingo, UTC) */
export function weekNumber(d = new Date()) {
  const day = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
  return Math.floor((day + 3) / 7);
}

/** Las 4 misiones de la semana (iguales para todos) */
export function weekMissions(week: number): MissionDef[] {
  const pool = POOL.slice();
  const out: MissionDef[] = [];
  let k = 0;
  while (out.length < 4 && pool.length) {
    const i = Math.floor(hash2(week, k++, 4242) * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

export interface TierReward {
  label: string;
  credits?: number;
  paint?: string;
  plane?: string;
}

export function tierReward(tier: number): TierReward {
  const paint = PAINTS.find((p) => p.season === tier);
  if (paint) return { label: `Pintura «${paint.name}»`, paint: paint.id };
  if (tier === SEASON_TIERS) return { label: 'Avión Cometa (o 3000 créditos si ya lo tienes)', plane: 'comet' };
  if (tier === 15) return { label: '1000 créditos', credits: 1000 };
  return { label: `${100 + tier * 10} créditos`, credits: 100 + tier * 10 };
}

export interface SeasonEvents {
  onTier?: (tier: number, reward: TierReward) => void;
  onMission?: (m: MissionDef) => void;
}

export class Season {
  constructor(
    private pr: Progress,
    private ev: SeasonEvents = {},
  ) {
    this.refresh();
  }

  get state() {
    return this.pr.p.season;
  }

  get tier() {
    return Math.min(SEASON_TIERS, Math.floor(this.state.xp / XP_PER_TIER));
  }

  get missions() {
    return weekMissions(this.state.week);
  }

  /** Comprueba cambio de temporada o de semana */
  refresh() {
    const st = this.state;
    const sid = seasonId();
    if (st.id !== sid) {
      st.id = sid;
      st.xp = 0;
      st.tier = 0;
    }
    const wk = weekNumber();
    if (st.week !== wk) {
      st.week = wk;
      st.done = [];
      st.baseline = {};
      for (const m of weekMissions(wk)) st.baseline[m.stat] = m.max ? 0 : this.pr.p.stats[m.stat];
    }
    this.pr.save();
  }

  progressOf(m: MissionDef) {
    const v = this.pr.p.stats[m.stat];
    const base = m.max ? 0 : (this.state.baseline[m.stat] ?? v);
    return Math.max(0, Math.min(m.target, v - base));
  }

  addXp(n: number) {
    if (n <= 0) return;
    this.state.xp = Math.min(SEASON_TIERS * XP_PER_TIER, this.state.xp + Math.round(n));
    this.grantTiers();
    this.pr.save();
  }

  /** Llamar cuando cambian las estadísticas */
  checkMissions() {
    const st = this.state;
    for (const m of this.missions) {
      if (st.done.includes(m.id)) continue;
      if (this.progressOf(m) >= m.target) {
        st.done.push(m.id);
        this.ev.onMission?.(m);
        this.addXp(m.xp);
      }
    }
  }

  private grantTiers() {
    const st = this.state;
    while (st.tier < this.tier) {
      st.tier++;
      const r = tierReward(st.tier);
      if (r.paint && !this.pr.p.paints.includes(r.paint)) this.pr.p.paints.push(r.paint);
      if (r.plane) {
        const owned = this.pr.p.planes.includes(r.plane as never);
        if (!owned && PLANES.some((p) => p.id === r.plane)) this.pr.p.planes.push(r.plane as never);
        else this.pr.p.credits += 3000;
      }
      if (r.credits) this.pr.p.credits += r.credits;
      this.ev.onTier?.(st.tier, r);
    }
  }
}
