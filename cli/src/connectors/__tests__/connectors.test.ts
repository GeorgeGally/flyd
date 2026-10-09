import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ImapFlow } from "imapflow";
import { accounts, disconnectAccount, saveAccount, secret } from "../accounts.js";
import { accessToken, authUrl, clearGoogleTokens, connectGoogle, GOOGLE_SCOPES, googleRequest, type Http } from "../google.js";
import { createDraft, draftMessage, gmailBody, readMail, searchMail } from "../mail.js";
import { boundedText, createDocument, readDrive, searchDrive } from "../drive.js";
import { runPersonalTool, isMutatingToolCall } from "../../runtime/personal-tools.js";
import { classifyToolCall, marksTurnUntrusted } from "../../runtime/tool-policy.js";
import { planTurn, visibleTools } from "../../runtime/turn-plan.js";
import { connectorTools } from "../tools.js";
import { answerAccountIntent, isAccountIntent, requestedComposeTools } from "../invocation.js";
import type { agentLoopWithFailover } from "../../lib/llm.js";

let directory: string;
const previous = process.env.FLYD_CONNECTOR_DIR;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "flyd-connectors-")); process.env.FLYD_CONNECTOR_DIR = directory; clearGoogleTokens(); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); process.env.FLYD_CONNECTOR_DIR = previous; });
function google() { saveAccount({ id: "personal", provider: "google", email: "george@example.com" }, { clientId: "desktop-client", refreshToken: "private-refresh", scopes: GOOGLE_SCOPES }); }
function dreamhost() { saveAccount({ id: "work", provider: "dreamhost", email: "work@example.com" }, { password: "secret-password" }); }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
function httpMock(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url, init) => String(url).includes("oauth2.googleapis.com/token") ? json({ access_token: "private-access", expires_in: 3600 }) : handler(String(url), init)) as unknown as Http;
}
function imapMock() {
  const client = Object.assign(new EventEmitter(), {
    connect: vi.fn(async () => undefined), logout: vi.fn(async () => undefined), close: vi.fn(),
    mailbox: { uidValidity: 42n },
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    list: vi.fn(async () => [{ path: "INBOX" }, { path: "Drafts", specialUse: "\\Drafts" }]),
    search: vi.fn(async () => [1, 2]),
    fetch: vi.fn(async function* () { yield { uid: 2, envelope: { subject: "Proposal", date: new Date("2026-10-09") } }; }),
    fetchOne: vi.fn(async (_id, query) => query.source ? { source: Buffer.from("From: sender@example.com\r\nTo: work@example.com\r\nSubject: Proposal\r\nContent-Type: text/plain\r\n\r\nAgreed fee 105M") } : { size: 200 }),
    append: vi.fn(async () => ({ uid: 3, uidValidity: 42n })),
  });
  return { client, factory: () => client as unknown as ImapFlow };
}

