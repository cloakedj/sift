import { extname } from "node:path";
import { DIMENSIONS } from "../taxonomy/consts.js";
import { EMBEDDING_DOCUMENT_BYTES, MEDIA_TYPES, PROJECTION_VERSION } from "./consts.js";
import type { ProjectionSummary, SemanticChunkRecord } from "./types.js";
import { hash } from "../shared/utils.js";

/**
 * Group exact stored embedding inputs, not source text or semantic similarity.
 * Report every member of duplicate groups without exposing the projection body.
 * Distinct documents alone do not establish retrieval quality.
 */
export function summarizeProjections(
  records: Pick<SemanticChunkRecord, "id" | "resource" | "embeddingDocument">[],
): ProjectionSummary {
  const documents = new Map<string, ProjectionSummary["collisionGroups"][number]["chunks"]>();
  for (const record of records) {
    const chunks = documents.get(record.embeddingDocument) ?? [];
    chunks.push({ id: record.id, uri: record.resource.uri, range: { ...record.resource.range } });
    documents.set(record.embeddingDocument, chunks);
  }
  const collisionGroups = [...documents.entries()]
    .filter(([, chunks]) => chunks.length > 1)
    .map(([document, chunks]) => ({
      documentHash: hash(document),
      chunks: chunks.sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.documentHash.localeCompare(b.documentHash));
  return {
    records: records.length,
    uniqueDocuments: documents.size,
    collidingRecords: collisionGroups.reduce((count, group) => count + group.chunks.length, 0),
    collisionGroups,
  };
}

export const mediaFacts = (path: string) =>
  MEDIA_TYPES[extname(path).toLowerCase()] ?? { mediaType: "text/plain" };

function utf8Prefix(value: string, maxBytes: number) {
  let bytes = 0;
  let result = "";
  for (const char of value) {
    const next = Buffer.byteLength(char, "utf8");
    if (bytes + next > maxBytes) break;
    result += char;
    bytes += next;
  }
  return result;
}

function pushBoundedLine(lines: string[], line: string) {
  const used = Buffer.byteLength(lines.join("\n"), "utf8");
  const separator = lines.length ? 1 : 0;
  const remaining = EMBEDDING_DOCUMENT_BYTES - used - separator;
  if (remaining <= 0) return;
  if (Buffer.byteLength(line, "utf8") <= remaining) {
    lines.push(line);
    return;
  }
  if (remaining <= 3) return;
  lines.push(`${utf8Prefix(line, remaining - 3)}...`);
}

export function embeddingDocument(record: Pick<SemanticChunkRecord, "resource" | "taxonomy">) {
  const preview = record.resource.textPreview.replace(/\s+/gu, " ").trim();
  const lines: string[] = [];
  for (const line of [
    `Projection: ${PROJECTION_VERSION}`,
    `Resource: ${record.resource.uri}`,
    `Lines: ${record.resource.range.startLine}-${record.resource.range.endLine}`,
    `Media type: ${record.resource.mediaType}`,
  ])
    pushBoundedLine(lines, line);
  if (record.taxonomy.resourceKind)
    pushBoundedLine(lines, `Kind: ${record.taxonomy.resourceKind.nameSnapshot}`);
  if (preview) pushBoundedLine(lines, `Content preview: ${preview}`);
  for (const dimension of DIMENSIONS) {
    const values = [...record.taxonomy[dimension]].sort((a, b) =>
      a.labelId < b.labelId ? -1 : a.labelId > b.labelId ? 1 : 0,
    );
    pushBoundedLine(
      lines,
      `${dimension}: ${values.map((label) => `${label.nameSnapshot} (${label.score.toFixed(4)})`).join("; ")}`,
    );
  }
  return lines.join("\n");
}
