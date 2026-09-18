import { extname } from "node:path";
import { DIMENSIONS } from "../taxonomy/consts.js";
import { MEDIA_TYPES, PROJECTION_VERSION } from "./consts.js";
import type { SemanticChunkRecord } from "./types.js";

export const mediaFacts = (path: string) =>
  MEDIA_TYPES[extname(path).toLowerCase()] ?? { mediaType: "text/plain" };
export function embeddingDocument(record: Pick<SemanticChunkRecord, "resource" | "taxonomy">) {
  const lines = [
    `Projection: ${PROJECTION_VERSION}`,
    `Resource: ${record.resource.uri}`,
    `Media type: ${record.resource.mediaType}`,
  ];
  if (record.taxonomy.resourceKind)
    lines.push(`Kind: ${record.taxonomy.resourceKind.nameSnapshot}`);
  for (const dimension of DIMENSIONS) {
    const values = [...record.taxonomy[dimension]].sort((a, b) =>
      a.labelId < b.labelId ? -1 : a.labelId > b.labelId ? 1 : 0,
    );
    lines.push(
      `${dimension}: ${values.map((label) => `${label.nameSnapshot} (${label.score.toFixed(4)})`).join("; ")}`,
    );
  }
  return lines.join("\n");
}
