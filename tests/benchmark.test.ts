import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { extractTimingSamples } from "../src/benchmark/utils.js";
import { AppError } from "../src/errors/index.js";
import {
  generateScaleCorpus,
  summarizeBenchmarkReportFiles,
  summarizeBenchmarkTimings,
} from "../src/benchmark/index.js";
import { discoverInventory } from "../src/inventory/index.js";
import { LocalRuntimeLive } from "../src/runtime/index.js";

test("timing summaries reject invalid measurements through the typed failure channel", async () => {
  for (const milliseconds of [-1, NaN, Infinity, -Infinity]) {
    const result = await Effect.runPromise(
      summarizeBenchmarkTimings([{ stage: "search", milliseconds }]).pipe(
        Effect.provide(LocalRuntimeLive),
        Effect.either,
      ),
    );
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.code, "INVALID_DATA");
  }
  for (const timing of [
    null,
    {},
    { stage: " ", milliseconds: 1 },
    { stage: "search", milliseconds: "1" },
  ]) {
    assert.throws(
      () => extractTimingSamples({ timings: [timing] }),
      (error: unknown) => error instanceof AppError && error.code === "INVALID_DATA",
    );
  }
  assert.throws(
    () => extractTimingSamples({ timings: null }),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_DATA",
  );
  assert.deepEqual(
    extractTimingSamples([
      {},
      { timings: [] },
      { timings: [{ stage: "search", milliseconds: 0 }] },
    ]),
    { reports: 1, samples: [{ stage: "search", milliseconds: 0 }] },
  );
});

test("report files fail explicitly for empty or malformed timing data", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-timings-"));
  try {
    const path = join(root, "report.json");
    for (const report of [
      { timings: [] },
      { timings: "invalid" },
      {
        timings: [
          { stage: "search", milliseconds: 10 },
          { stage: "search", milliseconds: -1 },
        ],
      },
    ]) {
      await writeFile(path, JSON.stringify(report));
      const result = await Effect.runPromise(
        summarizeBenchmarkReportFiles([path]).pipe(Effect.provide(LocalRuntimeLive), Effect.either),
      );
      assert.ok(Either.isLeft(result));
      assert.equal(result.left.code, "INVALID_DATA");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generation preserves existing content and rejects conflicting destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-scale-safe-"));
  const generate = (target: string, chunks = 23, kind: "code" | "text" | "mixed" = "mixed") =>
    Effect.runPromise(
      generateScaleCorpus(target, { chunks, kind }).pipe(
        Effect.provide(LocalRuntimeLive),
        Effect.either,
      ),
    );
  try {
    const target = join(root, "corpus");
    assert.ok(Either.isRight(await generate(target)));
    const names = (await readdir(target)).sort();
    const snapshot = async () =>
      Promise.all(
        names.map(async (name) => ({
          name,
          content: await readFile(join(target, name), "utf8"),
          modified: (await stat(join(target, name))).mtimeMs,
        })),
      );
    const original = await snapshot();
    assert.ok(Either.isRight(await generate(target)));
    assert.deepEqual(await snapshot(), original);
    for (const [chunks, kind] of [
      [10, "mixed"],
      [24, "mixed"],
      [40, "mixed"],
      [23, "text"],
    ] as const) {
      const result = await generate(target, chunks, kind);
      assert.ok(Either.isLeft(result));
      assert.equal(result.left.code, "INVALID_ARGUMENT");
      assert.deepEqual(await snapshot(), original);
      assert.deepEqual((await readdir(target)).sort(), names);
    }
    const extra = join(target, "notes.txt");
    await writeFile(extra, "keep me");
    assert.ok(Either.isLeft(await generate(target)));
    assert.equal(await readFile(extra, "utf8"), "keep me");
    await rm(extra);
    await writeFile(join(target, names[0]!), "user edits");
    assert.ok(Either.isLeft(await generate(target)));
    assert.equal(await readFile(join(target, names[0]!), "utf8"), "user edits");
    await rm(join(target, names[0]!));
    const outside = join(root, "outside.txt");
    await writeFile(outside, original[0]!.content);
    await symlink(outside, join(target, names[0]!));
    assert.ok(Either.isLeft(await generate(target)));
    assert.equal(await readFile(outside, "utf8"), original[0]!.content);
    const linked = join(root, "linked");
    await symlink(target, linked);
    assert.ok(Either.isLeft(await generate(linked)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const kind of ["code", "text", "mixed"] as const) {
  test(`generated ${kind} corpus matches requested inventory size`, async () => {
    const root = await mkdtemp(join(tmpdir(), "sift-scale-count-"));
    try {
      for (const chunks of [1, 8, 10, 11, 23]) {
        const target = join(root, String(chunks));
        const generate = () =>
          Effect.runPromise(
            generateScaleCorpus(target, { chunks, kind }).pipe(Effect.provide(LocalRuntimeLive)),
          );
        await generate();
        const inspect = () =>
          Effect.runPromise(discoverInventory(target).pipe(Effect.provide(LocalRuntimeLive)));
        const initial = await inspect();
        assert.equal(initial.complete, true);
        assert.equal(initial.chunks.length, chunks);
        await generate();
        assert.deepEqual(await inspect(), initial);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("scale corpus generation is deterministic and summarizes timings", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-scale-"));
  try {
    const report = await Effect.runPromise(
      generateScaleCorpus(root, { chunks: 23, kind: "mixed" }).pipe(
        Effect.provide(LocalRuntimeLive),
      ),
    );
    assert.equal(report.files, 3);
    assert.equal(report.estimatedChunks, 23);
    const inventory = await Effect.runPromise(
      discoverInventory(root).pipe(Effect.provide(LocalRuntimeLive)),
    );
    assert.equal(inventory.complete, true);
    assert.equal(inventory.chunks.length, report.estimatedChunks);
    const files = await readdir(root);
    assert.deepEqual(files.sort(), ["code-00000.ts", "code-00002.ts", "text-00001.md"]);
    assert.match(await readFile(join(root, "code-00000.ts"), "utf8"), /scaleCase0_0/);
    assert.match(await readFile(join(root, "text-00001.md"), "utf8"), /Scale handbook 1\.0/);
    const summary = await Effect.runPromise(
      summarizeBenchmarkTimings([
        { stage: "search", milliseconds: 10 },
        { stage: "search", milliseconds: 30 },
        { stage: "search", milliseconds: 20 },
        { stage: "onboard", milliseconds: 5 },
      ]).pipe(Effect.provide(LocalRuntimeLive)),
    );
    assert.deepEqual(
      summary.find((item) => item.stage === "search"),
      {
        stage: "search",
        samples: 3,
        p50Milliseconds: 20,
        p95Milliseconds: 30,
        minMilliseconds: 10,
        maxMilliseconds: 30,
      },
    );
    const reportPath = join(root, "report.json");
    await writeFile(
      reportPath,
      JSON.stringify([
        { timings: [{ stage: "onboard", milliseconds: 100 }] },
        { timings: [{ stage: "onboard", milliseconds: 300 }] },
      ]),
    );
    const fromFile = await Effect.runPromise(
      summarizeBenchmarkReportFiles([reportPath]).pipe(Effect.provide(LocalRuntimeLive)),
    );
    assert.equal(fromFile.reports, 2);
    assert.deepEqual(
      fromFile.summaries.find((item) => item.stage === "onboard"),
      {
        stage: "onboard",
        samples: 2,
        p50Milliseconds: 100,
        p95Milliseconds: 300,
        minMilliseconds: 100,
        maxMilliseconds: 300,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
