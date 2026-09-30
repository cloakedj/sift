import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentChunker } from "../src/inventory/document/index.js";
import { linkStructure, reassembleUnit } from "../src/inventory/structure/utils.js";
import { MAX_CHUNK_BYTES, MAX_CHUNK_LINES, MAX_STRUCTURE_BYTES } from "../src/inventory/consts.js";
import { discoverInventory } from "./support/runtime.js";
import { hash } from "../src/shared/utils.js";

function chunks(text: string, path = "policy.md") {
  const result = new DocumentChunker().chunk(text, path, "resource");
  linkStructure(result);
  return result;
}

test("sections and paragraphs share source-unit contracts with code, without crossing unrelated sections", () => {
  const text =
    "# Refunds\r\n\r\nUse ERR_REFUND_WINDOW.\r\n\r\n## Exceptions\r\n\r\nNeed a receipt.\r\n\r\n# Payments\r\n\r\nCards only.\r\n";
  const result = chunks(text);
  const refund = result.find((item) => item.text.startsWith("Use ERR"))!;
  const exceptions = result.find((item) => item.text.startsWith("## Exceptions"))!;
  const receipt = result.find((item) => item.text.startsWith("Need a receipt"))!;
  const heading = result[0]!;
  assert.equal(refund.structure!.unit!.parentId, heading.structure!.unit!.id);
  assert.equal(receipt.structure!.unit!.parentId, exceptions.structure!.unit!.id);
  assert.deepEqual(
    receipt.structure!.ancestors!.map((item) => item.label),
    ["Exceptions", "Refunds"],
  );
  assert.ok(
    heading.structure!.related.some(
      (link) => link.id === refund.id && link.relation === "contains",
    ),
  );
  assert.ok(
    refund.structure!.related.some(
      (link) => link.id === heading.id && link.relation === "container",
    ),
  );
  assert.ok(
    !refund.structure!.related.some(
      (link) => result.find((item) => item.id === link.id)!.structure!.label === "Payments",
    ),
  );
  assert.ok(
    result.every((item) =>
      item.structure!.related.every((link) => link.basis === "source-structure"),
    ),
  );
  const source = Buffer.from(text);
  for (const chunk of result)
    assert.equal(chunk.text, source.subarray(chunk.startByte, chunk.endByte).toString());
  const resource = {
    id: "resource",
    uri: "file:///policy.md",
    path: "policy.md",
    bytes: source.length,
    chunkCount: result.length,
    resourceHash: hash(source),
  };
  assert.equal(
    reassembleUnit(heading.structure!.unit!, resource, source),
    text.slice(0, text.indexOf("# Payments")),
  );
  assert.throws(
    () => reassembleUnit(heading.structure!.unit!, resource, Buffer.from(text + "changed")),
    /different source version/,
  );
  assert.deepEqual(result, chunks(text));
});

test("fences are opaque, repeated headings are distinct, and plain text has paragraphs rather than guessed headings", () => {
  const text = "# Same\n\n```md\n# Fake\n\n~~~\n```\n\n# Same\n\nOther paragraph.\n";
  const result = chunks(text);
  const sections = result.filter((item) => item.structure!.unit!.kind === "section");
  assert.equal(sections.length, 2);
  assert.notEqual(sections[0]!.structure!.unit!.id, sections[1]!.structure!.unit!.id);
  const fenced = result.find((item) => item.structure!.unit!.kind === "fenced-block")!;
  assert.match(fenced.text, /# Fake\n\n~~~/);
  assert.equal(fenced.structure!.unit!.parentId, sections[0]!.structure!.unit!.id);
  assert.ok(chunks(text, "notes.txt").every((item) => item.structure!.unit!.kind === "paragraph"));
  assert.equal(chunks("\n \n\n").length, 0);
  assert.deepEqual(
    chunks("# C#\n\n#\n\n# Closing ###\n").map((item) => item.structure!.label),
    ["C#", "", "Closing"],
  );
  assert.equal(
    chunks("# Real\n\n~~~\n# Still fenced\n").filter(
      (item) => item.structure!.unit!.kind === "section",
    ).length,
    1,
  );
});

test("oversized paragraphs retain identity, exact Unicode ranges and bounded continuation links", () => {
  const text =
    "# Refunds\n\n" +
    "界😀".repeat(4000) +
    "\r\n" +
    "more text\r\n".repeat(110) +
    "\n\nNext paragraph.\n";
  const result = chunks(text);
  const parts = result.filter((item) => item.structure!.unit!.startLine === 3);
  assert.ok(parts.length > 4);
  assert.equal(new Set(parts.map((item) => item.structure!.unit!.id)).size, 1);
  const source = Buffer.from(text);
  for (const [index, chunk] of parts.entries()) {
    assert.deepEqual(chunk.structure!.part, { index, count: parts.length });
    assert.ok(chunk.endByte - chunk.startByte <= MAX_CHUNK_BYTES);
    assert.ok(chunk.endLine - chunk.startLine + 1 <= MAX_CHUNK_LINES);
    assert.equal(chunk.text, source.subarray(chunk.startByte, chunk.endByte).toString());
    assert.ok(!chunk.text.includes("�"));
    assert.ok(chunk.endByte <= chunk.structure!.unit!.endByte);
    assert.ok(
      chunk.structure!.related.filter((link) => link.relation === "continuation").length <= 2,
    );
  }
});

test("large documents preserve bounded streaming fallback rather than claiming extracted hierarchy", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-document-fallback-"));
  try {
    await writeFile(join(root, "large.md"), "# Heading\n\n" + "x".repeat(MAX_STRUCTURE_BYTES));
    const inventory = await discoverInventory(root);
    assert.equal(inventory.complete, true);
    assert.ok(inventory.chunks.length > 1);
    assert.ok(
      inventory.chunks.every(
        (chunk) => chunk.structure?.mode === "bounded" && !chunk.structure.unit,
      ),
    );
    assert.ok(
      inventory.chunks.some((chunk) =>
        chunk.structure!.related.some((link) => link.relation === "adjacent"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
