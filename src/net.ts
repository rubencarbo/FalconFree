import {
  ref,
  set,
  get,
  update,
  remove,
  push,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  query,
  orderByChild,
  equalTo,
  runTransaction,
  serverTimestamp,
  type DatabaseReference,
  type Unsubscribe,
} from 'firebase/database';
import { firebase } from './firebase';
import type { StageId } from './stages';

export type RoomMode = 'free' | 'race';
export type RoomState = 'lobby' | 'countdown' | 'running';

export interface RoomMeta {
  host: string;
  mode: RoomMode;
  stage: StageId;
  course: string;
  state: RoomState;
  startAt: number;
  round: number;
  createdAt: number;
}

export interface PlayerInfo {
  name: string;
  color: number;
  joinedAt: number;
}

/** Estado de vuelo compacto que se envía ~10 veces por segundo */
export interface NetState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** velocidad m/s */
  s: number;
  /** disparando */
  f: 0 | 1;
  hp: number;
  /** vivo */
  a: 0 | 1;
  /** hora del servidor (ms) */
  t: number;
}

export type NetEventType = 'hit' | 'bump' | 'crash' | 'kill';

export interface NetEvent {
  from: string;
  to: string;
  type: NetEventType;
  /** daño o intensidad */
  v: number;
  t: number;
}

export interface RaceResult {
  name: string;
  time: number;
  round: number;
}

export const PLAYER_COLORS = [0xff7a1a, 0x2ec5ff, 0x8cff3a, 0xff4fd8, 0xffe04a, 0xff3b3b, 0x6a7bff, 0xf2f2f2];
export const MAX_PLAYERS = 8;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0];
  return s;
}

