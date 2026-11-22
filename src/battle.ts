import type { Team } from './bots';

export type BattleKind = 'ffa' | 'teams' | 'coop' | 'koth' | 'tag';

export const BATTLE_LABELS: Record<BattleKind, string> = {
  ffa: 'Todos contra todos',
  teams: 'Equipos: Naranja vs Azul',
  coop: 'Todos contra la máquina',
  koth: 'Rey del cielo',
  tag: 'Pilla-pilla',
};

/** Modos de puntos (no de derribos) */
export function isPointsMode(k: BattleKind) {
  return k === 'koth' || k === 'tag';
}

export interface BattleConfig {
  kind: BattleKind;
  bots: number;
  killLimit: number;
  /** segundos */
  timeLimit: number;
}

export const DEFAULT_BATTLE: BattleConfig = { kind: 'ffa', bots: 4, killLimit: 10, timeLimit: 300 };

export interface Fighter {
  id: string;
  name: string;
  team: Team | null;
  color: number;
  kills: number;
  deaths: number;
  isBot: boolean;
  /** puntos (Rey del cielo: segundos en la zona; Pilla-pilla: segundos sin llevarla) */
  points: number;
}

export interface BattleResult {
  winnerLabel: string;
  iWon: boolean;
  rows: Fighter[];
  teams: { team: Team; kills: number }[] | null;
}

/** Reglas y marcador de una batalla */
export class Battle {
  fighters = new Map<string, Fighter>();
  elapsed = 0;
  finished = false;
  streak = 0;

  constructor(
    public config: BattleConfig,
    public myId: string,
  ) {}

  /** Pilla-pilla: quién la lleva */
  it: string | null = null;

  add(f: Omit<Fighter, 'kills' | 'deaths' | 'points'> & { kills?: number; deaths?: number; points?: number }) {
    const prev = this.fighters.get(f.id);
    this.fighters.set(f.id, { kills: prev?.kills ?? 0, deaths: prev?.deaths ?? 0, points: prev?.points ?? 0, ...f } as Fighter);
  }

  addPoints(id: string, p: number) {
    const f = this.fighters.get(id);
    if (f) f.points += p;
  }

  get pointsMode() {
    return isPointsMode(this.config.kind);
  }

  get me() {
    return this.fighters.get(this.myId);
  }

  teamOf(id: string): Team | null {
    return this.fighters.get(id)?.team ?? null;
  }

  /** ¿Son enemigos a y b? */
  enemies(a: string, b: string) {
    if (a === b) return false;
    if (this.config.kind === 'tag') return false;
    if (this.config.kind === 'ffa' || this.config.kind === 'koth') return true;
    const ta = this.teamOf(a);
    const tb = this.teamOf(b);
    return !ta || !tb || ta !== tb;
  }

  kill(killer: string | null, victim: string) {
    const v = this.fighters.get(victim);
    if (v) v.deaths++;
    if (victim === this.myId) this.streak = 0;
    if (killer && killer !== victim) {
      const k = this.fighters.get(killer);
      if (k) k.kills++;
      if (killer === this.myId) this.streak++;
    }
  }

  /** Sobrescribe la puntuación (multijugador) */
  setScore(id: string, kills: number, deaths: number) {
    const f = this.fighters.get(id);
    if (f) {
      if (this.pointsMode) f.points = kills;
      else f.kills = kills;
      f.deaths = deaths;
    }
  }

  /** Valor que se sincroniza en la sala como «k» */
  syncValue(id: string) {
    const f = this.fighters.get(id);
    if (!f) return 0;
    return this.pointsMode ? Math.floor(f.points) : f.kills;
  }

  teamKills(team: Team) {
    let k = 0;
    for (const f of this.fighters.values()) if (f.team === team) k += f.kills;
    return k;
  }

  /** Rey del cielo: puntos para ganar */
  get pointsGoal() {
    return this.config.killLimit * 10;
  }

  get timeLeft() {
    return Math.max(0, this.config.timeLimit - this.elapsed);
  }

  /** Línea corta para el HUD */
  scoreLine(): string {
    const c = this.config;
    if (this.pointsMode) {
      const top = [...this.fighters.values()].sort((a, b) => b.points - a.points)[0];
      const me = this.me;
      const it = c.kind === 'tag' && this.it ? ` · La lleva: ${this.fighters.get(this.it)?.name ?? '?'}` : '';
      return `Tú ${Math.floor(me?.points ?? 0)} · Líder ${Math.floor(top?.points ?? 0)}${c.kind === 'koth' ? `/${this.pointsGoal}` : ''}${it}`;
    }
    if (c.kind === 'ffa') {
      const top = [...this.fighters.values()].sort((a, b) => b.kills - a.kills)[0];
      const me = this.me;
      return `Tú ${me?.kills ?? 0} · Líder ${top?.kills ?? 0}/${c.killLimit}`;
    }
    if (c.kind === 'teams') return `Naranja ${this.teamKills('A')} · Azul ${this.teamKills('B')} /${c.killLimit}`;
    return `Equipo ${this.teamKills('A')} · Máquina ${this.teamKills('B')} /${c.killLimit}`;
  }

  /** Comprueba fin de partida */
  check(): BattleResult | null {
    if (this.finished) return null;
    const c = this.config;
    if (this.pointsMode) {
      const rows = [...this.fighters.values()].sort((a, b) => b.points - a.points);
      const done = this.elapsed >= c.timeLimit || (c.kind === 'koth' && (rows[0]?.points ?? 0) >= this.pointsGoal);
      if (!done) return null;
      this.finished = true;
      const top = rows[0];
      const tie = rows[1] && Math.floor(rows[1].points) === Math.floor(top?.points ?? 0);
      return { winnerLabel: tie ? 'Empate' : `Gana ${top?.name ?? '—'}`, iWon: !tie && top?.id === this.myId, rows, teams: null };
    }
    const rows = [...this.fighters.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    let done = this.elapsed >= c.timeLimit;
    if (c.kind === 'ffa') done ||= (rows[0]?.kills ?? 0) >= c.killLimit;
    else done ||= this.teamKills('A') >= c.killLimit || this.teamKills('B') >= c.killLimit;
    if (!done) return null;
    this.finished = true;
    const me = this.me;
    if (c.kind === 'ffa') {
      const top = rows[0];
      const tie = rows[1] && rows[1].kills === top?.kills;
      return {
        winnerLabel: tie ? 'Empate' : `Gana ${top?.name ?? '—'}`,
        iWon: !tie && top?.id === this.myId,
        rows,
        teams: null,
      };
    }
    const a = this.teamKills('A');
    const b = this.teamKills('B');
    const winner: Team | null = a === b ? null : a > b ? 'A' : 'B';
    const label =
      winner === null
        ? 'Empate'
        : c.kind === 'coop'
          ? winner === 'A'
            ? '¡Victoria del escuadrón!'
            : 'Gana la máquina'
          : `Gana el equipo ${winner === 'A' ? 'Naranja' : 'Azul'}`;
    return {
      winnerLabel: label,
      iWon: winner !== null && me?.team === winner,
      rows,
      teams: [
        { team: 'A', kills: a },
        { team: 'B', kills: b },
      ],
    };
  }
}
