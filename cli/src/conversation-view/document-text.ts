import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

// What a document George attached says, in words, for Flyd's turn, which takes words only.
// Plain-text formats are read as they are; Word, RTF and OpenDocument go through macOS's
// own textutil; PDFs through pdftotext when it is installed. Anything else is named only.

const PLAIN = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "htm", "log"]);
const TEXTUTIL = new Set(["doc", "docx", "rtf", "odt"]);
const READ_TIMEOUT_MS = 15_000;
/** GUI-launched processes get a minimal PATH, so the usual install places are looked in too. */
const TOOL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"];

function tool(name: string): string | null {
  const dirs = [...(process.env.PATH ?? "").split(delimiter).filter(Boolean), ...TOOL_DIRS];
  for (const dir of dirs) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

function run(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: READ_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });
}

/** The words in a saved document, or null when they can't be read here. */
export async function documentText(path: string, ext: string): Promise<string | null> {
  if (PLAIN.has(ext)) return readFileSync(path, "utf8");
  if (TEXTUTIL.has(ext)) {
    const textutil = tool("textutil");
    return textutil ? run(textutil, ["-convert", "txt", "-stdout", path]) : null;
  }
  if (ext === "pdf") {
    const pdftotext = tool("pdftotext");
    return pdftotext ? run(pdftotext, ["-layout", "-enc", "UTF-8", path, "-"]) : null;
  }
  return null;
}