export function normalizeCode(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function formatCode(code: string) {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export class NetError extends Error {}

/** Sala multijugador en Firebase Realtime Database */
export class Room {
  meta: RoomMeta | null = null;
  players = new Map<string, PlayerInfo>();
  results = new Map<string, RaceResult>();
  rings = new Set<string>();

  onMeta?: (m: RoomMeta) => void;
  onPlayers?: () => void;
  onState?: (uid: string, s: NetState | null) => void;
  onEvent?: (e: NetEvent) => void;
  onResults?: () => void;
  onRing?: (id: string, uid: string) => void;
  onClosed?: (reason: string) => void;

  private unsubs: Unsubscribe[] = [];
  private offset = 0;
  private closed = false;
  private root: DatabaseReference;

  private constructor(
    public code: string,
    public uid: string,
    public name: string,
  ) {
    this.root = ref(firebase.database()!, `rooms/${code}`);
  }

  get isHost() {
    return this.meta?.host === this.uid;
  }

  get myColor() {
    return this.players.get(this.uid)?.color ?? PLAYER_COLORS[0];
  }

  /** Hora estimada del servidor en ms */
  serverNow() {
    return Date.now() + this.offset;
  }

  private static async ready() {
    if (!firebase.multiplayer) throw new NetError('El multijugador necesita Firebase configurado (Realtime Database).');
    const user = await firebase.user();
    if (!user) throw new NetError('No se pudo iniciar sesión en Firebase.');
    return user.uid;
  }

  static async create(name: string, mode: RoomMode, stage: StageId, course: string): Promise<Room> {
    const uid = await Room.ready();
    const db = firebase.database()!;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const meta: RoomMeta = { host: uid, mode, stage, course, state: 'lobby', startAt: 0, round: 0, createdAt: Date.now() };
      const res = await runTransaction(ref(db, `rooms/${code}/meta`), (cur) => (cur === null ? meta : undefined));
      if (!res.committed) continue;
      const room = new Room(code, uid, name);
      await room.enter(0);
      return room;
    }
    throw new NetError('No se pudo crear la sala. Inténtalo de nuevo.');
  }

  static async join(rawCode: string, name: string): Promise<Room> {
    const uid = await Room.ready();
    const code = normalizeCode(rawCode);
    if (code.length !== 6) throw new NetError('El código tiene 6 caracteres.');
    const db = firebase.database()!;
    const metaSnap = await get(ref(db, `rooms/${code}/meta`));
    if (!metaSnap.exists()) throw new NetError(`No existe ninguna sala con el código ${formatCode(code)}.`);
    const meta = metaSnap.val() as RoomMeta;
    const playersSnap = await get(ref(db, `rooms/${code}/players`));
    const players = (playersSnap.val() ?? {}) as Record<string, PlayerInfo>;
    const count = Object.keys(players).filter((k) => k !== uid).length;
    if (count >= MAX_PLAYERS) throw new NetError('La sala está llena.');
    if (meta.mode === 'race' && meta.state !== 'lobby' && !players[uid]) {
      throw new NetError('La carrera ya ha empezado. Espera a que vuelvan a la sala.');
    }
    const used = new Set(Object.entries(players).filter(([k]) => k !== uid).map(([, p]) => p.color));
    const colorIdx = PLAYER_COLORS.findIndex((c) => !used.has(c));
    const room = new Room(code, uid, name);
    await room.enter(Math.max(0, colorIdx));
    return room;
  }

  private async enter(colorIdx: number) {
    const db = firebase.database()!;
    this.unsubs.push(
      onValue(ref(db, '.info/serverTimeOffset'), (s) => {
        this.offset = Number(s.val() ?? 0);
      }),
    );
    const me = ref(db, `rooms/${this.code}/players/${this.uid}`);
    const pos = ref(db, `rooms/${this.code}/pos/${this.uid}`);
    await onDisconnect(me).remove();
    await onDisconnect(pos).remove();
    await set(me, { name: this.name, color: PLAYER_COLORS[colorIdx], joinedAt: serverTimestamp() });

    this.unsubs.push(
      onValue(ref(db, `rooms/${this.code}/meta`), (s) => {
        const m = s.val() as RoomMeta | null;
        if (!m) {
          this.close('La sala se ha cerrado.');
          return;
        }
        this.meta = m;
        this.onMeta?.(m);
        this.checkHost();
      }),
      onValue(ref(db, `rooms/${this.code}/players`), (s) => {
        this.players.clear();
        const v = (s.val() ?? {}) as Record<string, PlayerInfo>;
        for (const [k, p] of Object.entries(v)) this.players.set(k, p);
        this.onPlayers?.();
        this.checkHost();
      }),
      onChildAdded(ref(db, `rooms/${this.code}/pos`), (s) => {
        if (s.key !== this.uid) this.onState?.(s.key!, s.val() as NetState);
      }),
      onChildChanged(ref(db, `rooms/${this.code}/pos`), (s) => {
        if (s.key !== this.uid) this.onState?.(s.key!, s.val() as NetState);
      }),
      onChildRemoved(ref(db, `rooms/${this.code}/pos`), (s) => {
        if (s.key !== this.uid) this.onState?.(s.key!, null);
      }),
      onChildAdded(query(ref(db, `rooms/${this.code}/events`), orderByChild('to'), equalTo(this.uid)), (s) => {
        const e = s.val() as NetEvent;
        remove(s.ref).catch(() => undefined);
        // Ignorar eventos antiguos (p. ej. de una sesión anterior)
        if (this.serverNow() - e.t < 5000) this.onEvent?.(e);
      }),
      onValue(ref(db, `rooms/${this.code}/results`), (s) => {
        this.results.clear();
        const v = (s.val() ?? {}) as Record<string, RaceResult>;
        for (const [k, r] of Object.entries(v)) this.results.set(k, r);
        this.onResults?.();
      }),
      onChildAdded(ref(db, `rooms/${this.code}/rings`), (s) => {
        this.rings.add(s.key!);
        this.onRing?.(s.key!, String(s.val()));
      }),
      onChildRemoved(ref(db, `rooms/${this.code}/rings`), (s) => {
        this.rings.delete(s.key!);
      }),
    );
  }

  /** Si el anfitrión se ha ido, el jugador más antiguo toma el relevo */
  private checkHost() {
    if (!this.meta || this.closed || this.players.size === 0) return;
    if (this.players.has(this.meta.host)) return;
    const oldest = [...this.players.entries()].sort((a, b) => a[1].joinedAt - b[1].joinedAt)[0];
    if (oldest && oldest[0] === this.uid) {
      update(ref(firebase.database()!, `rooms/${this.code}/meta`), { host: this.uid }).catch(() => undefined);
    }
  }

  sendState(s: Omit<NetState, 't'>) {
    if (this.closed) return;
    const r = (v: number) => Math.round(v * 10) / 10;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    set(ref(firebase.database()!, `rooms/${this.code}/pos/${this.uid}`), {
      x: r(s.x),
      y: r(s.y),
      z: r(s.z),
      yaw: r3(s.yaw),
      pitch: r3(s.pitch),
      roll: r3(s.roll),
      s: r(s.s),
      f: s.f,
      hp: Math.round(s.hp),
      a: s.a,
      t: Math.round(this.serverNow()),
    }).catch(() => undefined);
  }

  sendEvent(to: string, type: NetEventType, v: number) {
    if (this.closed) return;
    const e: NetEvent = { from: this.uid, to, type, v: Math.round(v * 10) / 10, t: Math.round(this.serverNow()) };
    push(ref(firebase.database()!, `rooms/${this.code}/events`), e).catch(() => undefined);
  }

  async setMeta(patch: Partial<RoomMeta>) {
    if (!this.isHost) return;
    await update(ref(firebase.database()!, `rooms/${this.code}/meta`), patch);
  }

  /** El anfitrión lanza la cuenta atrás para todos */
  async startRound() {
    if (!this.isHost || !this.meta) return;
    const db = firebase.database()!;
    await remove(ref(db, `rooms/${this.code}/results`));
    await remove(ref(db, `rooms/${this.code}/rings`)).catch(() => undefined);
    await this.setMeta({ state: 'countdown', startAt: Math.round(this.serverNow() + 5000), round: this.meta.round + 1 });
  }

  async backToLobby() {
    await this.setMeta({ state: 'lobby' });
  }

  async submitResult(time: number) {
    if (!this.meta) return;
    await set(ref(firebase.database()!, `rooms/${this.code}/results/${this.uid}`), {
      name: this.name,
      time: Math.round(time * 1000) / 1000,
      round: this.meta.round,
    });
  }

  /** Recoge un anillo para el equipo (el primero que llega se lo queda) */
  claimRing(id: string) {
    if (this.closed || this.rings.has(id)) return;
    const key = id.replace(/[^0-9a-zA-Z_-]/g, '_');
    set(ref(firebase.database()!, `rooms/${this.code}/rings/${key}`), this.uid).catch(() => undefined);
  }

  private close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.onClosed?.(reason);
  }

  async leave() {
    if (this.closed) return;
    const db = firebase.database()!;
    const alone = this.players.size <= 1;
    const wasHost = this.isHost;
    this.closed = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    try {
      if (alone && wasHost) {
        await remove(this.root);
      } else {
        await remove(ref(db, `rooms/${this.code}/pos/${this.uid}`));
        await remove(ref(db, `rooms/${this.code}/players/${this.uid}`));
      }
      await onDisconnect(ref(db, `rooms/${this.code}/players/${this.uid}`)).cancel();
      await onDisconnect(ref(db, `rooms/${this.code}/pos/${this.uid}`)).cancel();
    } catch {
      /* sin conexión: onDisconnect limpiará */
    }
  }
}
