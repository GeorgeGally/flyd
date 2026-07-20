import {
  retrieveBrainEvidence,
  retrieveLexicalBrainEvidence,
} from "../lib/brain-retrieval.js";

export async function runSearch(query: string, opts: { deep?: boolean } = {}): Promise<void> {
  const result = opts.deep
    ? await retrieveBrainEvidence(query)
    : await retrieveLexicalBrainEvidence(query);

  if (!result.matches.length) {
    console.log("no captures found");
    return;
  }

  console.log(`## Evidence (${result.matches.length} entries)\n`);
  for (const match of result.matches) {
    const content = match.content;
    console.log(`[${content.archive}] ${content.path} (score=${content.retrievalScore}%, confidence=${Math.round(match.confidence * 100)}%)`);
    console.log(content.excerpt.slice(0, 500));
    if (content.excerpt.length > 500) console.log("...");
    console.log("");
  }
}
