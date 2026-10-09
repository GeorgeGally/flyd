import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { accounts, getAccount, secret, type Account, type DreamHostSecret } from "./accounts.js";
import { googleRequest, type Http } from "./google.js";

const MAX_MESSAGE = 5 * 1024 * 1024;
export const countLimit = (n: unknown): number => Math.min(20, Math.max(1, Math.floor(Number(n) || 10)));
export const clipped = (text: string, max = 40_000) => ({ text: text.slice(0, max), truncated: text.length > max });
export interface MailDependencies { http?: Http; imap?: (account: Account) => ImapFlow }
function clientFor(account: Account): ImapFlow {
  return new ImapFlow({ host: "imap.dreamhost.com", port: 993, secure: true, auth: { user: account.email, pass: secret<DreamHostSecret>(account.id).password }, logger: false, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000, disableAutoIdle: true });
}
export async function withImap<T>(account: Account, deps: MailDependencies, work: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = (deps.imap || clientFor)(account);
  // Do not emit library errors (which can contain authentication/server details).
  client.on("error", () => undefined);
  try { await client.connect(); return await work(client); }
  finally { await client.logout().catch(() => client.close()); }
}
export async function mailboxes(account: Account, deps: MailDependencies = {}): Promise<unknown> {
  return withImap(account, deps, async client => (await client.list()).map(m => ({ path: m.path, specialUse: m.specialUse })));
}
export async function searchMail(input: Record<string, unknown>, deps: MailDependencies = {}): Promise<unknown> {
  const query = String(input.query || "").trim();
  if (!query) throw new Error("Email search needs a query");
  const selected = input.account ? [getAccount(String(input.account))] : accounts();
  if (!selected.length) throw new Error("No email accounts connected. Run flyd accounts google or flyd accounts dreamhost.");
  const limit = countLimit(input.limit);
  const results = await Promise.all(selected.map(async account => {
    try {
      if (account.provider === "google") {
        const q = new URLSearchParams({ q: query, maxResults: String(limit) });
        const data = await (await googleRequest(account.id, "gmail", `threads?${q}`, {}, deps.http)).json() as { threads?: { id: string; snippet?: string }[]; nextPageToken?: string };
        return { account: account.id, email: account.email, provider: account.provider, threads: (data.threads || []).map(t => ({ id: t.id, snippet: t.snippet, source: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account.email)}#all/${t.id}` })), more: Boolean(data.nextPageToken) };
      }
      return await withImap(account, deps, async client => {
        const mailbox = String(input.mailbox || "INBOX");
        const lock = await client.getMailboxLock(mailbox, { readOnly: true });
        try {
          const validity = client.mailbox ? String(client.mailbox.uidValidity) : "";
          const found = await client.search({ text: query }, { uid: true });
          const uids = (found || []).slice(-limit).reverse();
          const messages = [];
          if (uids.length) for await (const item of client.fetch(uids, { envelope: true }, { uid: true })) {
            messages.push({ id: `${validity}:${item.uid}`, uidValidity: validity, mailbox, subject: item.envelope?.subject, date: item.envelope?.date ? new Date(item.envelope.date).toISOString() : undefined, from: item.envelope?.from, source: `imap://${encodeURIComponent(account.email)}@imap.dreamhost.com/${encodeURIComponent(mailbox)}?uid=${item.uid}&uidvalidity=${validity}` });
          }
          messages.sort((a, b) => Number(b.id.split(":")[1]) - Number(a.id.split(":")[1]));
          return { account: account.id, email: account.email, provider: account.provider, messages, more: (found || []).length > limit };
        } finally { lock.release(); }
      });
    } catch { return { account: account.id, email: account.email, provider: account.provider, error: "Email lookup failed; run flyd accounts check to diagnose the connection" }; }
  }));
  return { retrievedAt: new Date().toISOString(), querySemantics: "Gmail supports Gmail operators; DreamHost searches literal text in the selected mailbox (default INBOX).", results };
}
type Part = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[] };
export function gmailBody(part: Part): { text: string; attachments: unknown[] } {
  const plain: string[] = [], html: string[] = [], attachments: unknown[] = [];
  function walk(p: Part): void {
    if (p.filename) attachments.push({ filename: p.filename, mimeType: p.mimeType, attachmentId: p.body?.attachmentId, size: p.body?.size });
    else if (p.body?.data && p.mimeType === "text/plain") plain.push(Buffer.from(p.body.data, "base64url").toString("utf8"));
    else if (p.body?.data && p.mimeType === "text/html") html.push(Buffer.from(p.body.data, "base64url").toString("utf8"));
    p.parts?.forEach(walk);
  }
  walk(part);
  return { text: plain.join("\n") || html.join("\n").replace(/<[^>]+>/g, " "), attachments };
}
export async function readMail(input: Record<string, unknown>, deps: MailDependencies = {}): Promise<unknown> {
  const account = getAccount(String(input.account || "")), id = String(input.id || "");
  if (!id) throw new Error("Email read needs an id from email_search");
  if (account.provider === "google") {
    const data = await (await googleRequest(account.id, "gmail", `threads/${encodeURIComponent(id)}?format=full`, {}, deps.http)).json() as { messages?: { id: string; internalDate?: string; payload: Part }[] };
    let remaining = 60_000;
    const all = data.messages || [];
    const messages = all.slice(-20).map(m => {
      const body = gmailBody(m.payload);
      const content = clipped(body.text, remaining); remaining -= content.text.length;
      return { id: m.id, headers: m.payload.headers?.filter(h => /^(from|to|cc|subject|date|message-id|in-reply-to)$/i.test(h.name)), ...content, attachments: body.attachments };
    });
    return { account: account.id, email: account.email, source: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account.email)}#all/${id}`, retrievedAt: new Date().toISOString(), omittedMessages: Math.max(0, all.length - 20), messages };
  }
  const match = id.match(/^(\d+):(\d+)$/);
  if (!match) throw new Error("DreamHost message id must include UIDVALIDITY:UID from email_search");
  return withImap(account, deps, async client => {
    const mailbox = String(input.mailbox || "INBOX");
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      if (!client.mailbox || String(client.mailbox.uidValidity) !== match[1]) throw new Error("Mailbox changed; search again for a current message id");
      const metadata = await client.fetchOne(match[2], { size: true }, { uid: true });
      if (!metadata) throw new Error("Message no longer exists");
      if ((metadata.size || 0) > MAX_MESSAGE) throw new Error("Message exceeds the 5 MB read limit; open it in your email client");
      const message = await client.fetchOne(match[2], { source: true }, { uid: true });
      if (!message || !message.source) throw new Error("Message no longer exists");
      if (message.source.length > MAX_MESSAGE) throw new Error("Message exceeds the 5 MB read limit");
      const parsed = await simpleParser(message.source);
      return { account: account.id, email: account.email, id, mailbox, source: `imap://${encodeURIComponent(account.email)}@imap.dreamhost.com/${encodeURIComponent(mailbox)}?uid=${match[2]}&uidvalidity=${match[1]}`, retrievedAt: new Date().toISOString(), subject: parsed.subject, from: parsed.from?.text, to: parsed.to, date: parsed.date?.toISOString(), ...clipped(parsed.text || String(parsed.html || "").replace(/<[^>]+>/g, " ")), attachments: parsed.attachments.map(a => ({ filename: a.filename, mimeType: a.contentType, size: a.size })) };
    } finally { lock.release(); }
  });
}
function header(value: unknown, label: string): string {
  const result = String(value || "").trim();
  if (result.length > 1000 || /[\r\n\x00]/.test(result)) throw new Error(`Invalid ${label} header`);
  return result;
}
export function draftMessage(email: string, input: Record<string, unknown>, reply?: { messageId?: string; references?: string }): string {
  const to = header(input.to, "To"), subject = header(input.subject, "Subject"), body = String(input.body || "");
  if (to && !/[^\s@<>]+@[^\s@<>]+/.test(to)) throw new Error("Draft recipient must be an email address");
  if (!to || !body.trim()) throw new Error("Draft needs recipient and body");
  if (Buffer.byteLength(body) > 100_000) throw new Error("Draft body exceeds 100 KB");
  const headers = [`From: ${header(email, "From")}`, `To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"];
  if (input.cc) headers.push(`Cc: ${header(input.cc, "Cc")}`);
  if (reply?.messageId) {
    headers.push(`In-Reply-To: ${header(reply.messageId, "In-Reply-To")}`);
    headers.push(`References: ${header(`${reply.references || ""} ${reply.messageId}`, "References")}`);
  }
  return `${headers.join("\r\n")}\r\n\r\n${Buffer.from(body).toString("base64").match(/.{1,76}/g)?.join("\r\n") || ""}\r\n`;
}
export async function createDraft(input: Record<string, unknown>, deps: MailDependencies = {}): Promise<unknown> {
  const account = getAccount(String(input.account || ""));
  let reply: { messageId?: string; references?: string } | undefined;
  const threadId = String(input.thread_id || "");
  if (threadId && account.provider !== "google") throw new Error("DreamHost reply threading is not supported yet; compose a new draft");
  if (threadId) {
    const thread = await (await googleRequest(account.id, "gmail", `threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`, {}, deps.http)).json() as { messages?: { payload?: Part }[] };
    const headers = thread.messages?.at(-1)?.payload?.headers || [];
    const messageId = headers.find(h => h.name.toLowerCase() === "message-id")?.value;
    if (!messageId) throw new Error("Email reply has no Message-ID; compose a new draft instead");
    reply = { messageId, references: headers.find(h => h.name.toLowerCase() === "references")?.value };
  }
  const message = draftMessage(account.email, input, reply);
  if (account.provider === "google") {
    const data = await (await googleRequest(account.id, "gmail", "drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: { raw: Buffer.from(message).toString("base64url"), ...(threadId ? { threadId } : {}) } }) }, deps.http)).json();
    return { account: account.id, status: "draft_saved_not_sent", draft: data, source: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account.email)}#drafts` };
  }
  return withImap(account, deps, async client => {
    const boxes = await client.list();
    const draftBox = boxes.find(m => m.specialUse === "\\Drafts") || boxes.find(m => /^(INBOX[./])?Drafts$/i.test(m.path));
    const mailbox = input.mailbox ? String(input.mailbox) : draftBox?.path;
    if (!mailbox || !boxes.some(m => m.path === mailbox)) throw new Error("No Drafts mailbox found; use email_mailboxes then pass an existing draft mailbox explicitly");
    const result = await client.append(mailbox, Buffer.from(message), ["\\Draft"]);
    if (!result) throw new Error("Draft was not saved");
    return { account: account.id, status: "draft_saved_not_sent", mailbox, uid: result.uid, uidValidity: result.uidValidity?.toString() };
  });
}
