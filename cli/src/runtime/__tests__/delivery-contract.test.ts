import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELIVERY_CONTRACT,
  authorizesRuntimeIntegration,
  deliveryContractForTaskIntent,
  deliveryContractOf,
  parseDeliveryContract,
} from "../delivery-contract.js";
import type { AgentTask } from "../types.js";

function task(contextSnapshot: Record<string, unknown>): Pick<AgentTask, "contextSnapshot"> {
  return { contextSnapshot };
}

describe("delivery contract", () => {
  it("parses a well-formed contract from the task context", () => {
    expect(parseDeliveryContract({ mode: "integrate", mergeAuthority: "runtime" })).toEqual(DEFAULT_DELIVERY_CONTRACT);
    expect(parseDeliveryContract({ mode: "review", mergeAuthority: "user" })).toEqual({ mode: "review", mergeAuthority: "user" });
    expect(deliveryContractOf(task({ delivery: { mode: "integrate", mergeAuthority: "runtime" } }))).toEqual(DEFAULT_DELIVERY_CONTRACT);
  });

  it("returns null for a missing or ambiguous contract so callers fail closed", () => {
    expect(deliveryContractOf(task({}))).toBeNull();
    expect(parseDeliveryContract(null)).toBeNull();
    expect(parseDeliveryContract({ mode: "integrate" })).toBeNull();
    expect(parseDeliveryContract({ mergeAuthority: "runtime" })).toBeNull();
    expect(parseDeliveryContract({ mode: "auto", mergeAuthority: "runtime" })).toBeNull();
    expect(parseDeliveryContract({ mode: "integrate", mergeAuthority: "everyone" })).toBeNull();
    expect(parseDeliveryContract("integrate")).toBeNull();
  });

  it("derives the explicit contract for tasks born from a user utterance", () => {
    expect(deliveryContractForTaskIntent("ship")).toEqual({ mode: "integrate", mergeAuthority: "runtime" });
    expect(deliveryContractForTaskIntent("scout")).toEqual({ mode: "review", mergeAuthority: "user" });
  });

  it("authorizes runtime integration only for integrate-by-runtime contracts", () => {
    expect(authorizesRuntimeIntegration(DEFAULT_DELIVERY_CONTRACT)).toBe(true);
    expect(authorizesRuntimeIntegration({ mode: "review", mergeAuthority: "user" })).toBe(false);
    expect(authorizesRuntimeIntegration({ mode: "integrate", mergeAuthority: "user" })).toBe(false);
    expect(authorizesRuntimeIntegration(null)).toBe(false);
  });
});