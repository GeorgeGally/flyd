import { pathToFileURL } from "url";
import { createRuntimePool } from "./runtime/database.js";
import { inspectRepository } from "./runtime/repository-inspector.js";
import { RuntimeCommandService } from "./runtime/runtime-command-service.js";
import { RevisionConflictError, PostgresTaskStore } from "./runtime/task-store.js";
import { controlWorker, defaultWorkerControlDependencies } from "./runtime/worker-controller.js";
import { deliverArchiveOutbox } from "./runtime/archive-outbox.js";

const MAX_REQUEST_BYTES = 64 * 1024;

interface RuntimeService {
  execute(value: unknown): Promise<unknown>;
}

export async function runRuntimeBridge(
  input: string,
  service: RuntimeService,
): Promise<{ output: string; exitCode: number }> {
  try {
    if (Buffer.byteLength(input, "utf8") > MAX_REQUEST_BYTES) throw new Error("Runtime command request is too large");
    const request = JSON.parse(input);
    const result = await service.execute(request);
    return {
      output: JSON.stringify({ schemaVersion: 1, ok: true, result }),
      exitCode: 0,
    };
  } catch (error) {
    const conflict = error instanceof RevisionConflictError;
    const message = error instanceof Error ? error.message : String(error);
    return {
      output: JSON.stringify({
        schemaVersion: 1,
        ok: false,
        error: {
          code: conflict ? "revision_conflict" : error instanceof SyntaxError ? "invalid_json" : "command_failed",
          message,
        },
      }),
      exitCode: 1,
    };
  }
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error("Runtime command request is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const pool = createRuntimePool();
  const store = new PostgresTaskStore(pool);
  const service = new RuntimeCommandService({
    store,
    inspectRepository,
    controlWorker: (input) => controlWorker({
      ...input,
      deps: defaultWorkerControlDependencies(store),
    }),
  });
  try {
    const response = await runRuntimeBridge(await readStandardInput(), service);
    try {
      await deliverArchiveOutbox(store);
    } catch (error) {
      process.stderr.write(`Flyd memory delivery is delayed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.stdout.write(`${response.output}\n`);
    process.exitCode = response.exitCode;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      ok: false,
      error: { code: "bridge_failed", message: error instanceof Error ? error.message : String(error) },
    })}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
