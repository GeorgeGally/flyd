import { readEffectiveKnowledge } from "./effective-knowledge.js";
import { compileContext } from "./context-compiler.js";
import { formatCompiledContext } from "./context-format.js";

/** Session-safe single flight. Unchanged knowledge makes no model/lookup call. */
export function liveKnowledgeRefresh(update: (context: string) => void, dependencies: {
  version?: () => string;
  compile?: () => Promise<string>;
} = {}): () => Promise<boolean> {
  const version = dependencies.version ?? (() => readEffectiveKnowledge().version);
  const compile = dependencies.compile ?? (async () => formatCompiledContext(await compileContext({ intent: "Current personal and work context for the next voice turn", environment: { app: "live_voice" } })));
  let seen = version();
  let active: Promise<boolean> | undefined;
  return () => {
    if (active) return active;
    const next = version();
    if (next === seen) return Promise.resolve(false);
    active = (async () => {
      const context = await compile();
      // A newer correction/erasure during compilation must be rebuilt, not labelled current.
      if (version() !== next) return false;
      update(context);
      seen = next;
      return true;
    })().finally(() => { active = undefined; });
    return active;
  };
}
