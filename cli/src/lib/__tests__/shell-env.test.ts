import { describe, expect, it } from "vitest";
import { shellEnv } from "../shell-env.js";
import { decideToolCall, touchesSecret } from "../../runtime/tool-policy.js";

describe("keys stay out of the conversation", () => {
  it("gives a shell everything but credentials", () => {
    const env = shellEnv({ PATH: "/bin", HOME: "/h", OPENAI_API_KEY: "sk", GH_TOKEN: "t", FLYD_MODEL_API_KEY: "k", DB_PASSWORD: "p", NODE_ENV: "test" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", NODE_ENV: "test" });
  });

  it("refuses to read credential files or dump the environment, at every autonomy level", () => {
    for (const command of ["cat ~/.flyd/overlay/auth-token", "cat cli/.env", "printenv", "env | grep KEY", "cat ~/.ssh/id_ed25519", "ls ~/.flyd/connectors/"]) {
      expect(touchesSecret("bash", { command })).toBe(true);
      expect(decideToolCall("bash", { command }, { tainted: false }, "full").kind).toBe("deny");
    }
    expect(decideToolCall("read_file", { path: "/Users/g/.flyd/overlay/auth-token" }, { tainted: false }, "full").kind).toBe("deny");
  });

  it("leaves ordinary commands alone", () => {
    for (const command of ["npm test", "git status", "cat src/environment.ts", "NODE_ENV=test npm run build", "env FOO=1 npm test", "export PATH=/x:$PATH"]) {
      expect(touchesSecret("bash", { command })).toBe(false);
    }
  });
});