describe("account credentials and OAuth", () => {
  it("keeps secrets separate, private and absent from tools", async () => {
    google();
    expect(statSync(join(directory, "personal.secret.json")).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(await runPersonalTool("connected_accounts", {})).not.toContain("private-refresh");
    expect(() => saveAccount({ id: "../oops", provider: "google", email: "x" }, {} as never)).toThrow("Invalid");
    disconnectAccount("personal"); expect(accounts()).toEqual([]);
    await expect(accessToken("personal", httpMock(() => json({})))).rejects.toThrow("not connected");
  });
  it("uses PKCE and loopback consent then verifies identity and saves only offline credentials", async () => {
    const calls: string[] = [];
    const http: Http = vi.fn(async url => {
      calls.push(String(url));
      return String(url).includes("/token") ? json({ access_token: "access", refresh_token: "refresh", scope: GOOGLE_SCOPES.join(" ") }) : json({ email: "george@example.com", email_verified: true });
    });
    let callback: Promise<Response> | undefined;
    await connectGoogle("personal", "client", undefined, raw => {
      const url = new URL(raw);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("state", url.searchParams.get("state")!); redirect.searchParams.set("code", "authorization-code");
      callback = fetch(redirect);
    }, http);
    await callback;
    expect(accounts()[0].email).toBe("george@example.com");
    expect(secret<any>("personal").refreshToken).toBe("refresh");
    expect(readFileSync(join(directory, "personal.secret.json"), "utf8")).not.toContain('"access"');
    expect(calls).toHaveLength(2);
    expect(new URL(authUrl("c", "http://127.0.0.1:123/callback", "s", "v")).searchParams.get("access_type")).toBe("offline");
  });
  it("coalesces refresh requests and refreshes once on 401 without leaking token responses", async () => {
    google();
    let apiCalls = 0;
    const http = httpMock(() => ++apiCalls === 1 ? json({}, 401) : json({ ok: true }));
    await Promise.all([accessToken("personal", http), accessToken("personal", http)]);
    expect(vi.mocked(http).mock.calls.filter(c => String(c[0]).includes("/token"))).toHaveLength(1);
    await googleRequest("personal", "gmail", "profile", {}, http);
    expect(apiCalls).toBe(2);
    expect(vi.mocked(http).mock.calls.filter(c => String(c[0]).includes("/token"))).toHaveLength(2);
  });
});

describe("mail retrieval and composition", () => {
  it("searches both accounts and preserves partial failures", async () => {
    google(); dreamhost();
    const mock = imapMock();
    const http = httpMock(() => json({ threads: [{ id: "thread1", snippet: "Nuanu" }] }));
    const result = await searchMail({ query: "Nuanu" }, { http, imap: mock.factory }) as any;
    expect(result.results.map((r: any) => r.account)).toEqual(["personal", "work"]);
    expect(result.results[1].messages[0].id).toBe("42:2");
    expect(mock.client.getMailboxLock).toHaveBeenCalledWith("INBOX", { readOnly: true });
    mock.client.connect.mockRejectedValueOnce(new Error("secret-password"));
    const failed = JSON.stringify(await searchMail({ query: "Nuanu" }, { http, imap: mock.factory }));
    expect(failed).toContain("lookup failed"); expect(failed).not.toContain("secret-password");
  });
  it("reads MIME content with stable UID references and refuses stale mailbox ids", async () => {
    dreamhost(); const mock = imapMock();
    const read = await readMail({ account: "work", id: "42:2" }, { imap: mock.factory }) as any;
    expect(read.text).toContain("105M"); expect(read.source).toContain("uidvalidity=42");
    await expect(readMail({ account: "work", id: "41:2" }, { imap: mock.factory })).rejects.toThrow("Mailbox changed");
    expect(mock.client.logout).toHaveBeenCalledTimes(2);
    expect(gmailBody({ mimeType: "multipart/mixed", parts: [{ mimeType: "text/plain", body: { data: Buffer.from("hello").toString("base64url") } }, { filename: "proposal.pdf", mimeType: "application/pdf", body: { attachmentId: "a" } }] })).toMatchObject({ text: "hello", attachments: [{ filename: "proposal.pdf" }] });
  });
  it("saves Gmail reply drafts with threading and never sends", async () => {
    google(); let posted: any;
    const http = httpMock((url, init) => {
      if (url.includes("threads/")) return json({ messages: [{ payload: { headers: [{ name: "Message-ID", value: "<original@example.com>" }] } }] });
      posted = JSON.parse(String(init?.body)); return json({ id: "draft1" });
    });
    const result = await createDraft({ account: "personal", to: "venue@example.com", subject: "Re: Nuanu", body: "Sounds good", thread_id: "t1" }, { http }) as any;
    expect(result.status).toBe("draft_saved_not_sent"); expect(posted.message.threadId).toBe("t1");
    expect(Buffer.from(posted.message.raw, "base64url").toString()).toContain("In-Reply-To: <original@example.com>");
    expect(vi.mocked(http).mock.calls.some(c => String(c[0]).includes("/send"))).toBe(false);
    expect(() => draftMessage("a@example.com", { to: "x\r\nBcc: hacked@example.com", body: "Hi" })).toThrow("Invalid");
  });
  it("appends a DreamHost draft with the draft flag without touching inbox flags", async () => {
    dreamhost(); const mock = imapMock();
    const result = await createDraft({ account: "work", to: "venue@example.com", subject: "Nuanu", body: "Hello" }, { imap: mock.factory }) as any;
    expect(result.status).toBe("draft_saved_not_sent");
    expect(mock.client.append).toHaveBeenCalledWith("Drafts", expect.any(Buffer), ["\\Draft"]);
    expect(mock.client.getMailboxLock).not.toHaveBeenCalled();
  });
});

describe("Drive", () => {
  it("escapes search syntax and exports native documents with source links", async () => {
    google();
    const http = httpMock(url => url.includes("export?") ? new Response("Proposal terms") : url.includes("files/f1") ? json({ id: "f1", name: "Proposal", mimeType: "application/vnd.google-apps.document", webViewLink: "https://docs.google.com/document/d/f1/edit" }) : json({ files: [{ id: "f1" }] }));
    await searchDrive({ query: "George's" }, http);
    const query = new URL(String(vi.mocked(http).mock.calls.find(c => String(c[0]).includes("files?"))![0])).searchParams.get("q");
    expect(query).toContain("George\\'s");
    const read = await readDrive({ account: "personal", id: "f1" }, http) as any;
    expect(read.text).toBe("Proposal terms"); expect(read.source).toContain("docs.google.com");
    const binary = await readDrive({ account: "personal", id: "binary" }, httpMock(() => json({ mimeType: "application/pdf" }))) as any;
    expect(binary.contentAvailable).toBe(false);
    await expect(boundedText(new Response("large"), 3)).rejects.toThrow("read limit");
  });
  it("creates one native Google Doc from supplied text", async () => {
    google();
    const http = httpMock((_url, init) => { expect(init?.method).toBe("POST"); expect(String(init?.body)).toContain("application/vnd.google-apps.document"); expect(String(init?.body)).toContain("Market plan"); return json({ id: "doc1" }); });
    expect(await createDocument({ account: "personal", title: "Market plan", body: "Our plan" }, http)).toMatchObject({ status: "document_created", source: "https://docs.google.com/document/d/doc1/edit" });
  });
});

describe("runtime and overlay", () => {
  it("treats drafts as reversible writes, account evidence as untrusted, and hides writes on answer turns", () => {
    expect(isMutatingToolCall("email_draft", {})).toBe(true);
    expect(classifyToolCall("drive_compose", {})).toBe("local");
    expect(marksTurnUntrusted("email_read")).toBe(true);
    const plan = planTurn({ route: "answer", source: "llm" });
    expect(visibleTools(connectorTools, plan).map(t => t.name)).not.toContain("email_draft");
    expect(isAccountIntent("Find the latest Nuanu email and Google Drive proposal")).toBe(true);
    expect(isAccountIntent("What am I working on?")).toBe(false);
    expect(requestedComposeTools("Read my email").size).toBe(0);
    expect(requestedComposeTools("Read email but do not compose anything").size).toBe(0);
    expect(requestedComposeTools("How do I compose an email?").size).toBe(0);
  });
  it("denies unrequested writes and holds attempted writes against retries/failover", async () => {
    const runTool = vi.fn(async () => "draft_saved_not_sent");
    const loop: typeof agentLoopWithFailover = vi.fn(async (_models, _system, _user, _tools, handler, _limit, options) => {
      expect(await handler("drive_compose", {})).toContain("not requested");
      await handler("email_draft", { account: "personal", body: "Hello" });
      expect(options?.canFailOver?.()).toBe(false);
      expect(await handler("email_draft", { account: "personal", body: "Hello" })).toContain("already attempted");
      return { answer: "Saved your draft", model: "test" };
    });
    expect(await answerAccountIntent("Draft an email", "", { loop, runTool, models: ["test"] })).toBe("Saved your draft");
    expect(runTool).toHaveBeenCalledTimes(1);
  });
});
