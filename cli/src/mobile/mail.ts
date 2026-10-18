import { accounts, getAccount, type Account } from "../connectors/accounts.js";
import { createDraft, draftMessage, readMail, searchMail, withImap, type MailDependencies } from "../connectors/mail.js";
import { googleRequest } from "../connectors/google.js";
import { MobileRequests } from "./requests.js";
import type { IntelligenceEventStore } from "../intelligence/event-store.js";

export interface MailItem { id: string; account: string; subject: string; from: string; date?: string; snippet?: string; mailbox?: string }
type Headers = Array<{ name: string; value: string }>;
const header = (headers: Headers, name: string): string => headers.find(h => h.name.toLowerCase() === name)?.value ?? "";
const sender = (value: unknown): string => Array.isArray(value) ? value.map(p => p.name || p.address || "").join(", ") : String(value || "");

/** Read-only inbox metadata; no implicit marking-as-read or remote HTML. */
async function inbox(account: Account, deps: MailDependencies): Promise<{ items: MailItem[]; more: boolean }> {
  if (account.provider === "google") {
    const data = await (await googleRequest(account.id, "gmail", "threads?q=in%3Ainbox&maxResults=12", {}, deps.http)).json() as { threads?: Array<{ id: string; snippet?: string }>; nextPageToken?: string };
    const items = await Promise.all((data.threads ?? []).slice(0, 12).map(async thread => {
      try {
        const meta = await (await googleRequest(account.id, "gmail", `threads/${encodeURIComponent(thread.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, {}, deps.http)).json() as { messages?: Array<{ payload?: { headers?: Headers } }> };
        const headers = meta.messages?.at(-1)?.payload?.headers ?? [];
        return { account: account.id, id: thread.id, subject: header(headers, "subject") || "No subject", from: header(headers, "from"), date: header(headers, "date"), snippet: thread.snippet };
      } catch { return { account: account.id, id: thread.id, subject: "Open conversation", from: "", snippet: thread.snippet }; }
    }));
    return { items, more: !!data.nextPageToken };
  }
  return withImap(account, deps, async client => {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const validity = client.mailbox ? String(client.mailbox.uidValidity) : "";
      const uids = (await client.search({ all: true }, { uid: true }) || []);
      const latest = uids.slice(-12).reverse();
      const items: MailItem[] = [];
      if (latest.length) for await (const row of client.fetch(latest, { envelope: true }, { uid: true })) {
        items.push({ account: account.id, id: `${validity}:${row.uid}`, mailbox: "INBOX", subject: row.envelope?.subject || "No subject", from: sender(row.envelope?.from), date: row.envelope?.date ? new Date(row.envelope.date).toISOString() : undefined });
      }
      items.sort((a,b) => Number(b.id.split(":")[1]) - Number(a.id.split(":")[1]));
      return { items, more: uids.length > 12 };
    } finally { lock.release(); }
  });
}

/** The mail artefact uses existing account connectors, with one durable claim
 * per reviewed save. It exposes no email sending, deletion or model execution. */
export class MobileMail {
  private readonly drafts: MobileRequests;
  constructor(db: IntelligenceEventStore, private readonly deps: MailDependencies = {}) {
    this.drafts = new MobileRequests(db, "mobile.mail.drafts");
    this.drafts.recover();
  }
  async run(action: string, input: Record<string, unknown>): Promise<unknown> {
    if (action === "accounts") return { accounts: accounts() };
    if (action === "drafts") return { drafts: this.drafts.list().slice(-12).reverse().map(row => {
      const draft = JSON.parse(row.text);
      return { id: row.id, at: row.at, status: row.status, account: draft.account, to: draft.to, subject: draft.subject };
    }) };
    const account = getAccount(String(input.account || ""));
    if (action === "inbox") return inbox(account, this.deps);
    if (action === "search") {
      const result = await searchMail({ account: account.id, query: input.query, limit: 12 }, this.deps) as { results: Array<{ error?: string; threads?: Array<{ id: string; snippet?: string }>; messages?: Array<{ id: string; subject?: string; from?: unknown; date?: string; mailbox?: string }>; more?: boolean }> };
      const group = result.results[0];
      if (!group || group.error) throw new Error("Mail search unavailable");
      return { items: group.threads?.map(t => ({ account: account.id, id: t.id, subject: "Open conversation", from: "", snippet: t.snippet })) ?? group.messages?.map(m => ({ ...m, account: account.id, subject: m.subject || "No subject", from: sender(m.from) })) ?? [], more: !!group.more };
    }
    if (action === "read") {
      const raw = await readMail({ account: account.id, id: input.id, mailbox: input.mailbox }, this.deps) as { messages?: Array<{ id: string; headers?: Headers; text: string; truncated?: boolean; attachments?: unknown[] }>; subject?: string; from?: string; text?: string; source?: string; truncated?: boolean; omittedMessages?: number };
      return { account: account.id, provider: account.provider, id: String(input.id), mailbox: input.mailbox,
        source: raw.source?.startsWith("https://mail.google.com/") ? raw.source : undefined,
        omittedMessages: raw.omittedMessages || 0,
        messages: raw.messages?.map(m => ({ id: m.id, subject: header(m.headers ?? [], "subject"), from: header(m.headers ?? [], "from"), date: header(m.headers ?? [], "date"), text: m.text, truncated: !!m.truncated, attachments: m.attachments?.length ?? 0 })) ?? [{ id: input.id, subject: raw.subject, from: raw.from, text: raw.text, truncated: !!raw.truncated }],
      };
    }
    if (action === "save") {
      const draft = { account: account.id, to: String(input.to || "").trim(), subject: String(input.subject || "").trim(), body: String(input.body || ""), ...(account.provider === "google" && input.thread_id ? { thread_id: String(input.thread_id) } : {}) };
      // Validate before claiming. Invalid input never reaches a provider.
      draftMessage(account.email, draft);
      if (JSON.stringify(draft).length > 12_000) throw new Error("Draft is too long for mobile. Shorten it before saving.");
      const id = String(input.id || ""), previous = this.drafts.get(id);
      const row = this.drafts.accept(id, JSON.stringify(draft));
      if (previous) return { id, status: row.status };
      this.drafts.settle(id, "running");
      try {
        await createDraft(draft, this.deps);
        this.drafts.settle(id, "succeeded", "Email draft saved. It has not been sent.");
      } catch {
        this.drafts.settle(id, "unknown", "Draft save could not be confirmed. Check your account before saving another copy.");
      }
      return { id, status: this.drafts.get(id)!.status };
    }
    throw new Error("Unknown mail action");
  }
}
