import {
  buildEvidenceDoctorReport,
  formatEvidenceDoctorReport,
} from "../evidence/doctor.js";

export async function runDoctor(options: { json?: boolean } = {}): Promise<void> {
  const report = await buildEvidenceDoctorReport();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${formatEvidenceDoctorReport(report)}\n`);
}
