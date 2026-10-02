import { MAX_CHUNK_BYTES, MAX_CHUNK_LINES } from "../consts.js";
import type { DocumentPiece } from "./types.js";

/**
 * Keep directly adjacent Markdown evidence together without crossing a heading.
 * A section absorbs its first direct body piece, even if it must later split;
 * otherwise the heading would still consume its own assessment slot. Later
 * label/list and explanation/fence pairs join only when the entire group fits.
 * Grouping preserves original bytes and section ownership, not inferred meaning.
 */
export function groupDocumentPieces(source: Buffer, pieces: DocumentPiece[]): DocumentPiece[] {
  const groups: DocumentPiece[] = [];
  for (const [index, piece] of pieces.entries()) {
    const previous = pieces[index - 1];
    const group = groups.at(-1);
    const directBody =
      previous?.region.kind === "section" &&
      piece.region.kind !== "section" &&
      piece.region.parent === previous.region;
    const sameParent = previous?.region.parent === piece.region.parent;
    const fencePair =
      (previous?.region.kind === "paragraph" && piece.region.kind === "fenced-block") ||
      (previous?.region.kind === "fenced-block" && piece.region.kind === "paragraph");
    const labelList =
      previous?.region.kind === "paragraph" &&
      piece.region.kind === "paragraph" &&
      source.subarray(previous.start, previous.end).toString("utf8").trimEnd().endsWith(":") &&
      /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.test(
        source.subarray(piece.start, piece.end).toString("utf8"),
      );
    const fits =
      group &&
      piece.end - group.start <= MAX_CHUNK_BYTES &&
      piece.endLine - group.line + 1 <= MAX_CHUNK_LINES;
    if (
      group &&
      group.end === piece.start &&
      (directBody || (fits && sameParent && (fencePair || labelList)))
    ) {
      group.end = piece.end;
      group.endLine = piece.endLine;
      if (group.region.kind !== "section") {
        group.region = {
          ...group.region,
          kind: "passage",
          end: piece.end,
          endLine: piece.endLine,
        };
      }
    } else groups.push({ ...piece });
  }
  return groups;
}
