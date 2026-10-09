import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type Account = { id: string; provider: "google" | "dreamhost"; email: string };
export type GoogleSecret = { clientId: string; clientSecret?: string; refreshToken: string; scopes: string[] };
export type DreamHostSecret = { password: string };
export function connectorDir(): string { return process.env.FLYD_CONNECTOR_DIR || join(homedir(), ".flyd", "connectors"); }
export function accountId(id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid account id");
  return id;
}
function privateWrite(path: string, value: unknown): void {
  mkdirSync(connectorDir(), { recursive: true, mode: 0o700 });
  chmodSync(connectorDir(), 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}
export function accounts(): Account[] {
  const path = join(connectorDir(), "accounts.json");
  if (!existsSync(path)) return [];
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(value) || value.some(a => !a || !["google", "dreamhost"].includes(a.provider) || typeof a.email !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(a.id))) throw new Error("Invalid connector account configuration");
  return value;
}
export function getAccount(id: string): Account {
  const account = accounts().find(a => a.id === accountId(id));
  if (!account) throw new Error(`Account ${id} is not connected. Run flyd accounts list.`);
  return account;
}
export function secret<T>(id: string): T { return JSON.parse(readFileSync(join(connectorDir(), `${accountId(id)}.secret.json`), "utf8")); }
export function saveAccount(account: Account, credentials: GoogleSecret | DreamHostSecret): void {
  accountId(account.id);
  const current = accounts();
  if (current.some(a => a.id === account.id && (a.email !== account.email || a.provider !== account.provider))) throw new Error("Account id already belongs to a different account; disconnect it first");
  privateWrite(join(connectorDir(), `${account.id}.secret.json`), credentials);
  privateWrite(join(connectorDir(), "accounts.json"), [...current.filter(a => a.id !== account.id), account]);
}
export function disconnectAccount(id: string): void {
  getAccount(id);
  privateWrite(join(connectorDir(), "accounts.json"), accounts().filter(a => a.id !== id));
  unlinkSync(join(connectorDir(), `${accountId(id)}.secret.json`));
}
