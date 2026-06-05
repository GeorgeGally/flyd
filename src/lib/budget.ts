import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { FLYD_DIR } from "./config.js";

const BUDGET_PATH = join(FLYD_DIR, "state", "budget.json");

interface BudgetDay {
  date: string;
  tokensIn: number;
  tokensOut: number;
  estimatedCost: number;
  calls: Array<{ phase: string; tokensIn: number; tokensOut: number; cost: number; timestamp: string }>;
}

interface BudgetTracker {
  days: BudgetDay[];
  dailyCap: number;
  model: string;
}

const PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01 },
  "gpt-4-turbo": { inputPer1k: 0.01, outputPer1k: 0.03 },
  "gpt-3.5-turbo": { inputPer1k: 0.0005, outputPer1k: 0.0015 },
  "claude-3-5-sonnet": { inputPer1k: 0.003, outputPer1k: 0.015 },
  "claude-3-opus": { inputPer1k: 0.015, outputPer1k: 0.075 },
  "claude-3-haiku": { inputPer1k: 0.00025, outputPer1k: 0.00125 },
};

export function loadBudget(): BudgetTracker {
  if (!existsSync(BUDGET_PATH)) {
    return { days: [], dailyCap: 10, model: "gpt-4o-mini" };
  }
  try {
    return JSON.parse(readFileSync(BUDGET_PATH, "utf8"));
  } catch {
    return { days: [], dailyCap: 10, model: "gpt-4o-mini" };
  }
}

function saveBudget(budget: BudgetTracker): void {
  mkdirSync(join(BUDGET_PATH, ".."), { recursive: true });
  writeFileSync(BUDGET_PATH, JSON.stringify(budget, null, 2), "utf8");
}

export function estimateCost(tokensIn: number, tokensOut: number, model = "gpt-4o-mini"): number {
  const pricing = PRICING[model] ?? PRICING["gpt-4o-mini"];
  return (tokensIn / 1000) * pricing.inputPer1k + (tokensOut / 1000) * pricing.outputPer1k;
}

export function trackCall(phase: string, tokensIn: number, tokensOut: number, model?: string): void {
  const budget = loadBudget();
  const today = new Date().toISOString().split("T")[0];
  const m = model ?? budget.model;

  let dayEntry = budget.days.find((d) => d.date === today);
  if (!dayEntry) {
    dayEntry = { date: today, tokensIn: 0, tokensOut: 0, estimatedCost: 0, calls: [] };
    budget.days.push(dayEntry);
    // Keep only last 30 days
    if (budget.days.length > 30) {
      budget.days = budget.days.slice(-30);
    }
  }

  const cost = estimateCost(tokensIn, tokensOut, m);

  dayEntry.tokensIn += tokensIn;
  dayEntry.tokensOut += tokensOut;
  dayEntry.estimatedCost += cost;
  dayEntry.calls.push({
    phase,
    tokensIn,
    tokensOut,
    cost,
    timestamp: new Date().toISOString(),
  });

  saveBudget(budget);
}

export function isBudgetExceeded(): boolean {
  const budget = loadBudget();
  const today = new Date().toISOString().split("T")[0];
  const dayEntry = budget.days.find((d) => d.date === today);
  if (!dayEntry) return false;
  return dayEntry.estimatedCost >= budget.dailyCap;
}

export function getDailySpend(): { cost: number; cap: number; tokensIn: number; tokensOut: number; calls: number } {
  const budget = loadBudget();
  const today = new Date().toISOString().split("T")[0];
  const dayEntry = budget.days.find((d) => d.date === today);
  return {
    cost: dayEntry?.estimatedCost ?? 0,
    cap: budget.dailyCap,
    tokensIn: dayEntry?.tokensIn ?? 0,
    tokensOut: dayEntry?.tokensOut ?? 0,
    calls: dayEntry?.calls.length ?? 0,
  };
}

export function estimateTokens(text: string): number {
  // Rough estimate: ~1.3 tokens per word
  return Math.ceil(text.split(/\s+/).length * 1.3);
}
