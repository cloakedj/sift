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

test("headings own direct evidence while later paragraphs retain hierarchy and exact reassembly", () => {
  const text =
    "# Refunds\r\n\r\nUse ERR_REFUND_WINDOW.\r\n\r\nRefund details.\r\n\r\n## Exceptions\r\n\r\nNeed a receipt.\r\n\r\nReceipt details.\r\n\r\n# Payments\r\n\r\nCards only.\r\n";
  const result = chunks(text);
  const refund = result.find((item) => item.text.startsWith("Refund details"))!;
  const exceptions = result.find((item) => item.text.startsWith("## Exceptions"))!;
  const receipt = result.find((item) => item.text.startsWith("Receipt details"))!;
  const heading = result[0]!;
  assert.match(heading.text, /Use ERR_REFUND_WINDOW/);
  assert.match(exceptions.text, /Need a receipt/);
  assert.equal(receipt.structure!.label, "Refunds > Exceptions");
  assert.equal(result.map((item) => item.text).join(""), text);
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
  assert.match(sections[0]!.text, /# Same\n\n```md\n# Fake\n\n~~~\n```/);
  assert.match(sections[1]!.text, /Other paragraph/);
  assert.equal(result.map((item) => item.text).join(""), text);
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
  const parts = result.filter((item) => item.structure!.unit!.kind === "section");
  assert.match(parts[0]!.text, /^# Refunds\n\n界😀/);
  assert.equal(result.map((item) => item.text).join(""), text);
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

test("introductory labels stay with lists and fenced examples keep adjacent explanations", () => {
  const list =
    "Required:\n\n- A current publication\n- Repair stale projections\n\nUnrelated paragraph.\n";
  const listChunks = chunks(list);
  assert.equal(listChunks.length, 2);
  assert.equal(listChunks[0]!.structure!.unit!.kind, "passage");
  assert.match(
    listChunks[0]!.text,
    /^Required:\n\n- A current publication\n- Repair stale projections/,
  );
  const example =
    "# Examples\r\n\r\nRun the following:\r\n\r\n```sh\r\n# Not a heading\r\nsift status\r\n```\r\n\r\nThis reads local state.\r\n\r\nSeparate topic.\r\n";
  const exampleChunks = chunks(example);
  assert.equal(exampleChunks.length, 2);
  assert.match(
    exampleChunks[0]!.text,
    /Run the following:[\s\S]*```sh[\s\S]*This reads local state/,
  );
  assert.ok(!exampleChunks[0]!.text.includes("Separate topic"));
  for (const text of [list, example]) {
    const result = chunks(text);
    assert.equal(result.map((item) => item.text).join(""), text);
    assert.deepEqual(result, chunks(text));
    const source = Buffer.from(text);
    const resource = {
      id: "resource",
      uri: "file:///policy.md",
      path: "policy.md",
      bytes: source.length,
      chunkCount: result.length,
      resourceHash: hash(source),
    };
    for (const chunk of result) {
      assert.equal(chunk.text, source.subarray(chunk.startByte, chunk.endByte).toString());
      const unit = chunk.structure!.unit!;
      assert.equal(
        reassembleUnit(unit, resource, source),
        source.subarray(unit.startByte, unit.endByte).toString(),
      );
    }
  }
});

test("generic titles keep full heading ancestry without merging distinct sections or empty containers", () => {
  const text =
    "# Product\n\n## Proposed\n\n### Setup\n\nPlanned steps.\n\n## Current\n\n### Setup\n\nEstablished steps.\n\n# Empty\n";
  const result = chunks(text);
  const proposed = result.find((item) => item.text.includes("Planned steps"))!;
  const current = result.find((item) => item.text.includes("Established steps"))!;
  assert.equal(proposed.structure!.label, "Product > Proposed > Setup");
  assert.equal(current.structure!.label, "Product > Current > Setup");
  assert.deepEqual(
    current.structure!.ancestors!.map((item) => item.label),
    ["Current", "Product"],
  );
  assert.equal(proposed.structure!.unit!.label, "Setup");
  assert.notEqual(proposed.structure!.unit!.id, current.structure!.unit!.id);
  assert.equal(result[0]!.text, "# Product\n\n");
  assert.equal(result.at(-1)!.text, "# Empty\n");
  assert.ok(
    result.every((item) => !(item.text.includes("Planned") && item.text.includes("Established"))),
  );
  assert.equal(result.map((item) => item.text).join(""), text);
});

test("oversized example groups keep bounded pieces and relationships instead of unlimited merges", () => {
  const text =
    "# Examples\n\nIntroduction.\n\n```text\n" + "line\n".repeat(100) + "```\n\nExplanation.\n";
  const result = chunks(text);
  const fence = result.filter((item) => item.structure!.unit!.kind === "fenced-block");
  assert.equal(fence.length, 3);
  assert.equal(new Set(fence.map((item) => item.structure!.unit!.id)).size, 1);
  assert.ok(
    result[0]!.structure!.related.some(
      (link) => link.id === fence[0]!.id && link.relation === "contains",
    ),
  );
  assert.ok(
    fence
      .at(-1)!
      .structure!.related.some(
        (link) => link.id === result.at(-1)!.id && link.relation === "adjacent",
      ),
  );
  assert.ok(!result[0]!.text.includes("```"));
  assert.equal(result.map((item) => item.text).join(""), text);
  for (const chunk of result) {
    assert.ok(chunk.endByte - chunk.startByte <= MAX_CHUNK_BYTES);
    assert.ok(chunk.endLine - chunk.startLine + 1 <= MAX_CHUNK_LINES);
    assert.ok(
      chunk.structure!.related.every((link) =>
        result.some((candidate) => candidate.id === link.id),
      ),
    );
  }
});

test("byte and line caps preserve CRLF, source coverage and deterministic continuation identities", () => {
  const header = "# Root\r\n\r\n";
  const text =
    header + "x".repeat(MAX_CHUNK_BYTES - header.length - 1) + "\r\n" + "界😀\r\n".repeat(100);
  const result = chunks(text);
  assert.equal(result[0]!.endByte, MAX_CHUNK_BYTES - 1);
  assert.equal(result.map((item) => item.text).join(""), text);
  const bytes = Buffer.from(text);
  for (const chunk of result) {
    assert.equal(chunk.startLine, bytes.subarray(0, chunk.startByte).toString().split("\n").length);
    assert.equal(
      chunk.endLine,
      bytes
        .subarray(0, chunk.endByte - 1)
        .toString()
        .split("\n").length,
    );
    assert.equal(chunk.text, bytes.subarray(chunk.startByte, chunk.endByte).toString());
    assert.ok(chunk.endLine - chunk.startLine + 1 <= MAX_CHUNK_LINES);
    assert.ok(chunk.endByte - chunk.startByte <= MAX_CHUNK_BYTES);
    assert.ok(!chunk.text.endsWith("\r"));
    assert.equal(chunk.structure!.label, "Root");
  }
  assert.deepEqual(result, chunks(text));
  assert.notEqual(result[0]!.id, chunks(text.replace("Root", "Changed"))[0]!.id);
});

test("unbounded headings or separators are never allowed to bypass the safety caps", () => {
  const text = "# " + "x".repeat(MAX_CHUNK_BYTES + 1) + "\n" + "\n".repeat(55) + "Body.\n";
  const result = chunks(text);
  assert.equal(result.map((item) => item.text).join(""), text);
  assert.ok(result.some((item) => item.text.includes("Body.")));
  for (const chunk of result) {
    assert.ok(chunk.endByte - chunk.startByte <= MAX_CHUNK_BYTES);
    assert.ok(chunk.endLine - chunk.startLine + 1 <= MAX_CHUNK_LINES);
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
