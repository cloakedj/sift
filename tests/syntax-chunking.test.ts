import assert from "node:assert/strict";
import { test } from "node:test";
import { SyntaxChunker } from "../src/inventory/syntax/index.js";
import { linkCodeReferences } from "../src/inventory/syntax/utils.js";
import { linkStructure, reassembleUnit } from "../src/inventory/structure/utils.js";
import type { InventoryChunk } from "../src/inventory/types.js";

function linkChunks(chunks: InventoryChunk[]) {
  linkCodeReferences(chunks);
  linkStructure(chunks);
}
import { MAX_CHUNK_BYTES, MAX_CHUNK_LINES } from "../src/inventory/consts.js";
import { embeddingDocument } from "../src/onboarding/utils.js";

const parser = new SyntaxChunker();

test("functions, arrow declarations and class methods have exact, shared-file source boundaries", () => {
  const text =
    'import { cap as limit } from "./limits.js";\r\nexport const tokenize = (s: string) => s.split(" ");\r\n/** Score 日本語 */\r\nexport function scoreChunk(s: string) { return tokenize(s).length; }\r\nexport class Search {\r\n  public search() { return limit; }\r\n  public other() { return this.search(); }\r\n}\r\n';
  const chunks = parser.chunk(text, "index.ts", "file-id")!;
  const limits = parser.chunk("export const cap = 20;", "limits.ts", "limits-id")!;
  linkChunks([...chunks, ...limits]);
  assert.equal(chunks.length, 7);
  assert.ok(chunks.every((chunk) => chunk.resourceId === "file-id"));
  for (const chunk of chunks) {
    assert.equal(chunk.text, Buffer.from(text).subarray(chunk.startByte, chunk.endByte).toString());
    assert.equal(
      chunk.startLine,
      text.slice(0, Buffer.from(text).subarray(0, chunk.startByte).toString().length).split("\n")
        .length,
    );
    assert.ok(chunk.endLine - chunk.startLine + 1 <= MAX_CHUNK_LINES);
  }
  const score = chunks.find((chunk) => chunk.structure?.symbol === "scoreChunk")!;
  const tokenize = chunks.find((chunk) => chunk.structure?.symbol === "tokenize")!;
  assert.match(score.text, /^\/\*\* Score 日本語/);
  assert.ok(!score.text.includes("export const tokenize"));
  assert.ok(
    score.structure!.related.some(
      (link) => link.id === tokenize.id && link.relation === "reference",
    ),
  );
  const search = chunks.find((chunk) => chunk.structure?.symbol === "Search.search")!;
  assert.equal(search.structure?.container, "Search");
  const parent = search.structure!.ancestors![0]!;
  assert.equal(search.structure!.unit!.parentId, parent.id);
  assert.equal(parent.parentId, "file-id");
  assert.equal(parent.resourceId, "file-id");
  const resource = {
    id: "file-id",
    resourceHash: parent.resourceHash,
    uri: "file:///index.ts",
    path: "index.ts",
    bytes: Buffer.byteLength(text),
    chunkCount: chunks.length,
  };
  const assembled = reassembleUnit(parent, resource, Buffer.from(text));
  assert.match(assembled, /^export class Search/);
  assert.ok(assembled.includes("public search()") && assembled.includes("public other()"));
  assert.throws(
    () => reassembleUnit(parent, resource, Buffer.from(text + "// changed")),
    /different source version/,
  );
  assert.ok(search.structure!.related.some((link) => link.id === limits[0]!.id));
  assert.ok(
    chunks
      .find((chunk) => chunk.structure?.symbol === "Search.other")!
      .structure!.related.some((link) => link.id === search.id),
  );
  assert.deepEqual(
    parser.chunk(text, "index.ts", "file-id"),
    parser.chunk(text, "index.ts", "file-id"),
  );
});

test("binding prevents false links from shadowing; outside-index imports stay unresolved", () => {
  const chunks = parser.chunk(
    'import { cap } from "./limits.js";\nexport function shadow(cap: number) { return cap; }\nexport function use() { return cap; }',
    "index.ts",
    "one",
  )!;
  linkChunks(chunks);
  assert.equal(
    chunks.find((chunk) => chunk.structure?.symbol === "shadow")!.structure!.references!.length,
    0,
  );
  assert.equal(
    chunks
      .find((chunk) => chunk.structure?.symbol === "use")!
      .structure!.related.filter((link) => link.relation === "reference").length,
    0,
  );
});

test("oversized functions split within limits and retain continuation relationships", () => {
  const text = `export function large() {\n${"  constText('🌍');\n".repeat(110)}return '${"界".repeat(4000)}';\n}\nexport function next() { return 2; }`;
  const chunks = parser.chunk(text, "big.ts", "big")!;
  linkChunks(chunks);
  assert.ok(chunks.length > 3);
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(chunk.text) <= MAX_CHUNK_BYTES);
    assert.ok(chunk.endLine - chunk.startLine + 1 <= MAX_CHUNK_LINES);
    assert.equal(chunk.text, Buffer.from(text).subarray(chunk.startByte, chunk.endByte).toString());
    assert.ok(!chunk.text.includes("�"));
  }
  assert.ok(chunks[0]!.structure!.related.some((link) => link.relation === "continuation"));
  const parts = chunks.filter((chunk) => chunk.structure?.symbol === "large");
  assert.equal(new Set(parts.map((part) => part.structure!.unit!.id)).size, 1);
  assert.ok(
    parts.every(
      (part, index) =>
        part.structure!.part!.index === index && part.structure!.part!.count === parts.length,
    ),
  );
  assert.equal(parts[0]!.structure!.unit!.parentId, "big");
  assert.equal(chunks.at(-1)!.structure?.symbol, "next");
  assert.equal(parser.chunk("export function broken( {", "bad.ts", "bad"), undefined);
});

test("source-first projections preserve scoring evidence, not import headers and paths", () => {
  const text =
    "export function scoreChunk(text: string, query: string) { let score = 0; if (text.includes(query)) score += 40; return score; }";
  const projection = embeddingDocument({
    resource: {
      id: "r",
      uri: "file:///long/private/path/utils.ts",
      mediaType: "text/typescript",
      range: { startLine: 1, endLine: 1, startByte: 0, endByte: text.length },
      resourceHash: "r",
      chunkHash: "c",
      textPreview: text,
      structure: { mode: "syntax", symbol: "scoreChunk", references: [], related: [] },
    },
    taxonomy: {
      domains: [],
      concepts: [],
      operations: [],
      dependencies: [],
      risks: [],
      evidenceKinds: [],
    },
  });
  assert.match(projection, /score \+= 40/);
  assert.ok(!projection.includes("private/path"));
  assert.ok(Buffer.byteLength(projection) <= 500);
});
