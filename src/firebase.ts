import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator, type Auth, type User } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { getDatabase, connectDatabaseEmulator, type Database } from 'firebase/database';
import type { StageId } from './stages';

export interface ScoreEntry {
  uid: string;
  name: string;
  stage: StageId;
  rings: number;
  maxSpeed: number;
}

export interface TimeEntry {
  uid: string;
  name: string;
  course: string;
  timeMs: number;
  country?: string;
}

/** País del jugador (de la configuración regional del navegador): «ES», «MX»… */
export function playerCountry(): string {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale || navigator.language || '';
    const m = /[-_]([A-Za-z]{2})\b/.exec(loc);
    return m ? m[1].toUpperCase() : '';
  } catch {
    return '';
  }
}

export function countryName(code: string) {
  try {
    return new Intl.DisplayNames(['es'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Fantasma del récord mundial de un circuito */
export interface WorldGhost {
  uid: string;
  name: string;
  course: string;
  timeMs: number;
  /** GhostData en JSON */
  f: string;
}

/** Circuito creado por un jugador */
export interface SharedCircuit {
  uid: string;
  author: string;
  name: string;
  stage: StageId;
  /** hitos codificados */
  g: string;
}

const env = import.meta.env;
const useEmulators = env.VITE_USE_EMULATORS === '1';
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || (useEmulators ? 'demo-key' : undefined),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || (useEmulators ? 'demo-falconsky' : undefined),
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID || (useEmulators ? 'demo-app' : undefined),
  databaseURL:
    env.VITE_FIREBASE_DATABASE_URL || (useEmulators ? `http://127.0.0.1:9000?ns=${env.VITE_FIREBASE_PROJECT_ID || 'demo-falconsky'}` : undefined),
};

class FirebaseService {
  enabled = Boolean(config.apiKey && config.projectId && config.appId);
  /** El multijugador necesita además la URL de Realtime Database */
  get multiplayer() {
    return this.enabled && Boolean(config.databaseURL);
  }
  private app?: FirebaseApp;
  private auth?: Auth;
  private db?: Firestore;
  private rtdb?: Database;
  private userPromise?: Promise<User | null>;

  private init() {
    if (!this.enabled || this.app) return;
    try {
      this.app = initializeApp(config);
      this.auth = getAuth(this.app);
      this.db = getFirestore(this.app);
      if (useEmulators) {
        const host = env.VITE_EMULATOR_HOST || '127.0.0.1';
        connectAuthEmulator(this.auth, `http://${host}:9099`, { disableWarnings: true });
        connectFirestoreEmulator(this.db, host, 8080);
      }
    } catch (e) {
      console.warn('[firebase] no se pudo inicializar', e);
      this.enabled = false;
    }
  }

  database(): Database | null {
    this.init();
    if (!this.app || !config.databaseURL) return null;
    if (!this.rtdb) {
      this.rtdb = getDatabase(this.app);
      if (useEmulators) connectDatabaseEmulator(this.rtdb, env.VITE_EMULATOR_HOST || '127.0.0.1', 9000);
    }
    return this.rtdb;
  }

  /** Inicia sesión anónima (una sola vez) */
  user(): Promise<User | null> {
    this.init();
    if (!this.auth) return Promise.resolve(null);
    if (!this.userPromise) {
      const auth = this.auth;
      this.userPromise = new Promise<User | null>((resolve) => {
        const unsub = onAuthStateChanged(auth, (u) => {
          if (u) {
            unsub();
            resolve(u);
          }
        });
        signInAnonymously(auth).catch((e) => {
          console.warn('[firebase] auth anónima falló', e);
          unsub();
          resolve(null);
        });
      });
    }
    return this.userPromise;
  }

  async uid(): Promise<string | null> {
    return (await this.user())?.uid ?? null;
  }

  /** Guarda anillos si mejora la marca. Devuelve true si se guardó. */
  async submit(stage: StageId, name: string, rings: number, maxSpeed: number): Promise<boolean> {
    if (!this.enabled || rings <= 0) return false;
    const u = await this.user();
    if (!u || !this.db) return false;
    const ref = doc(this.db, 'scores', `${stage}_${u.uid}`);
    try {
      const snap = await getDoc(ref);
      if (snap.exists() && (snap.data().rings ?? 0) >= rings) return false;
      await setDoc(ref, {
        uid: u.uid,
        name: name.slice(0, 16) || 'Piloto',
        stage,
        rings: Math.floor(rings),
        maxSpeed: Math.round(maxSpeed),
        updatedAt: serverTimestamp(),
      });
      return true;
    } catch (e) {
      console.warn('[firebase] error guardando puntuación', e);
      return false;
    }
  }

  async top(stage: StageId, n = 10): Promise<ScoreEntry[]> {
    if (!this.enabled) return [];
    this.init();
    if (!this.db) return [];
    await this.user();
    const q = query(collection(this.db, 'scores'), where('stage', '==', stage), orderBy('rings', 'desc'), limit(n));
    const res = await getDocs(q);
    return res.docs.map((d) => d.data() as ScoreEntry);
  }

  /** Guarda un tiempo de carrera si mejora la marca */
  async submitTime(course: string, name: string, timeSec: number): Promise<boolean> {
    if (!this.enabled) return false;
    const u = await this.user();
    if (!u || !this.db) return false;
    const timeMs = Math.round(timeSec * 1000);
    const ref = doc(this.db, 'times', `${course}_${u.uid}`);
    try {
      const snap = await getDoc(ref);
      if (snap.exists() && (snap.data().timeMs ?? Infinity) <= timeMs) return false;
      const country = playerCountry();
      await setDoc(ref, { uid: u.uid, name: name.slice(0, 16) || 'Piloto', course, timeMs, ...(country ? { country } : {}), updatedAt: serverTimestamp() });
      return true;
    } catch (e) {
      console.warn('[firebase] error guardando tiempo', e);
      return false;
    }
  }

  async topTimes(course: string, n = 10): Promise<TimeEntry[]> {
    if (!this.enabled) return [];
    this.init();
    if (!this.db) return [];
    await this.user();
    const q = query(collection(this.db, 'times'), where('course', '==', course), orderBy('timeMs', 'asc'), limit(n));
    const res = await getDocs(q);
    return res.docs.map((d) => d.data() as TimeEntry);
  }

  // ------------------------------------------------------------ Perfil en la nube
  /** Sube la copia del perfil con el código de recuperación (secreto) */
  async saveCloud(code: string, data: string, name: string): Promise<boolean> {
    const u = await this.user();
    if (!u || !this.db) return false;
    await setDoc(doc(this.db, 'saves', code), { data, name: name.slice(0, 16) || 'Piloto', v: 1, updatedAt: serverTimestamp() });
    return true;
  }

  /** Descarga la copia del perfil (null si no existe) */
  async loadCloud(code: string): Promise<{ data: string; name: string } | null> {
    const u = await this.user();
    if (!u || !this.db) return null;
    const snap = await getDoc(doc(this.db, 'saves', code));
    if (!snap.exists()) return null;
    const d = snap.data() as { data?: string; name?: string };
    return typeof d.data === 'string' ? { data: d.data, name: d.name ?? '' } : null;
  }

  // ------------------------------------------------------------ Fantasmas del récord mundial
  async worldGhost(course: string): Promise<WorldGhost | null> {
    if (!this.enabled) return null;
    this.init();
    if (!this.db) return null;
    await this.user();
    const snap = await getDoc(doc(this.db, 'ghosts', course));
    return snap.exists() ? (snap.data() as WorldGhost) : null;
  }

  /** Sube el fantasma si bate el récord mundial. Devuelve true si se guardó. */
  async submitWorldGhost(course: string, name: string, timeSec: number, ghostJson: string): Promise<boolean> {
    if (!this.enabled || ghostJson.length > 450000) return false;
    const u = await this.user();
    if (!u || !this.db) return false;
    const timeMs = Math.round(timeSec * 1000);
    try {
      const cur = await this.worldGhost(course);
      if (cur && cur.timeMs <= timeMs) return false;
      await setDoc(doc(this.db, 'ghosts', course), { uid: u.uid, name: name.slice(0, 16) || 'Piloto', course, timeMs, f: ghostJson, updatedAt: serverTimestamp() });
      return true;
    } catch (e) {
      console.warn('[firebase] error guardando fantasma mundial', e);
      return false;
    }
  }

  // ------------------------------------------------------------ Circuitos compartidos
  async publishCircuit(code: string, c: Omit<SharedCircuit, 'uid'>): Promise<boolean> {
    const u = await this.user();
    if (!u || !this.db) return false;
    await setDoc(doc(this.db, 'circuits', code), { ...c, uid: u.uid, createdAt: serverTimestamp() });
    return true;
  }

  async loadCircuit(code: string): Promise<SharedCircuit | null> {
    if (!this.enabled) return null;
    this.init();
    if (!this.db) return null;
    await this.user();
    const snap = await getDoc(doc(this.db, 'circuits', code));
    return snap.exists() ? (snap.data() as SharedCircuit) : null;
  }

  // ------------------------------------------------------------ Rivales del día
  /** Guarda el fantasma de mi mejor vuelta (para que otros puedan correr contra él) */
  async submitPlayerGhost(course: string, name: string, timeSec: number, ghostJson: string): Promise<boolean> {
    if (!this.enabled || ghostJson.length > 450000) return false;
    const u = await this.user();
    if (!u || !this.db) return false;
    const timeMs = Math.round(timeSec * 1000);
    const ref = doc(this.db, 'ghostsAll', `${course}_${u.uid}`);
    try {
      const snap = await getDoc(ref);
      if (snap.exists() && (snap.data().timeMs ?? Infinity) <= timeMs) return false;
      await setDoc(ref, { uid: u.uid, name: name.slice(0, 16) || 'Piloto', course, timeMs, f: ghostJson, updatedAt: serverTimestamp() });
      return true;
    } catch (e) {
      console.warn('[firebase] error guardando fantasma', e);
      return false;
    }
  }

  async playerGhost(course: string, uid: string): Promise<WorldGhost | null> {
    if (!this.enabled || !this.db) return null;
    const snap = await getDoc(doc(this.db, 'ghostsAll', `${course}_${uid}`));
    return snap.exists() ? (snap.data() as WorldGhost) : null;
  }

  /** El piloto que va justo por delante de mi tiempo (o el último del top si aún no tengo) */
  async rivalAhead(course: string, myMs: number | null): Promise<TimeEntry | null> {
    if (!this.enabled) return null;
    this.init();
    if (!this.db) return null;
    await this.user();
    const base = collection(this.db, 'times');
    const q = myMs !== null ? query(base, where('course', '==', course), where('timeMs', '<', myMs), orderBy('timeMs', 'desc'), limit(1)) : query(base, where('course', '==', course), orderBy('timeMs', 'desc'), limit(1));
    const res = await getDocs(q);
    return res.empty ? null : (res.docs[0].data() as TimeEntry);
  }

  async bestInCountry(course: string, country: string): Promise<TimeEntry | null> {
    if (!this.enabled || !country) return null;
    this.init();
    if (!this.db) return null;
    await this.user();
    const res = await getDocs(query(collection(this.db, 'times'), where('course', '==', course), where('country', '==', country), orderBy('timeMs', 'asc'), limit(1)));
    return res.empty ? null : (res.docs[0].data() as TimeEntry);
  }

  /** Mejor tiempo entre mis amigos (pilotos con los que he jugado) */
  async bestOfFriends(course: string, uids: string[]): Promise<TimeEntry | null> {
    if (!this.enabled || !uids.length) return null;
    this.init();
    if (!this.db) return null;
    await this.user();
    const db = this.db;
    const snaps = await Promise.all(uids.slice(0, 12).map((u) => getDoc(doc(db, 'times', `${course}_${u}`)).catch(() => null)));
    let best: TimeEntry | null = null;
    for (const sn of snaps) {
      if (!sn?.exists()) continue;
      const t = sn.data() as TimeEntry;
      if (!best || t.timeMs < best.timeMs) best = t;
    }
    return best;
  }
}

export const firebase = new FirebaseService();
