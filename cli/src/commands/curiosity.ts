import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { WIKI_DIR } from "../lib/config.js";
import { computeAttention, loadCaptureDocs } from "../lib/attention.js";
import { loadGoals, computeTension } from "../lib/tension.js";
import {
  generateQuestions,
  investigateQuestion,
  getRelevantDocsForQuestion,
  writeCuriosityLog,
  type CuriosityQuestion,
} from "../lib/curiosity.js";

export async function runCuriosity(): Promise<void> {
  console.log("Scanning system state...");

  const docs = loadCaptureDocs();
  const attention = computeAttention(docs);
  const goals = loadGoals();
  const tension = loadGoals().length > 0 ? computeTension(goals, docs) : [];

  console.log(`  ${attention.length} attention signals`);
  console.log(`  ${goals.length} goals`);
  console.log("");

  console.log("Generating questions...");
  const questionTexts = await generateQuestions(attention, tension);

  if (!questionTexts.length) {
    console.log("No questions generated — not enough signal");
    return;
  }

  console.log(`  ${questionTexts.length} questions generated`);
  console.log("");

  const questions: CuriosityQuestion[] = [];
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  for (let i = 0; i < questionTexts.length; i++) {
    const qText = questionTexts[i];
    const qId = `q-${Date.now()}-${i}`;

    console.log(`Q${i + 1}: ${qText}`);
    console.log("  investigating...");

    const relevantDocs = getRelevantDocsForQuestion(qText, docs);
    console.log(`  ${relevantDocs.length} relevant documents found`);

    if (relevantDocs.length > 0) {
      const investigation = await investigateQuestion(qText, relevantDocs);
      console.log(`  findings: ${investigation.findings.slice(0, 120)}...`);

      if (investigation.insight) {
        console.log(`  insight: ${investigation.insight}`);
      }
      if (investigation.missingEvidence) {
        console.log(`  missing: ${investigation.missingEvidence}`);
      }

      questions.push({
        id: qId,
        question: qText,
        generatedAt: now,
        source: "attention",
        investigated: true,
        findings: investigation.findings,
        missingEvidence: investigation.missingEvidence ?? undefined,
        relevantPages: relevantDocs.map((d) => d.path),
      });
    } else {
      console.log("  no relevant documents — skipped");
      questions.push({
        id: qId,
        question: qText,
        generatedAt: now,
        source: "attention",
        investigated: false,
      });
    }

    console.log("");
  }

  // Write curiosity log
  if (existsSync(WIKI_DIR)) {
    writeCuriosityLog(questions);
    console.log("Curiosity log written to wiki/curiosity-log.md");
  }
}
