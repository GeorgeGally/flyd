import * as readline from "readline";
import { getAllItems, getItemCounts } from "../lib/review-store.js";
import { type ReviewItem } from "../lib/review-scheduler.js";

function rl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function askQuestion(query: string): Promise<string> {
  const line = rl();
  return new Promise(resolve => {
    line.question(query, answer => {
      line.close();
      resolve(answer.trim());
    });
  });
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function extractClues(answer: string): string[] {
  const words = answer.split(/\s+/).filter(w => w.length > 3);
  if (words.length <= 2) return words;
  const count = Math.max(1, Math.floor(words.length * 0.3));
  return shuffle(words).slice(0, count);
}

function buildClozeText(answer: string): string {
  const words = answer.split(/\s+/);
  const hidden = new Set<number>();
  const wordsToHide = words.filter(w => w.length > 3).length;
  if (wordsToHide === 0) return answer;

  const hideCount = Math.max(1, Math.floor(wordsToHide * 0.4));
  const candidates = words
    .map((w, i) => ({ word: w, idx: i }))
    .filter(({ word }) => word.length > 3);

  for (const { idx } of shuffle(candidates).slice(0, hideCount)) {
    hidden.add(idx);
  }

  return words.map((w, i) => (hidden.has(i) ? "____" : w)).join(" ");
}

export async function runQuiz(opts: { limit?: number; mode?: "qa" | "cloze" } = {}): Promise<void> {
  const counts = getItemCounts();
  if (counts.total === 0) {
    console.log("No review items available. Run 'flyd review --generate' first.");
    return;
  }

  const allItems = getAllItems();
  const questions = shuffle(allItems).slice(0, opts.limit ?? Math.min(10, allItems.length));
  const mode = opts.mode ?? "qa";

  console.log(`Quiz: ${questions.length} questions (${mode} mode)\n`);

  let correct = 0;
  let total = 0;

  for (let i = 0; i < questions.length; i++) {
    const item = questions[i];
    total++;

    console.log(`${"=".repeat(60)}`);
    console.log(`[${i + 1}/${questions.length}] ${item.sourceType}:${item.sourcePath}`);

    if (mode === "cloze") {
      const cloze = buildClozeText(item.answer);
      console.log(`\n${item.question}`);
      console.log(`\nFill in the blanks: \n${cloze}`);
    } else {
      console.log(`\nQ: ${item.question}`);
    }

    const userAnswer = await askQuestion("\nYour answer (or '?' to reveal, Enter to skip): ");

    if (userAnswer === "?") {
      console.log(`\nA: ${item.answer}`);
    } else if (!userAnswer) {
      console.log(`\nA: ${item.answer}`);
    } else {
      const revealed = item.answer.toLowerCase();
      const given = userAnswer.toLowerCase();
      const isCorrect = revealed.includes(given) || given.includes(revealed);
      console.log(`\nA: ${item.answer}`);
      if (isCorrect) {
        console.log("Correct!");
        correct++;
      } else {
        console.log("Not quite — study the answer above.");
      }
    }

    if (mode === "cloze") {
      const clues = extractClues(item.answer);
      if (clues.length > 0) {
        console.log(`Clues: ${clues.join(", ")}`);
      }
    }

    console.log();
  }

  if (total > 0) {
    const pct = Math.round((correct / total) * 100);
    console.log(`Score: ${correct}/${total} (${pct}%)`);
  }

  console.log("Quiz complete.");
}
