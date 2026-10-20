import type { EpisodeNode } from "./types.js";

function rawCover(total: number, alpha: number): Array<[number, number]> {
  let root = 1;
  while (root < total) root *= 2;
  const out: Array<[number, number]> = [];
  const stack: Array<[number, number]> = [[0, root]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (lo >= total) continue;
    const size = hi - lo;
    if (size > 1 && (hi > total || size > alpha * (total - lo))) {
      const mid = (lo + hi) / 2;
      stack.push([mid, hi], [lo, mid]);
    } else {
      out.push([lo, Math.min(hi, total)]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** OptMem-style temporal cover: coarse in the distant past, fine near now. */
export function episodeCoverRanges(totalLeaves: number, budget: number): Array<[number, number]> {
  if (totalLeaves <= 0 || budget <= 0) return [];
  if (totalLeaves <= budget) return Array.from({ length: totalLeaves }, (_, i) => [i, i + 1] as [number, number]);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (rawCover(totalLeaves, mid).length > budget) lo = mid;
    else hi = mid;
  }
  return rawCover(totalLeaves, hi).slice(-budget);
}

export function selectEpisodeCover(nodes: EpisodeNode[], budget = 12): EpisodeNode[] {
  const leaves = nodes.filter((n) => n.level === 0).sort((a, b) => a.leafStart - b.leafStart);
  const ranges = episodeCoverRanges(leaves.length, Math.max(1, Math.floor(budget)));
  const byRange = new Map(nodes.map((n) => [`${n.leafStart}:${n.leafEnd}`, n]));
  return ranges.flatMap(([lo, hi]) => {
    const exact = byRange.get(`${lo}:${hi}`);
    if (exact) return [exact];
    // Partial tail ranges are not always a materialized power-of-two node.
    return leaves.filter((n) => n.leafStart >= lo && n.leafEnd <= hi);
  });
}
