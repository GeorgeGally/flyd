import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { accountId, getAccount, saveAccount, secret, type GoogleSecret } from "./accounts.js";

export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"];
export type Http = typeof fetch;
const tokens = new Map<string, { token: string; until: number }>();
const refreshing = new Map<string, Promise<string>>();
export function clearGoogleTokens(): void { tokens.clear(); refreshing.clear(); }
async function tokenResponse(body: URLSearchParams, http: Http): Promise<Record<string, any>> {
  const response = await http("https://oauth2.googleapis.com/token", { method: "POST", body, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Google authentication failed (${response.status}); reconnect with flyd accounts google`);
  return response.json();
}
export async function accessToken(id: string, http: Http = fetch): Promise<string> {
  if (getAccount(id).provider !== "google") throw new Error("Expected a Google account");
  const cached = tokens.get(id);
  if (cached && cached.until > Date.now()) return cached.token;
  if (refreshing.has(id)) return refreshing.get(id)!;
  const task = (async () => {
    if (getAccount(id).provider !== "google") throw new Error("Expected a Google account");
    const credentials = secret<GoogleSecret>(id);
    const body = new URLSearchParams({ client_id: credentials.clientId, refresh_token: credentials.refreshToken, grant_type: "refresh_token" });
    if (credentials.clientSecret) body.set("client_secret", credentials.clientSecret);
    const data = await tokenResponse(body, http);
    if (typeof data.access_token !== "string") throw new Error("Google did not return an access token");
    tokens.set(id, { token: data.access_token, until: Date.now() + Math.max(0, (Number(data.expires_in) || 3600) - 60) * 1000 });
    return data.access_token;
  })();
  refreshing.set(id, task);
  try { return await task; } finally { refreshing.delete(id); }
}
export async function googleRequest(id: string, service: "gmail" | "drive", path: string, init: RequestInit = {}, http: Http = fetch): Promise<Response> {
  const base = service === "gmail" ? "https://gmail.googleapis.com/gmail/v1/users/me/" : "https://www.googleapis.com/drive/v3/";
  const run = async () => http(base + path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await accessToken(id, http)}` }, signal: AbortSignal.timeout(20_000) });
  let response = await run();
  if (response.status === 401) { tokens.delete(id); response = await run(); }
  if (!response.ok) throw new Error(`Google ${service} request failed (${response.status})${response.status === 403 ? "; check API enablement and reconnect for required scopes" : ""}`);
  return response;
}
export function authUrl(clientId: string, redirect: string, state: string, verifier: string): string {
  const parameters = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: GOOGLE_SCOPES.join(" "), state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", access_type: "offline", prompt: "consent select_account" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${parameters}`;
}
export async function connectGoogle(id: string, clientId: string, clientSecret: string | undefined, announce: (url: string) => void, http: Http = fetch): Promise<void> {
  accountId(id);
  // A loopback callback is valid for Google's Desktop client type; never use Lovelybots' web client here.
  const state = randomBytes(24).toString("base64url"), verifier = randomBytes(32).toString("base64url");
  let redirect = "";
  let timer: ReturnType<typeof setTimeout>;
  const codePromise = new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url || "/", redirect);
      if (url.pathname !== "/callback") { response.writeHead(404).end(); return; }
      if (url.searchParams.get("state") !== state) { response.writeHead(400).end("Invalid OAuth state"); return; }
      const code = url.searchParams.get("code");
      clearTimeout(timer);
      response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" }).end("Return to Flyd to finish connecting.");
      server.close();
      if (code) resolve(code); else reject(new Error("Google consent was declined"));
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
      timer = setTimeout(() => { server.close(); reject(new Error("Google connection timed out")); }, 5 * 60_000);
      try { announce(authUrl(clientId, redirect, state, verifier)); } catch (error) { clearTimeout(timer); server.close(); reject(error); }
    });
  });
  const code = await codePromise;
  const body = new URLSearchParams({ client_id: clientId, code, code_verifier: verifier, redirect_uri: redirect, grant_type: "authorization_code" });
  if (clientSecret) body.set("client_secret", clientSecret);
  const data = await tokenResponse(body, http);
  if (!data.refresh_token) throw new Error("No offline refresh token returned; reconnect with consent");
  const granted = String(data.scope || "").split(" ");
  if (GOOGLE_SCOPES.filter(s => s.startsWith("https://www.googleapis.com/")).some(s => !granted.includes(s))) throw new Error("Required mail/Drive permissions were declined; account was not saved");
  const response = await http("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${data.access_token}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("Could not verify Google account identity");
  const identity = await response.json() as { email?: string; email_verified?: boolean };
  if (!identity.email || !identity.email_verified) throw new Error("Google email identity is unverified");
  saveAccount({ id, provider: "google", email: identity.email }, { clientId, clientSecret, refreshToken: data.refresh_token, scopes: granted });
  clearGoogleTokens();
}
