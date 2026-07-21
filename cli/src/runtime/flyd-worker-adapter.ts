import { fileURLToPath } from "url";
import {
  runJsonWorkerProcess,
  type WorkerAdapter,
  type WorkerEvent,
  type WorkerSpawn,
} from "./worker-adapter.js";
import type { FlydWorkerConfig } from "./flyd-worker-config.js";

const FLYD_CAPABILITIES = [ "analysis", "implementation", "review", "testing", "resume" ] as const;

export function parseFlydWorkerEvent(line: string): WorkerEvent | null {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (typeof event.type !== "string") return null;
    return {
      type: event.type,
      sessionId: typeof event.sessionId === "string" ? event.sessionId : null,
      text: typeof event.text === "string" ? event.text : null,
    };
  } catch {
    return null;
  }
}

function defaultWorkerScript(): { path: string; nodeArgs: string[] } {
  const currentPath = fileURLToPath(import.meta.url);
  if (currentPath.endsWith(".ts")) {
    return {
      path: fileURLToPath(new URL("./flyd-worker-process.ts", import.meta.url)),
      nodeArgs: [ "--import", "tsx" ],
    };
  }
  return {
    path: fileURLToPath(new URL("./flyd-worker-process.js", import.meta.url)),
    nodeArgs: [],
  };
}

export function createFlydWorkerAdapter(input: {
  config: FlydWorkerConfig;
  fallbackConfigs?: FlydWorkerConfig[];
  sessionRoot: string;
  workerScriptPath?: string;
  fileOperations?: string[];
  commandClasses?: string[];
  repositoryRoots?: string[];
  spawn?: WorkerSpawn;
}): WorkerAdapter {
  const script = input.workerScriptPath
    ? { path: input.workerScriptPath, nodeArgs: [] }
    : defaultWorkerScript();
  return {
    name: "flyd",
    capabilities: [ ...FLYD_CAPABILITIES ],
    async detect() {
      return {
        name: "flyd",
        executable: process.execPath,
        version: "native-1",
        healthy: true,
        capabilities: [ ...FLYD_CAPABILITIES ],
      };
    },
    buildArgs(command) {
      const args = [
        ...script.nodeArgs,
        script.path,
        "--assignment-base64", Buffer.from(command.assignment).toString("base64url"),
        "--project-root", command.projectRoot,
        "--task-key", command.taskKey,
      ];
      if (command.contextPath) args.push("--context-path", command.contextPath);
      args.push("--session-root", input.sessionRoot);
      if (command.externalSessionId) args.push("--session", command.externalSessionId);
      if (command.readOnly) args.push("--read-only", "true");
      return args;
    },
    parseEvent: parseFlydWorkerEvent,
    run: (runInput) => runJsonWorkerProcess({
      ...runInput,
      spawn: input.spawn,
      label: "Flyd worker",
      parseEvent: parseFlydWorkerEvent,
      extraEnvironment: {
        FLYD_WORKER_API_KEY: input.config.apiKey,
        FLYD_WORKER_MODEL: input.config.model,
        FLYD_WORKER_BASE_URL: input.config.baseURL,
        FLYD_WORKER_FALLBACK_PROVIDERS: JSON.stringify(input.fallbackConfigs ?? []),
        FLYD_WORKER_FILE_OPERATIONS: JSON.stringify(input.fileOperations ?? [ "read", "write" ]),
        FLYD_WORKER_COMMAND_CLASSES: JSON.stringify(input.commandClasses ?? [
          "inspect", "test", "lint", "build", "git_status", "git_diff",
        ]),
        FLYD_WORKER_REPOSITORY_ROOTS: JSON.stringify(input.repositoryRoots ?? []),
      },
    }),
  };
}
