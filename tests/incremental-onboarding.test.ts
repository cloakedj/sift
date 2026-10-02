import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { FileSystemService } from "../src/filesystem/index.js";
import { InventoryService } from "../src/inventory/index.js";
import { SyntaxChunker } from "../src/inventory/syntax/index.js";
import type { InventoryCache } from "../src/inventory/types.js";
import { fakeJev } from "./support/jev.js";
import { onboard } from "./support/runtime.js";

class MemoryInventoryCache implements InventoryCache {
  private readonly _entries = new Map<string, unknown>();
  public writes = 0;
  public read<T>(path: string) {
    return Effect.sync(() => structuredClone(this._entries.get(path)) as T | undefined);
  }
  public write(path: string, value: unknown) {
    return Effect.sync(() => {
      this.writes++;
      this._entries.set(path, structuredClone(value));
    });
  }
}

test("inventory hashes unchanged resources without parsing; changed bytes invalidate even with identical timestamps", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-inventory-cache-"));
  const original = SyntaxChunker.prototype.chunk;
  try {
    const path = join(root, "sample.ts");
    await writeFile(path, "export function first() { return 1; }\n");
    const inventory = new InventoryService(new FileSystemService());
    const cache = new MemoryInventoryCache();
    const first = await Effect.runPromise(inventory.discover(root, undefined, undefined, cache));
    const timestamps = await stat(path);
    SyntaxChunker.prototype.chunk = () => assert.fail("unchanged source must not be parsed");
    const second = await Effect.runPromise(inventory.discover(root, undefined, undefined, cache));
    assert.deepEqual(second.chunks, first.chunks);
    assert.equal(cache.writes, 1);
    SyntaxChunker.prototype.chunk = original;
    await writeFile(path, "export function first() { return 2; }\n");
    await utimes(path, timestamps.atime, timestamps.mtime);
    const third = await Effect.runPromise(inventory.discover(root, undefined, undefined, cache));
    assert.notEqual(third.resources[0]!.resourceHash, first.resources[0]!.resourceHash);
    assert.equal(cache.writes, 2);
    const uncached = await Effect.runPromise(inventory.discover(root));
    assert.deepEqual(third.chunks, uncached.chunks);
    await rm(path);
    assert.equal(
      (await Effect.runPromise(inventory.discover(root, undefined, undefined, cache))).resources
        .length,
      0,
    );
  } finally {
    SyntaxChunker.prototype.chunk = original;
    await rm(root, { recursive: true, force: true });
  }
});

test("cached chunks rebuild cross-file links after target deletion", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-cached-links-"));
  try {
    await writeFile(
      join(root, "caller.ts"),
      'import { target } from "./target.js";\nexport function caller() { return target(); }\n',
    );
    const targetPath = join(root, "target.ts");
    await writeFile(targetPath, "export function target() { return 1; }\n");
    const inventory = new InventoryService(new FileSystemService());
    const cache = new MemoryInventoryCache();
    const first = await Effect.runPromise(inventory.discover(root, undefined, undefined, cache));
    const target = first.chunks.find((chunk) => chunk.path === "target.ts")!;
    assert.ok(
      first.chunks.some((chunk) => chunk.structure?.related?.some((link) => link.id === target.id)),
    );
    await rm(targetPath);
    const second = await Effect.runPromise(inventory.discover(root, undefined, undefined, cache));
    assert.ok(
      !second.chunks.some((chunk) =>
        chunk.structure?.related?.some((link) => link.id === target.id),
      ),
    );
    assert.deepEqual(second.chunks, (await Effect.runPromise(inventory.discover(root))).chunks);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unchanged onboarding preserves record files and emits no per-chunk reuse receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-onboard-cache-"));
  try {
    await writeFile(join(root, "sample.txt"), "Small example document.\n");
    const client = fakeJev();
    const first = await onboard(root, client.client);
    const records = join(root, ".sift", "records");
    const path = join(records, (await readdir(records))[0]!);
    const before = await stat(path);
    const taxonomyPath = join(root, ".sift", "taxonomy.json");
    const taxonomyBefore = await stat(taxonomyPath);
    const callsBefore = client.calls.length;
    const content = await readFile(path, "utf8");
    const second = await onboard(root, client.client);
    assert.equal(second.manifest.classified, 0);
    assert.equal(second.manifest.reused, first.manifest.records.length);
    assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
    assert.equal(await readFile(path, "utf8"), content);
    assert.equal((await stat(taxonomyPath)).mtimeMs, taxonomyBefore.mtimeMs);
    assert.equal(client.calls.length, callsBefore);
    const receipts = await readFile(
      join(root, ".sift", "receipts", `${second.manifest.runId}.jsonl`),
      "utf8",
    );
    assert.deepEqual(
      receipts
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).action.type),
      ["started", "finished"],
    );
    await onboard(root, client.client, { rerunGovernance: true });
    assert.ok(
      client.calls.length > callsBefore,
      "explicit governance rerun must bypass snapshot reuse",
    );
    const callsAfterRerun = client.calls.length;
    await writeFile(join(root, "sample.txt"), "Novel authentication terminology.\n");
    const changed = await onboard(root, client.client);
    assert.ok(client.calls.length > callsAfterRerun);
    assert.ok(changed.manifest.classified > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
