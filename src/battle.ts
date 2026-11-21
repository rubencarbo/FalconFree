import type { Team } from './bots';

export type BattleKind = 'ffa' | 'teams' | 'coop';

export const BATTLE_LABELS: Record<BattleKind, string> = {
  ffa: 'Todos contra todos',
  teams: 'Equipos: Naranja vs Azul',
  coop: 'Todos contra la máquina',
};

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

  add(f: Omit<Fighter, 'kills' | 'deaths'> & { kills?: number; deaths?: number }) {
    const prev = this.fighters.get(f.id);
    this.fighters.set(f.id, { kills: prev?.kills ?? 0, deaths: prev?.deaths ?? 0, ...f } as Fighter);
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
    if (this.config.kind === 'ffa') return true;
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
      f.kills = kills;
      f.deaths = deaths;
    }
  }

  teamKills(team: Team) {
    let k = 0;
    for (const f of this.fighters.values()) if (f.team === team) k += f.kills;
    return k;
  }

  get timeLeft() {
    return Math.max(0, this.config.timeLimit - this.elapsed);
  }

  /** Línea corta para el HUD */
  scoreLine(): string {
    const c = this.config;
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
