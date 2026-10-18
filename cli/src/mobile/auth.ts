import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const COOKIE = "__Host-flyd-mobile";
export interface Session { digest: string; csrf: string; expires: number }
interface AuthState { pairing?: { digest: string; expires: number }; sessions: Session[] }
/** Credentials only: raw pairing/session secrets never enter this database.
 * IMMEDIATE transactions also serialize SSH admin commands with HTTP logins. */
export class MobileAuth {
  constructor(private readonly dir: string, private readonly now = () => Date.now()) { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  private use<T>(work: (state: AuthState) => T): T {
    const path = join(this.dir, "auth.sqlite"), db = new Database(path);
    chmodSync(path, 0o600);
    try {
      db.pragma("busy_timeout = 5000");
      db.exec("CREATE TABLE IF NOT EXISTS auth_state (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)");
      return db.transaction(() => {
        const row = db.prepare("SELECT state FROM auth_state WHERE id=1").get() as { state: string } | undefined;
        const state: AuthState = row ? JSON.parse(row.state) : { sessions: [] };
        const result = work(state);
        db.prepare("INSERT INTO auth_state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state").run(JSON.stringify(state));
        return result;
      }).immediate();
    } finally { db.close(); }
  }
  pair(): string {
    return this.use(state => {
      const code = randomBytes(24).toString("base64url");
      state.pairing = { digest: hash(code), expires: this.now() + 10 * 60_000 }; return code;
    });
  }
  login(code: string): { token: string; session: Session } | null {
    return this.use(state => {
      if (!state.pairing || state.pairing.expires <= this.now() || !this.equal(hash(code), state.pairing.digest)) return null;
      const token = randomBytes(32).toString("base64url");
      const session = { digest: hash(token), csrf: randomBytes(24).toString("hex"), expires: this.now() + 30 * 86400_000 };
      state.sessions = [...state.sessions.filter(s => s.expires > this.now()).slice(-9), session];
      delete state.pairing; return { token, session };
    });
  }
  session(cookie?: string): Session | null {
    const token = cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!token) return null;
    return this.use(state => state.sessions.find(s => s.expires > this.now() && this.equal(hash(token), s.digest)) ?? null);
  }
  revoke(session: Session): void { this.use(state => { state.sessions = state.sessions.filter(s => s.digest !== session.digest); }); }
  revokeAll(): void { this.use(state => { state.sessions = []; delete state.pairing; }); }
  private equal(a: string, b: string): boolean { return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
}
