import { accounts, getAccount } from "./accounts.js";
import { googleRequest, type Http } from "./google.js";
import { clipped, countLimit } from "./mail.js";

export async function boundedText(response: Response, maxBytes = 1024 * 1024): Promise<string> {
  if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new Error("Document exceeds the 1 MB read limit"); }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error("Document exceeds the 1 MB read limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function searchDrive(input: Record<string, unknown>, http?: Http): Promise<unknown> {
  const query = String(input.query || "").trim();
  if (!query) throw new Error("Drive search needs a query");
  const selected = input.account ? [getAccount(String(input.account))] : accounts().filter(a => a.provider === "google");
  if (!selected.length) throw new Error("No Google accounts connected. Run flyd accounts google.");
  const escaped = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const results = await Promise.all(selected.map(async account => {
    if (account.provider !== "google") throw new Error("Drive needs a Google account");
    try {
      const q = new URLSearchParams({ q: `trashed = false and (fullText contains '${escaped}')`, pageSize: String(countLimit(input.limit)), fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,description)", orderBy: "modifiedTime desc", includeItemsFromAllDrives: "true", supportsAllDrives: "true" });
      const data = await (await googleRequest(account.id, "drive", `files?${q}`, {}, http)).json() as { files?: unknown[]; nextPageToken?: string };
      return { account: account.id, email: account.email, files: data.files || [], more: Boolean(data.nextPageToken) };
    } catch { return { account: account.id, email: account.email, error: "Drive lookup failed; run flyd accounts check to diagnose the connection" }; }
  }));
  return { retrievedAt: new Date().toISOString(), results };
}
export async function readDrive(input: Record<string, unknown>, http?: Http): Promise<unknown> {
  const account = getAccount(String(input.account || ""));
  if (account.provider !== "google") throw new Error("Drive needs a Google account");
  const id = String(input.id || ""); if (!id) throw new Error("Drive read needs a file id");
  const path = `files/${encodeURIComponent(id)}`;
  const metadata = await (await googleRequest(account.id, "drive", `${path}?fields=id,name,mimeType,size,modifiedTime,webViewLink,description&supportsAllDrives=true`, {}, http)).json() as Record<string, any>;
  const formats: Record<string, string> = { "application/vnd.google-apps.document": "text/plain", "application/vnd.google-apps.spreadsheet": "text/csv", "application/vnd.google-apps.presentation": "text/plain" };
  const exportType = formats[metadata.mimeType];
  const result = { account: account.id, email: account.email, metadata, source: metadata.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`, retrievedAt: new Date().toISOString() };
  if (!exportType && !/^text\//.test(metadata.mimeType) && !["application/json", "application/xml"].includes(metadata.mimeType)) return { ...result, contentAvailable: false, reason: "Binary file: text extraction is not supported yet. Open the source link." };
  if (Number(metadata.size) > 1024 * 1024) throw new Error("Document exceeds the 1 MB read limit");
  const response = await googleRequest(account.id, "drive", exportType ? `${path}/export?mimeType=${encodeURIComponent(exportType)}` : `${path}?alt=media&supportsAllDrives=true`, {}, http);
  return { ...result, contentAvailable: true, ...(metadata.mimeType === "application/vnd.google-apps.spreadsheet" ? { coverage: "CSV export covers the first sheet only; other tabs are not included." } : {}), ...clipped(await boundedText(response), 60_000) };
}
export async function createDocument(input: Record<string, unknown>, http?: Http): Promise<unknown> {
  const account = getAccount(String(input.account || ""));
  if (account.provider !== "google") throw new Error("Google Docs needs a Google account");
  const title = String(input.title || "").trim(), body = String(input.body || "");
  if (!title || !body.trim()) throw new Error("Document needs title and body");
  if (Buffer.byteLength(body) > 100_000) throw new Error("Document exceeds the 100 KB compose limit");
  // Drive converts the uploaded plain-text content to a native Google Doc; drive.file is sufficient.
  const boundary = "flyd_document_boundary_" + crypto.randomUUID();
  const metadata = JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.document" });
  const payload = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}\r\n--${boundary}--\r\n`;
  // Upload endpoint is separate from drive/v3; use the same scoped credential helper.
  const { accessToken } = await import("./google.js");
  const response = await (http || fetch)("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", { method: "POST", headers: { Authorization: `Bearer ${await accessToken(account.id, http)}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body: payload, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Google document creation failed (${response.status})`);
  const document = await response.json() as { id: string; webViewLink?: string };
  return { account: account.id, status: "document_created", document, source: document.webViewLink || `https://docs.google.com/document/d/${document.id}/edit` };
}
