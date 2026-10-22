import { evaluatePredicates } from "../cognition/system-one/jev.js";
import { predicateThreshold, questionFor } from "../cognition/system-one/registry.js";
import { answerBody, type AnswerBody } from "./answer-form.js";

/** The two shapes worth reshaping a flat answer into; prose needs no work. */
export type AnswerForm = "diagnosis" | "comparison";

const EGRESS = { purpose: "presentation", allowedFields: ["utterance", "answer"] } as const;

/**
 * Ask Jev whether the flat answer Flyd just wrote should have had a shape.
 * Runs only after the writer declined to declare one, so the common path pays
 * nothing. Jev off, failing, unsure or saying prose all mean prose stands.
 */
export async function answerForm(
  question: string,
  answer: string,
  evaluate: typeof evaluatePredicates = evaluatePredicates,
): Promise<AnswerForm | null> {
  if (!answer.trim()) return null;
  const evaluation = await evaluate(
    { utterance: question, answer },
    [questionFor("answer_form")],
    {},
    EGRESS,
  ).catch(() => null);
  const read = evaluation?.ok ? evaluation.answers.answer_form : undefined;
  if (!read?.choice || read.probability < predicateThreshold("answer_form")) return null;
  return read.choice === "diagnosis" || read.choice === "comparison" ? read.choice : null;
}

export type Ask = (prompt: string) => Promise<string>;

const SHAPE_PROMPT: Record<AnswerForm, string> = {
  diagnosis: `Return only JSON: {"lead":"the outcome in one line","parts":[{"label":"Expected","text":"..."},{"label":"Observed","text":"..."},{"label":"Cause","text":"..."},{"label":"Evidence","text":"..."},{"label":"Next","text":"..."}],"next":"one next action or question, or omit"}`,
  comparison: `Return only JSON: {"lead":"the choice in one line","criteria":["..."],"alternatives":[{"name":"...","values":["..."]}],"next":"one next action or question, or omit"} with 2-4 criteria and 2-4 named options, each option's values in criteria order, each value at most 12 words`,
};

function json(text: string): unknown {
  const body = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * One cheap model call that keeps the answer's facts and changes only its
 * shape. A shape that does not come back whole leaves the prose untouched.
 */
export async function reshapeAnswer(
  question: string,
  answer: string,
  form: AnswerForm,
  ask: Ask,
): Promise<AnswerBody | null> {
  const prompt = [
    "Reshape an answer Flyd already gave George. Keep every fact, number, name and next step; change only the shape. Why it is shaped does not belong in it.",
    `His question: ${question.slice(0, 1_500)}`,
    `Flyd's answer: ${answer.slice(0, 6_000)}`,
    SHAPE_PROMPT[form],
    "Return only that JSON, with no markdown fence and no commentary.",
  ].join("\n\n");
  const parsed = json(await ask(prompt).catch(() => ""));
  const shaped = answerBody(parsed && typeof parsed === "object" ? { ...parsed, form } : parsed);
  return shaped.form === form ? shaped : null;
}
