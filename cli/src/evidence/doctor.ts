import { createDefaultEvidenceRegistry } from "./default-registry.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import type {
  CapabilityName,
  CapabilityOperation,
  CapabilityStatus,
} from "./types.js";

export interface EvidenceCapabilityDiagnostic {
  capability: CapabilityName;
  operation: CapabilityOperation;
  status: CapabilityStatus;
  backend?: string;
  reason?: string;
  fix?: string;
  checkedAt: string;
}

export interface EvidenceDoctorReport {
  generatedAt: string;
  diagnostics: EvidenceCapabilityDiagnostic[];
  summary: Record<CapabilityStatus, number>;
}

function operationOrder(operation: CapabilityOperation): number {
  return operation === "read" ? 0 : 1;
}

export async function buildEvidenceDoctorReport(
  registry: CapabilityRegistry = createDefaultEvidenceRegistry(),
  now: () => Date = () => new Date(),
): Promise<EvidenceDoctorReport> {
  const requests: Array<{ capability: CapabilityName; operation: CapabilityOperation }> = [];

  for (const capability of registry.capabilities()) {
    const operations = new Set<CapabilityOperation>();
    for (const adapter of registry.adaptersFor(capability)) {
      for (const operation of adapter.operations) operations.add(operation);
    }
    for (const operation of [...operations].sort((left, right) => operationOrder(left) - operationOrder(right))) {
      requests.push({ capability, operation });
    }
  }

  const diagnostics = await Promise.all(requests.map(async ({ capability, operation }) => {
    const inspection = await registry.inspect(capability, operation);
    return {
      capability,
      operation,
      status: inspection.health.status,
      backend: inspection.health.activeBackend,
      reason: inspection.health.reason,
      fix: inspection.health.fix,
      checkedAt: inspection.health.checkedAt,
    } satisfies EvidenceCapabilityDiagnostic;
  }));

  const summary: Record<CapabilityStatus, number> = {
    ready: 0,
    degraded: 0,
    auth_required: 0,
    unavailable: 0,
    disabled: 0,
  };
  for (const diagnostic of diagnostics) summary[diagnostic.status] += 1;

  return {
    generatedAt: now().toISOString(),
    diagnostics,
    summary,
  };
}

const STATUS_MARKER: Record<CapabilityStatus, string> = {
  ready: "READY",
  degraded: "DEGRADED",
  auth_required: "AUTH",
  unavailable: "DOWN",
  disabled: "OFF",
};

export function formatEvidenceDoctorReport(report: EvidenceDoctorReport): string {
  const lines = ["Flyd evidence capabilities", ""];
  for (const entry of report.diagnostics) {
    const target = `${entry.capability}.${entry.operation}`.padEnd(18);
    const backend = entry.backend ? ` via ${entry.backend}` : "";
    lines.push(`${STATUS_MARKER[entry.status].padEnd(8)} ${target}${backend}`);
    if (entry.reason) lines.push(`         ${entry.reason}`);
    if (entry.fix) lines.push(`         fix: ${entry.fix}`);
  }
  lines.push("");
  lines.push(
    `ready ${report.summary.ready} · degraded ${report.summary.degraded} · auth ${report.summary.auth_required} · unavailable ${report.summary.unavailable}`,
  );
  return lines.join("\n");
}
