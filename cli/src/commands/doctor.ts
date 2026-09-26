import {
  buildEvidenceDoctorReport,
  formatEvidenceDoctorReport,
} from "../evidence/doctor.js";
import { chatModelChain } from "../lib/config.js";
import { probeChatModel, type ModelProbe } from "../lib/llm.js";

async function probeChatModels(): Promise<ModelProbe[]> {
  let chain: string[];
  try {
    chain = chatModelChain();
  } catch (error) {
    return [{ model: "(none)", provider: "unconfigured", ok: false, latencyMs: 0, error: error instanceof Error ? error.message : String(error) }];
  }
  return Promise.all(chain.map((model) => probeChatModel(model)));
}

export function formatChatModelReport(probes: ModelProbe[]): string {
  const lines = ["Chat models (in failover order)"];
  probes.forEach((probe, index) => {
    const role = index === 0 ? "primary " : "fallback";
    const status = probe.ok ? `ok ${probe.latencyMs}ms` : `FAIL ${probe.error ?? "unknown error"}`;
    lines.push(`  ${role}  ${probe.model}  (${probe.provider})  ${status}`);
  });
  if (probes.length > 0 && !probes.some((probe) => probe.ok)) {
    lines.push("  No chat model is answering — Flyd chat cannot respond until one recovers.");
  } else if (probes[0] && !probes[0].ok) {
    lines.push("  Primary is down; chat will fail over automatically.");
  }
  return lines.join("\n");
}

export async function runDoctor(options: { json?: boolean } = {}): Promise<void> {
  const [report, chatModels] = await Promise.all([buildEvidenceDoctorReport(), probeChatModels()]);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...report, chatModels }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${formatChatModelReport(chatModels)}\n\n${formatEvidenceDoctorReport(report)}\n`);
}
