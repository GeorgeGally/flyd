import { pathToFileURL } from "url";
import { retrieveBrainEvidence } from "./lib/brain-retrieval.js";

type Retrieve = (query: string) => Promise<unknown>;
type Write = (output: string) => unknown;

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

export async function runBridge(
  args: string[],
  retrieve: Retrieve = retrieveBrainEvidence,
  write: Write = (output) => process.stdout.write(output),
): Promise<number> {
  const [command] = args;
  if (command !== "retrieve") {
    write(`${JSON.stringify({ error: "unknown_command", command: command ?? null })}\n`);
    return 2;
  }

  const query = option(args, "--query")?.trim();
  if (!query) {
    write(`${JSON.stringify({ error: "missing_query" })}\n`);
    return 2;
  }

  try {
    write(`${JSON.stringify(await retrieve(query))}\n`);
    return 0;
  } catch (error) {
    write(`${JSON.stringify({ error: "retrieval_failed", message: error instanceof Error ? error.message : String(error) })}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await runBridge(process.argv.slice(2));
}
