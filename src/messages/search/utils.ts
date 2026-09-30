import { fileURLToPath } from "node:url";
import type { SearchReport, SearchResult } from "../../retrieval/types.js";
import { AGENT_PREVIEW_CHARACTERS } from "./consts.js";

function source(record: SearchResult["record"]) {
  const resource = record.resource;
  const preview = resource.textPreview.slice(0, AGENT_PREVIEW_CHARACTERS);
  return {
    id: record.id,
    path: resource.uri.startsWith("file:") ? fileURLToPath(resource.uri) : resource.uri,
    startLine: resource.range.startLine,
    endLine: resource.range.endLine,
    symbol: resource.structure?.label ?? resource.structure?.symbol,
    preview,
    previewTruncated: preview.length < resource.textPreview.length,
  };
}

function candidate(result: SearchResult) {
  return {
    rank: result.rank,
    ...source(result.record),
    source: result.source,
    relevance: result.relevance?.score,
    primaryRelevance: result.primaryRelevance?.score,
    context: result.context?.map((context) => ({
      ...source(context.record),
      relation: context.relation,
      basis: context.basis,
    })),
  };
}

/**
 * Project retrieval reports for agent consumption without changing ranking or
 * acceptance. Preserve bounded-coverage warnings and supporting context; clipped
 * previews retain full source ranges so callers can read the missing evidence.
 * Explain candidates remain separate from accepted results.
 */
export function agentSearchReport(report: SearchReport) {
  return {
    schemaVersion: 1,
    format: "agent",
    root: report.root,
    query: report.query,
    ranking: report.ranking,
    execution: report.execution,
    evidence: report.evidence,
    coverage: report.coverage,
    truncation: report.truncation,
    budget: report.budget,
    results: report.results.map(candidate),
    candidates: report.candidates?.map(candidate),
    judgments: report.judgments,
    findings: report.findings,
  };
}
