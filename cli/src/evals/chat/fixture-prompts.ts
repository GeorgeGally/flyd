import cases from "./cases.json" with { type: "json" };

export const FIXTURE_PROMPTS = [
  ...cases.map(({ id, ask }) => ({ id, prompt: ask })),
  ...[
    "fix the GNM checkout bug", "tidy the hero spacing", "the good neighbours market hero is too tall",
    "Christmas Nuanu map", 'He prefers "calm" UI', "Map", "look at this",
    "Read what George attached and act on it",
  ].map((prompt) => ({ id: `observed: ${prompt}`, prompt })),
];
