import { randomUUID } from "node:crypto";
import type { ManifestRequest } from "../resolve.js";

export interface FixtureRule {
  contains?: string;
  equals?: string;
  respond: string;
}

export function useFixtureModel(rules: FixtureRule[], fallback?: string): void {
  process.env.FLYD_MODEL_FIXTURE = JSON.stringify(
    fallback !== undefined ? { rules, fallback } : { rules }
  );
}

export function clearFixtureModel(): void {
  delete process.env.FLYD_MODEL_FIXTURE;
}

export function editableEnvironment(): ManifestRequest["environment"] {
  return {
    application: { bundle_id: "com.apple.Mail", name: "Mail" },
    window: { title: "Compose", ref: "win_01" },
    focused_element: {
      ref: "el_01",
      role: "AXTextArea",
      description: "Message body",
      value: "",
      placeholder: "",
      selected_text: "",
    },
    selection: "",
    sufficiency: "semantic",
  };
}

export function nonEditableEnvironment(): ManifestRequest["environment"] {
  return {
    application: { bundle_id: "com.google.Chrome", name: "Chrome" },
    window: { title: "Documentation", ref: "win_02" },
    focused_element: {
      ref: "el_02",
      role: "AXStaticText",
      description: "Article body",
      value: "",
      placeholder: "",
      selected_text: "",
    },
    selection: "",
    sufficiency: "semantic",
  };
}

export function makeManifest(
  intent: string,
  overrides: Partial<ManifestRequest> = {}
): ManifestRequest {
  return {
    invocation_id: randomUUID(),
    environment_revision: 1,
    environment: editableEnvironment(),
    intent,
    modality: "text",
    invocation_fingerprint: {
      app: "com.apple.Mail",
      window: "win_01",
      element: "el_01",
    },
    ...overrides,
  };
}
