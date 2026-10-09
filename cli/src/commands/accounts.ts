import { accounts, disconnectAccount, getAccount, saveAccount } from "../connectors/accounts.js";
import { clearGoogleTokens, connectGoogle, googleRequest } from "../connectors/google.js";
import { withImap } from "../connectors/mail.js";
import { loadFlydEnvironment } from "../lib/config.js";

export async function runAccounts(args: string[]): Promise<void> {
  loadFlydEnvironment();
  const [action = "list", id, email] = args;
  if (action === "list") {
    console.log(JSON.stringify({ accounts: accounts(), help: "flyd accounts google <id> | dreamhost <id> <email> | check [id] | disconnect <id>" }, null, 2)); return;
  }
  if (action === "google") {
    if (!id || !process.env.FLYD_GOOGLE_CLIENT_ID) throw new Error("Use flyd accounts google <id> with FLYD_GOOGLE_CLIENT_ID and optional FLYD_GOOGLE_CLIENT_SECRET set to a Desktop OAuth client");
    await connectGoogle(id, process.env.FLYD_GOOGLE_CLIENT_ID, process.env.FLYD_GOOGLE_CLIENT_SECRET, url => console.log(`Open this URL in your browser to connect:\n${url}`));
    console.log(`Connected Google account ${getAccount(id).email}.`); return;
  }
  if (action === "dreamhost") {
    if (!id || !email || !/^[^\s@\r\n]+@[^\s@\r\n]+$/.test(email)) throw new Error("Use flyd accounts dreamhost <id> <email>");
    const password = process.env.FLYD_DREAMHOST_PASSWORD;
    if (!password) throw new Error("Set FLYD_DREAMHOST_PASSWORD in your local environment; never pass it as a command argument");
    saveAccount({ id, email, provider: "dreamhost" }, { password });
    delete process.env.FLYD_DREAMHOST_PASSWORD;
    console.log(`Saved DreamHost account ${email}; run flyd accounts check ${id} to verify.`); return;
  }
  if (action === "disconnect") {
    if (!id) throw new Error("disconnect needs an account id");
    disconnectAccount(id); clearGoogleTokens(); console.log(`Removed local credentials for ${id}. Revoke Google access in your Google account settings if needed.`); return;
  }
  if (action === "check") {
    const selected = id ? [getAccount(id)] : accounts();
    const results = await Promise.all(selected.map(async account => {
      if (account.provider === "dreamhost") {
        try { await withImap(account, {}, async client => { await client.list(); }); return { ...account, mail: "ok" }; }
        catch { return { ...account, mail: "failed: check mailbox password and network access" }; }
      }
      const checks = await Promise.all(["gmail", "drive"].map(async service => {
        try {
          await googleRequest(account.id, service as "gmail" | "drive", service === "gmail" ? "profile" : "files?pageSize=1&fields=files(id)");
          return [service, "ok"];
        } catch { return [service, "failed: reconnect or check API enablement/network access"]; }
      }));
      return { ...account, ...Object.fromEntries(checks) };
    }));
    console.log(JSON.stringify(results, null, 2)); return;
  }
  throw new Error("Unknown accounts command. Use list, google, dreamhost, check or disconnect.");
}
