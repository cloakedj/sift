import { extname } from "node:path";
import { DIMENSIONS } from "../taxonomy/consts.js";
import {
  EMBEDDING_DOCUMENT_BYTES,
  MEDIA_TYPES,
  PROJECTION_SYMBOL_BYTES,
  PROJECTION_MIN_LABEL_SCORE,
  PROJECTION_LABELS_PER_DIMENSION,
} from "./consts.js";
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
  const label = record.resource.structure?.label ?? record.resource.structure?.symbol;
  if (label) pushBoundedLine(lines, `Source: ${utf8Prefix(label, PROJECTION_SYMBOL_BYTES)}`);
  // Spend the budget on source evidence, not absolute paths or bookkeeping.
  // Retain both ends of oversized content so return values/constraints survive.
  const remaining =
    EMBEDDING_DOCUMENT_BYTES - Buffer.byteLength(lines.join("\n")) - (lines.length ? 1 : 0);
  if (Buffer.byteLength(preview) > remaining) {
    const head = utf8Prefix(preview, Math.floor((remaining - 5) * 0.65));
    const tail = [
      ...utf8Prefix([...preview].reverse().join(""), remaining - 5 - Buffer.byteLength(head)),
    ]
      .reverse()
      .join("");
    pushBoundedLine(lines, `${head} ... ${tail}`);
  } else if (preview) pushBoundedLine(lines, preview);
  for (const dimension of DIMENSIONS) {
    const values = record.taxonomy[dimension]
      .filter((label) => label.score >= PROJECTION_MIN_LABEL_SCORE)
      .sort((a, b) => b.score - a.score || a.labelId.localeCompare(b.labelId))
      .slice(0, PROJECTION_LABELS_PER_DIMENSION);
    if (!values.length) continue;
    pushBoundedLine(lines, `${dimension}: ${values.map((label) => label.nameSnapshot).join("; ")}`);
  }
  return lines.join("\n");
}
