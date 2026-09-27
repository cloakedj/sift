import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { discoverInventory } from "../src/inventory/index.js";
import { LocalRuntimeLive } from "../src/runtime/index.js";

import { parseSuite } from "../src/benchmark/relevance-run/utils.js";

/**
 * Labels address relative paths/ranges because production chunk IDs include absolute roots.
 */
function location(chunk: { path: string; startLine: number; endLine: number }) {
  return `${chunk.path}:${chunk.startLine}-${chunk.endLine}`;
}

test("reviewed relevance labels cover exact fixture contents and current chunk boundaries", async () => {
  const suite = parseSuite(
    JSON.parse(await readFile("tests/support/relevance-cases.json", "utf8")),
  );
  assert.equal(suite.schemaVersion, 1);
  assert.deepEqual(suite.corpora.map((corpus) => corpus.scope).sort(), ["code", "mixed", "text"]);
  const caseIds = new Set<string>();
  let positives = 0;
  let negatives = 0;
  for (const corpus of suite.corpora) {
    const root = resolve("tests/fixtures", corpus.scope);
    const inventory = await Effect.runPromise(
      discoverInventory(root).pipe(Effect.provide(LocalRuntimeLive)),
    );
    assert.equal(inventory.complete, true);
    assert.deepEqual(
      Object.fromEntries(
        inventory.resources.map((resource) => [resource.path, resource.resourceHash]),
      ),
      corpus.files,
      "Source changes/additions require reviewing all exhaustive relevance labels",
    );
    const actual = new Map(inventory.chunks.map((chunk) => [location(chunk), chunk.id]));
    assert.equal(actual.size, inventory.chunks.length);
    assert.deepEqual([...actual.keys()].sort(), corpus.chunks.map(location).sort());
    const keys = new Set(corpus.chunks.map((chunk) => chunk.key));
    assert.equal(keys.size, corpus.chunks.length);
    assert.ok(corpus.cases.some((item) => item.relevant.length > 0));
    assert.ok(corpus.cases.some((item) => item.relevant.length === 0));
    for (const item of corpus.cases) {
      assert.ok(item.id.trim());
      assert.ok(!caseIds.has(item.id));
      caseIds.add(item.id);
      assert.ok(item.query.trim());
      assert.ok(item.rationale.trim());
      assert.equal(new Set(item.relevant).size, item.relevant.length);
      for (const key of item.relevant) assert.ok(keys.has(key), `Unknown relevance label: ${key}`);
      if (item.relevant.length) positives++;
      else negatives++;
    }
  }
  assert.equal(positives, 6);
  assert.equal(negatives, 6);
});
