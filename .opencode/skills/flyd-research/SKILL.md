---
name: flyd-research
description: Use when the user asks about a topic, person, technology, or concept — especially if it may be new or outside their existing captures. Checks flyd memory first, then researches gaps via `flyd research`, stores results, and returns synthesized knowledge. Also proactively researches stale interests.
---

# Flyd Research

Grow flyd's knowledge by researching topics and storing findings as permanent captures.

## Flow: user asks about a topic

1. **Check memory** — run `flyd ask "tell me about <topic>"` to see what flyd already knows
2. **Assess** — if evidence exists and is current (<30d), return it directly
3. **Research gaps** — if evidence is thin, stale, or missing, run `flyd research "<topic>"` (this stores the result permanently). If the user needs current community discussion, market chatter, competitor signal, or "what people are saying now", use `/last30days <topic>` and ask it for the versioned agent JSON export so Rails can ingest the saved report.
4. **Return** — present the findings, noting what came from memory vs fresh research

**Example:**
```
User: what's the deal with edge computing?
Agent: Let me check what we know... [flyd ask returns thin results]
Running research... [flyd research "edge computing"]
Here's what I found: [combined memory + research summary]
```

## Proactive: stale interest research

At session start, check `flyd interests`. For any stale interest (>30d since last capture), suggest running research to refresh:

```
⚡ Interest "Rust" is stale (45d since last capture). Run research?
```

If user agrees, run `flyd research "<topic>"` for each stale interest.

## Proactive: thin coverage

At session start, run `flyd interests` to check for interests with low capture count (<5). For thin interests, suggest running research to build depth:

```
📖 Interest "PCB design" only has 2 captures. Research to deepen?
```
