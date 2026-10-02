import type { SemanticChunkRecord } from "../../onboarding/types.js";
import { scoreChunk, tokenize } from "../../lexical/utils.js";
import type { SearchResult } from "../types.js";
import type { ContextAnchor, DiscoveryOptions, DiscoveryTrace } from "./types.js";
import { DIVERSIFIED_LEXICAL_POOL_MULTIPLIER, RECIPROCAL_RANK_OFFSET } from "./consts.js";

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

function hasAnchor(hit: SearchResult) {
  return hit.discovery?.some((signal) => signal.source === "anchor") === true;
}

function groupKey(hit: SearchResult) {
  const { uri, structure } = hit.record.resource;
  const unit = structure?.unit;
  const section =
    unit?.kind === "section" ? unit : structure?.ancestors?.find((item) => item.kind === "section");
  return `${uri}:${section?.id ?? unit?.id ?? "file"}`;
}

/**
 * An opt-in bounded experiment: preserve anchors, then favor files and source
 * units with fewer selected representatives, breaking ties by discovery order.
 * Repeated sources remain eligible on later rounds; diversity is not relevance.
 */
function diversifiedShortlist(ranked: SearchResult[], limit: number): SearchResult[] {
  const selected: SearchResult[] = [];
  const files = new Map<string, number>();
  const groups = new Map<string, number>();
  const take = (hit: SearchResult) => {
    selected.push(hit);
    const file = hit.record.resource.uri;
    const group = groupKey(hit);
    files.set(file, (files.get(file) ?? 0) + 1);
    groups.set(group, (groups.get(group) ?? 0) + 1);
  };
  for (const hit of ranked.filter(hasAnchor).slice(0, limit)) take(hit);
  const remaining = ranked.filter((hit) => !hasAnchor(hit));
  while (selected.length < limit && remaining.length) {
    let best = 0;
    for (let index = 1; index < remaining.length; index++) {
      const a = remaining[index]!;
      const b = remaining[best]!;
      const fileDifference =
        (files.get(a.record.resource.uri) ?? 0) - (files.get(b.record.resource.uri) ?? 0);
      const groupDifference = (groups.get(groupKey(a)) ?? 0) - (groups.get(groupKey(b)) ?? 0);
      if (fileDifference < 0 || (fileDifference === 0 && groupDifference < 0)) best = index;
    }
    take(remaining.splice(best, 1)[0]!);
  }
  return selected;
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
  options: DiscoveryOptions = {},
) {
  const strategy = options.strategy ?? "ranked";
  const lexicalPoolLimit =
    limit * (strategy === "diversified" ? DIVERSIFIED_LEXICAL_POOL_MULTIPLIER : 1);
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
  lexical.slice(0, lexicalPoolLimit).forEach((hit, index) =>
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
  const ranked = [...candidates.values()].sort(
    (a, b) =>
      Number(b.discovery!.some((signal) => signal.source === "anchor")) -
        Number(a.discovery!.some((signal) => signal.source === "anchor")) ||
      b.score - a.score ||
      a.record.id.localeCompare(b.record.id),
  );
  const selected =
    strategy === "diversified" ? diversifiedShortlist(ranked, limit) : ranked.slice(0, limit);
  const results = selected.map((hit, index): SearchResult => ({
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
    shortlist: { strategy, poolCandidates: ranked.length, lexicalPoolLimit },
    traces: options.traceChunks?.map((id): DiscoveryTrace => {
      const rank = (index: number) => (index < 0 ? undefined : index + 1);
      return {
        id,
        semanticRank: rank(semantic.findIndex((hit) => hit.record.id === id)),
        lexicalRank: rank(lexical.findIndex((hit) => hit.record.id === id)),
        anchorRank: rank(anchored.findIndex((record) => record.id === id)),
        inPool: candidates.has(id),
        shortlisted: results.some((hit) => hit.record.id === id),
      };
    }),
  };
}
