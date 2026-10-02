import type { SemanticChunkRecord } from "../../onboarding/types.js";
import type { SearchResult } from "../types.js";
import {
  MAX_SEEDS,
  MAX_CONTEXT_CHUNKS,
  MAX_CONTEXT_BYTES,
  MIN_SEED_RELEVANCE,
  MIN_CONTEXT_RELEVANCE,
} from "./consts.js";
import { MAX_CANDIDATES } from "../reranking/consts.js";

export function contextLinks(source: SemanticChunkRecord, records: SemanticChunkRecord[]) {
  const links = [...(source.resource.structure?.related ?? [])];
  if (source.resource.structure) return links;
  const neighbors = records
    .filter((record) => record.resource.id === source.resource.id && record.id !== source.id)
    .sort(
      (a, b) =>
        Math.abs(a.resource.range.startByte - source.resource.range.startByte) -
          Math.abs(b.resource.range.startByte - source.resource.range.startByte) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_CONTEXT_CHUNKS)
    .map((record) => ({ id: record.id, relation: "same-file" as const }));
  return [...links, ...neighbors];
}

/**
 * Build a deduplicated one-hop exploration pool within the active publication only.
 */
export function contextCandidates(
  results: SearchResult[],
  records: SemanticChunkRecord[],
): SearchResult[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const pool = new Map<string, SearchResult>();
  for (const result of results.slice(0, MAX_SEEDS)) {
    if ((result.relevance?.score ?? 0) < MIN_SEED_RELEVANCE) continue;
    const source = byId.get(result.record.id);
    if (!source) continue;
    for (const link of contextLinks(source, records)) {
      const record = byId.get(link.id);
      if (!record || record.id === source.id || pool.has(record.id)) continue;
      if (pool.size >= MAX_CANDIDATES) break;
      pool.set(record.id, {
        rank: pool.size + 1,
        score: 0,
        vectorId: `context:${record.id}`,
        record,
      });
    }
  }
  return [...pool.values()];
}

/**
 * Select independently judged context, then let the caller judge the combined
 * evidence. Reference/proximity links grant eligibility, never relevance. No
 * recursive expansion; bytes and chunk count are bounded per primary candidate.
 */
export function expandContext(
  results: SearchResult[],
  records: SemanticChunkRecord[],
  judged: SearchResult[],
): SearchResult[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const scores = new Map(judged.map((item) => [item.record.id, item.relevance?.score ?? 0]));
  return results.map((result, index) => {
    if (index >= MAX_SEEDS || (result.relevance?.score ?? 0) < MIN_SEED_RELEVANCE) return result;
    const source = byId.get(result.record.id);
    if (!source) return result;
    const links = contextLinks(source, records)
      .filter((link) => (scores.get(link.id) ?? 0) >= MIN_CONTEXT_RELEVANCE)
      .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
    const context: NonNullable<SearchResult["context"]> = [];
    const seen = new Set([source.id]);
    let bytes = 0;
    for (const link of links) {
      if (seen.has(link.id)) continue;
      seen.add(link.id);
      const record = byId.get(link.id);
      if (!record) continue;
      const size = record.resource.range.endByte - record.resource.range.startByte;
      if (bytes + size > MAX_CONTEXT_BYTES) continue;
      context.push({
        relation: link.relation,
        basis: "basis" in link ? link.basis : undefined,
        record: { id: record.id, resource: record.resource },
      });
      bytes += size;
      if (context.length === MAX_CONTEXT_CHUNKS) break;
    }
    return context.length ? { ...result, primaryRelevance: result.relevance, context } : result;
  });
}
