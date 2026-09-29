import type { SearchResult } from "./types.js";

/**
 * Prefer direct evidence over a caller that only answers via its supporting chunk.
 */
export function orderEvidence(results: SearchResult[], threshold: number): SearchResult[] {
  const direct = (result: SearchResult) =>
    (result.primaryRelevance ?? result.relevance)?.score ?? 0;
  return [...results]
    .sort(
      (a, b) =>
        Number(direct(b) >= threshold) - Number(direct(a) >= threshold) ||
        (b.relevance?.score ?? 0) - (a.relevance?.score ?? 0) ||
        direct(b) - direct(a) ||
        b.score - a.score ||
        a.vectorId.localeCompare(b.vectorId),
    )
    .map((result, index) => ({ ...result, rank: index + 1 }));
}
