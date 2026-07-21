import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { resolve } from "path";
import OpenAI from "openai";
import { runFlydWorkerLoop, type FlydCompletionClient } from "./flyd-worker-loop.js";
import { createFlydWorkerTools } from "./flyd-worker-tools.js";
import type { FlydWorkerConfig } from "./flyd-worker-config.js";

function argumentsMap(argv: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid worker argument: ${key ?? "missing"}`);
    values.set(key.slice(2), value);
  }
  return values;
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function jsonArrayEnvironment(key: string): string[] {
  try {
    const value = JSON.parse(process.env[key] ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    throw new Error(`${key} must be a JSON string array`);
  }
}

function assignmentURLs(assignment: string): string[] {
  return assignment.match(/https:\/\/[^\s)\]}>'"]+/g) ?? [];
}

interface CompletionResponse {
  choices: Array<{ message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  } }>;
}

type CompletionRequest = (
  config: FlydWorkerConfig,
  input: Parameters<FlydCompletionClient["complete"]>[0],
) => Promise<CompletionResponse>;

function fallbackProviders(): FlydWorkerConfig[] {
  try {
    const parsed = JSON.parse(process.env.FLYD_WORKER_FALLBACK_PROVIDERS ?? "[]") as unknown;
    if (!Array.isArray(parsed)) throw new Error();
    return parsed.map((entry) => {
      if (!entry || typeof entry !== "object") throw new Error();
      const value = entry as Record<string, unknown>;
      if ([ value.apiKey, value.model, value.baseURL, value.providerIdentity ].some((item) => typeof item !== "string" || !item)) {
        throw new Error();
      }
      return value as unknown as FlydWorkerConfig;
    });
  } catch {
    throw new Error("FLYD_WORKER_FALLBACK_PROVIDERS must contain valid provider configurations");
  }
}

export function completionClient(
  configs: FlydWorkerConfig[],
  onFallback: (providerIdentity: string) => void = () => undefined,
  request?: CompletionRequest,
): FlydCompletionClient {
  const clients = new Map<string, OpenAI>();
  const performRequest: CompletionRequest = request ?? (async (config, input) => {
    let client = clients.get(config.providerIdentity);
    if (!client) {
      client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
      clients.set(config.providerIdentity, client);
    }
    return client.chat.completions.create({
      model: config.model,
      messages: input.messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: input.tools as OpenAI.Chat.Completions.ChatCompletionTool[],
      tool_choice: "auto",
      temperature: 0.2,
    }) as unknown as CompletionResponse;
  });
  let activeProvider = 0;

  return {
    async complete(input) {
      const failures: string[] = [];
      for (let index = activeProvider; index < configs.length; index += 1) {
        const config = configs[index];
        try {
          const response = await performRequest(config, input);
          const message = response.choices[0]?.message;
          if (!message) throw new Error("returned no message");
          if (index !== activeProvider) onFallback(config.providerIdentity);
          activeProvider = index;
          return {
            content: typeof message.content === "string" ? message.content : null,
            toolCalls: (message.tool_calls ?? []).flatMap((call) => {
              if (call.type !== "function") return [];
              let args: Record<string, unknown>;
              try {
                args = JSON.parse(call.function.arguments) as Record<string, unknown>;
              } catch {
                args = {};
              }
              return [{ id: call.id, name: call.function.name, arguments: args }];
            }),
          };
        } catch {
          failures.push(config.providerIdentity);
          if (index === configs.length - 1) {
            throw new Error(`Flyd coding model request failed for ${failures.join(" and ")}`);
          }
        }
      }
      throw new Error("Flyd coding model has no available provider");
    },
  };
}

export function createFlydTextGenerator(
  configs: FlydWorkerConfig[],
  onFallback: (providerIdentity: string) => void = () => undefined,
): (prompt: string) => Promise<string> {
  const client = completionClient(configs, onFallback);
  return async (prompt) => {
    const completion = await client.complete({ messages: [ { role: "user", content: prompt } ], tools: [] });
    const content = completion.content?.trim();
    if (!content || completion.toolCalls.length > 0) throw new Error("Flyd planning model returned an invalid response");
    return content;
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const values = argumentsMap(argv);
  const assignment = Buffer.from(required(values, "assignment-base64"), "base64url").toString("utf8");
  const projectRoot = required(values, "project-root");
  const taskKey = required(values, "task-key");
  const sessionRoot = required(values, "session-root");
  const sessionId = values.get("session");
  const requestedReadOnly = values.get("read-only") === "true";
  const apiKey = required(new Map([
    [ "api-key", process.env.FLYD_WORKER_API_KEY ?? "" ],
  ]), "api-key");
  const model = required(new Map([
    [ "model", process.env.FLYD_WORKER_MODEL ?? "" ],
  ]), "model");
  const baseURL = required(new Map([
    [ "base-url", process.env.FLYD_WORKER_BASE_URL ?? "" ],
  ]), "base-url");
  const providerIdentity = `${new URL(baseURL).host}/${model}`;
  const providers = [ { apiKey, model, baseURL, providerIdentity }, ...fallbackProviders() ];
  const contextPath = values.get("context-path");
  const context = contextPath ? (await readFile(contextPath, "utf8")).slice(0, 256 * 1024) : undefined;
  const grantedFileOperations = jsonArrayEnvironment("FLYD_WORKER_FILE_OPERATIONS");
  const readOnly = requestedReadOnly || !grantedFileOperations.includes("write");
  const tools = createFlydWorkerTools({
    projectRoot,
    repositoryRoots: jsonArrayEnvironment("FLYD_WORKER_REPOSITORY_ROOTS"),
    writableRepositoryRoots: readOnly ? [] : [ projectRoot ],
    fileOperations: readOnly ? grantedFileOperations.filter((operation) => operation !== "write") : grantedFileOperations,
    commandClasses: jsonArrayEnvironment("FLYD_WORKER_COMMAND_CLASSES"),
    allowedNetworkUrls: assignmentURLs(assignment),
  });
  await runFlydWorkerLoop({
    assignment,
    taskKey,
    projectRoot,
    sessionRoot,
    context,
    sessionId,
    resume: Boolean(sessionId),
    client: completionClient(providers, (identity) => {
      process.stdout.write(`${JSON.stringify({ type: "provider.fallback", sessionId: sessionId ?? null, text: identity })}\n`);
    }),
    tools,
    emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
