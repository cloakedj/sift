import type { SemanticChunkRecord } from "../../onboarding/types.js";
import { scoreChunk, tokenize } from "../../lexical/utils.js";
import type { SearchResult } from "../types.js";
import type { ContextAnchor } from "./types.js";
import { RECIPROCAL_RANK_OFFSET } from "./consts.js";

function matchesAnchor(record: SemanticChunkRecord, anchor: ContextAnchor): boolean {
  if (anchor.kind === "literal")
    return (
      record.resource.textPreview.includes(anchor.value) ||
      (record.resource.structure?.label ?? record.resource.structure?.symbol ?? "").includes(
        anchor.value,
      )
    );
  return (
    record.resource.uri === anchor.uri &&
    (anchor.line === undefined ||
      (record.resource.range.startLine <= anchor.line &&
        record.resource.range.endLine >= anchor.line))
  );
}

/**
 * Discover only within the already validated publication. Reuse literal/token
 * scoring without a second index or live-corpus fallback. Exact anchors take
 * priority; remaining candidates use reciprocal ranks, never summed raw vector
 * and lexical scores. Discovery signals explain selection, not evidence strength.
 */
export function discoverCandidates(
  query: string,
  records: SemanticChunkRecord[],
  semantic: SearchResult[],
  limit: number,
  anchors: readonly ContextAnchor[] = [],
) {
  const terms = tokenize(query);
  const lexical = records
    .map((record) => {
      const text = record.resource.textPreview;
      const path = record.resource.uri;
      return {
        record,
        score: scoreChunk({ text, path, terms: tokenize(`${path}\n${text}`) }, query, terms),
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
  const anchored = records
    .filter((record) => anchors.some((anchor) => matchesAnchor(record, anchor)))
    .sort(
      (a, b) =>
        a.resource.uri.localeCompare(b.resource.uri) ||
        a.resource.range.startByte - b.resource.range.startByte ||
        a.id.localeCompare(b.id),
    );
  const candidates = new Map<string, SearchResult>();
  const add = (
    hit: SearchResult,
    source: "semantic" | "lexical" | "anchor",
    rank: number,
    score?: number,
  ) => {
    let result = candidates.get(hit.record.id);
    if (!result) {
      result = { ...hit, score: 0, discovery: [] };
      candidates.set(hit.record.id, result);
    }
    result.discovery!.push({ source, rank, score });
    result.score += 1 / (RECIPROCAL_RANK_OFFSET + rank);
  };
  semantic.forEach((hit, index) => add(hit, "semantic", index + 1, hit.score));
  lexical.slice(0, limit).forEach((hit, index) =>
    add(
      {
        record: hit.record,
        vectorId: `lexical:${hit.record.id}`,
        score: hit.score,
        rank: index + 1,
      },
      "lexical",
      index + 1,
      hit.score,
    ),
  );
  anchored
    .slice(0, limit)
    .forEach((record, index) =>
      add(
        { record, vectorId: `anchor:${record.id}`, score: 0, rank: index + 1 },
        "anchor",
        index + 1,
      ),
    );
  const results = [...candidates.values()]
    .sort(
      (a, b) =>
        Number(b.discovery!.some((signal) => signal.source === "anchor")) -
          Number(a.discovery!.some((signal) => signal.source === "anchor")) ||
        b.score - a.score ||
        a.record.id.localeCompare(b.record.id),
    )
    .slice(0, limit)
    .map((hit, index): SearchResult => ({
      ...hit,
      rank: index + 1,
      source: hit.discovery!.some((signal) => signal.source === "anchor")
        ? "anchor"
        : hit.discovery!.length > 1
          ? "hybrid"
          : hit.discovery![0]!.source,
    }));
  const discovered = new Set([
    ...semantic.map((hit) => hit.record.id),
    ...lexical.map((hit) => hit.record.id),
    ...anchored.map((record) => record.id),
  ]).size;
  return {
    results,
    discovered,
    omitted: discovered - results.length,
    anchorMatches: anchored.length,
  };
}
