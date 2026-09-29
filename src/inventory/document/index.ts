import { extname } from "node:path";
import { hash } from "../../shared/utils.js";
import { CHUNKER_VERSION, MAX_CHUNK_BYTES, MAX_CHUNK_LINES } from "../consts.js";
import type { InventoryChunk } from "../types.js";
import type { SourceUnit } from "../structure/types.js";
import type { DocumentRegion, DocumentPiece } from "./types.js";

export class DocumentChunker {
  /**
   * Extract ATX-heading sections and paragraphs without semantic inference.
   * Fenced blocks are opaque to heading/paragraph detection. A section owns its
   * heading and contains child units; its full range includes those descendants.
   * All ranges address original bytes, including CRLF and multibyte characters.
   */
  public chunk(text: string, path: string, resourceId: string): InventoryChunk[] {
    const source = Buffer.from(text);
    const markdown = [".md", ".markdown"].includes(extname(path).toLowerCase());
    const sections: DocumentRegion[] = [];
    const pieces: DocumentPiece[] = [];
    let paragraph: DocumentRegion | undefined;
    let fence: { character: string; length: number } | undefined;
    let line = 1;
    for (let start = 0; start < source.length; line++) {
      const newline = source.indexOf(10, start);
      const end = newline < 0 ? source.length : newline + 1;
      const content = source
        .subarray(start, end)
        .toString("utf8")
        .replace(/\r?\n$/, "");
      const heading = markdown && !fence ? /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(content) : null;
      const delimiter = markdown ? /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content) : null;
      if (heading) {
        paragraph = undefined;
        while (sections.length && sections.at(-1)!.depth! >= heading[1]!.length) {
          const closed = sections.pop()!;
          closed.end = start;
          closed.endLine = line - 1;
        }
        const region: DocumentRegion = {
          start,
          end: source.length,
          line,
          endLine: line,
          kind: "section",
          label: (heading[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim(),
          depth: heading[1]!.length,
          parent: sections.at(-1),
        };
        sections.push(region);
        pieces.push({ region, start, end, line });
      } else if (content.trim() || fence) {
        const opensFence = !fence && delimiter;
        if (opensFence) paragraph = undefined;
        if (!paragraph) {
          paragraph = {
            start,
            end,
            line,
            endLine: line,
            kind: opensFence ? "fenced-block" : "paragraph",
            parent: sections.at(-1),
          };
          pieces.push({ region: paragraph, start, end, line });
        } else {
          paragraph.end = end;
          paragraph.endLine = line;
          pieces.at(-1)!.end = end;
        }
        if (opensFence) fence = { character: delimiter[1]![0]!, length: delimiter[1]!.length };
        else if (
          fence &&
          delimiter &&
          delimiter[1]![0] === fence.character &&
          delimiter[1]!.length >= fence.length &&
          !delimiter[2]!.trim()
        ) {
          fence = undefined;
          paragraph = undefined;
        }
      } else {
        // Preserve separators in the preceding piece, but not as standalone evidence.
        if (pieces.length) {
          pieces.at(-1)!.end = end;
          const previous = pieces.at(-1)!.region;
          if (previous.kind !== "section") {
            previous.end = end;
            previous.endLine = line;
          }
        }
        paragraph = undefined;
      }
      start = end;
    }
    for (const section of sections) section.endLine = Math.max(section.line, line - 1);
    const resourceHash = hash(source);
    const unitFor = (region: DocumentRegion): SourceUnit => {
      if (region.unit) return region.unit;
      const contentHash = hash(source.subarray(region.start, region.end));
      region.unit = {
        id: hash(
          `${resourceId}:${CHUNKER_VERSION}:unit:${region.start}:${region.end}:${contentHash}`,
        ),
        parentId: region.parent ? unitFor(region.parent).id : resourceId,
        resourceId,
        resourceHash,
        contentHash,
        kind: region.kind,
        label: region.label,
        startByte: region.start,
        endByte: region.end,
        startLine: region.line,
        endLine: region.endLine,
      };
      return region.unit;
    };
    const chunks: InventoryChunk[] = [];
    for (const piece of pieces) {
      const unit = unitFor(piece.region);
      const ancestors: SourceUnit[] = [];
      for (let parent = piece.region.parent; parent; parent = parent.parent)
        ancestors.push(unitFor(parent));
      let chunkLine = piece.line;
      for (let start = piece.start; start < piece.end;) {
        let end = Math.min(start + MAX_CHUNK_BYTES, piece.end);
        while (end < piece.end && (source[end]! & 0xc0) === 0x80) end--;
        let lines = 0;
        let lastLine = chunkLine;
        for (let cursor = start; cursor < end; cursor++) {
          lastLine = chunkLine + lines;
          if (source[cursor] === 10 && ++lines === MAX_CHUNK_LINES) {
            end = cursor + 1;
            break;
          }
        }
        const bytes = source.subarray(start, end);
        const chunkHash = hash(bytes);
        chunks.push({
          id: hash(`${resourceId}:${CHUNKER_VERSION}:${start}:${end}:${chunkHash}`),
          resourceId,
          path,
          startByte: start,
          endByte: end,
          startLine: chunkLine,
          endLine: lastLine,
          chunkHash,
          text: bytes.toString("utf8"),
          structure: {
            mode: "document",
            unit,
            ancestors,
            label: unit.label ?? ancestors[0]?.label,
            related: [],
          },
        });
        chunkLine += lines;
        start = end;
      }
    }
    return chunks;
  }
}
