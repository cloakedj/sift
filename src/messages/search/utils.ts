import { fileURLToPath } from "node:url";
import type { SearchReport, SearchResult } from "../../retrieval/types.js";
import { AGENT_PREVIEW_CHARACTERS } from "./consts.js";

/**
 * Number an exact source prefix, not a summary. The budget counts source UTF-16
 * units before numbering; never split a surrogate pair or CRLF at the cutoff.
 * Byte ranges are half-open and line ranges inclusive. Chunks can themselves
 * begin/end mid-line, so numbered lines are source fragments, not whole-line claims.
 */
function source(record: SearchResult["record"]) {
  const resource = record.resource;
  const text = resource.textPreview;
  let end = Math.min(text.length, AGENT_PREVIEW_CHARACTERS);
  if (end < text.length) {
    const previous = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (
      (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) ||
      (text[end - 1] === "\r" && text[end] === "\n")
    )
      end--;
  }
  const excerpt = text.slice(0, end);
  const lines = excerpt.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const previewTruncated = end < text.length;
  const preview = lines
    .map((line, index) => `${resource.range.startLine + index} | ${line}`)
    .join("");
  return {
    id: record.id,
    path: resource.uri.startsWith("file:") ? fileURLToPath(resource.uri) : resource.uri,
    startLine: resource.range.startLine,
    endLine: resource.range.endLine,
    startByte: resource.range.startByte,
    endByte: resource.range.endByte,
    symbol: resource.structure?.label ?? resource.structure?.symbol,
    preview,
    previewRange: excerpt.length
      ? {
          startLine: resource.range.startLine,
          endLine: resource.range.startLine + lines.length - 1,
          startByte: resource.range.startByte,
          endByte: resource.range.startByte + Buffer.byteLength(excerpt, "utf8"),
        }
      : null,
    previewTruncated,
    previewClippedMidLine: previewTruncated && !excerpt.endsWith("\n"),
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
    schemaVersion: 2,
    format: "agent",
    root: report.root,
    query: report.query,
    ranking: report.ranking,
    execution: report.execution,
    evidence: report.evidence,
    coverage: report.coverage,
    truncation: report.truncation,
    budget: report.budget,
    shortlist: report.shortlist,
    results: report.results.map(candidate),
    candidates: report.candidates?.map(candidate),
    judgments: report.judgments,
    findings: report.findings,
  };
}
