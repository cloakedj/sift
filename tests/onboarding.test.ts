import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  onboard,
  inspectRecords,
  inspectValidation,
  repairProjections,
} from "./support/runtime.js";
import { embeddingDocument } from "../src/onboarding/utils.js";
import { fakeJev } from "./support/jev.js";

async function temporary(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "jev-semantic-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
for (const scope of ["code", "text", "mixed"])
  test(`controlled ${scope} onboarding produces inspectable records, receipts, and cache reuse`, async () =>
    temporary(async (root) => {
      await cp(resolve("tests/fixtures", scope), root, {
        recursive: true,
        filter: (source) => !source.split(/[\\/]/).includes(".jev"),
      });
      const { client, calls } = fakeJev();
      const first = await onboard(root, client);
      assert.equal(first.manifest.state, "complete");
      assert.ok(first.manifest.classified > 0);
      assert.ok(first.timings.some((timing) => timing.stage === "resource-discovery"));
      assert.ok(first.timings.some((timing) => timing.stage === "taxonomy-governance"));
      assert.ok(first.timings.some((timing) => timing.stage === "chunk-classification"));
      assert.ok(first.timings.every((timing) => timing.milliseconds >= 0));
      const firstClassification = calls.findIndex((call) => "resourceKind" in call.questions);
      assert.ok(firstClassification > 0);
      assert.ok(calls.slice(firstClassification).every((call) => "resourceKind" in call.questions));
      assert.ok(
        calls
          .slice(0, firstClassification)
          .every((call) => Buffer.byteLength(JSON.stringify(call)) <= 16 * 1024),
      );
      const count = calls.length;
      const inspected = await inspectRecords(root);
      assert.equal(inspected.complete, true);
      for (const record of inspected.records) {
        assert.equal(record.embeddingDocument, embeddingDocument(record));
        assert.equal(record.provenance.projectionVersion, "semantic-projection-v4");
        assert.ok(!record.embeddingDocument.includes(record.resource.uri));
        assert.ok(
          record.embeddingDocument.includes(record.resource.textPreview.trim().split("\n")[0]!),
        );
        assert.ok(Buffer.byteLength(record.embeddingDocument, "utf8") <= 500);
        assert.equal(record.provenance.model, client.model);
        assert.ok(record.resource.uri.startsWith("file:"));
        assert.ok(record.resource.range.endByte > record.resource.range.startByte);
        assert.ok(record.taxonomy.concepts.length > 0);
      }
      const receiptFile = join(root, ".jev", "receipts", `${first.manifest.runId}.jsonl`);
      const receiptBefore = await readFile(receiptFile, "utf8");
      const second = await onboard(root, client);
      assert.equal(second.manifest.classified, 0);
      assert.equal(second.manifest.reused, first.manifest.classified);
      assert.equal(calls.length, count);
      assert.equal(await readFile(receiptFile, "utf8"), receiptBefore);
      const validation = await inspectValidation(root);
      assert.equal(validation.complete, true);
      assert.equal(validation.classifications.records, inspected.records.length);
      assert.equal(validation.projections.records, inspected.records.length);
      assert.equal(
        validation.projections.uniqueDocuments,
        new Set(inspected.records.map((record) => record.embeddingDocument)).size,
      );
      if (scope === "text")
        assert.equal(validation.projections.uniqueDocuments, inspected.records.length);
      assert.equal(
        validation.findings.some((finding) => finding.subject === "projections"),
        validation.projections.collidingRecords > 0,
      );
      assert.ok(
        validation.taxonomy.selectedCandidates.every((candidate) => candidate.evidenceCount > 0),
      );
      assert.ok(
        validation.classifications.dimensions.some((dimension) => dimension.assignments > 0),
      );
      assert.ok(validation.classifications.dimensions.some((dimension) => dimension.central > 0));
      const json = execFileSync(
        process.execPath,
        ["--import", "tsx", "src/cli/index.ts", "inspect", "records", "--root", root, "--json"],
        { encoding: "utf8", env: { ...process.env, TYPESAFE_API_KEY: "" } },
      );
      assert.equal(JSON.parse(json).records.length, inspected.records.length);
      const validationJson = execFileSync(
        process.execPath,
        ["--import", "tsx", "src/cli/index.ts", "inspect", "validation", "--root", root, "--json"],
        { encoding: "utf8", env: { ...process.env, TYPESAFE_API_KEY: "" } },
      );
      assert.equal(JSON.parse(validationJson).classifications.records, inspected.records.length);
      assert.deepEqual(JSON.parse(validationJson).projections, validation.projections);
      assert.ok((await readdir(join(root, ".jev"))).every((name) => !name.includes("vector")));
    }));

test("classification failures remain explicit, resume retries only failures, and changed/deleted source is never current", async () =>
  temporary(async (root) => {
    await writeFile(join(root, "source.ts"), "statement();\n".repeat(100));
    const fake = fakeJev();
    let failed = false;
    const client = {
      model: fake.client.model,
      async evaluate(request: Parameters<typeof fake.client.evaluate>[0]) {
        if ("resourceKind" in request.questions && !failed) {
          failed = true;
          throw new Error("controlled failure");
        }
        return fake.client.evaluate(request);
      },
    };
    const first = await onboard(root, client, { concurrency: 1 });
    assert.equal(first.manifest.state, "incomplete");
    assert.equal(first.manifest.failures.length, 1);
    assert.equal(first.manifest.classified, 2);
    const second = await onboard(root, client);
    assert.equal(second.manifest.state, "complete");
    assert.equal(second.manifest.reused, 2);
    assert.equal(second.manifest.classified, 1);
    await writeFile(join(root, "source.ts"), "replacement();\n");
    const stale = await inspectRecords(root);
    assert.equal(stale.records.length, 0);
    assert.equal(stale.stale.length, 3);
    assert.equal(stale.complete, false);
    const validation = await inspectValidation(root);
    assert.equal(validation.complete, false);
    assert.deepEqual(validation.projections, {
      records: 0,
      uniqueDocuments: 0,
      collidingRecords: 0,
      collisionGroups: [],
    });
    const changed = await onboard(root, client);
    assert.equal(changed.manifest.reused, 0);
    await rm(join(root, "source.ts"));
    assert.equal((await inspectRecords(root)).records.length, 0);
    assert.equal((await onboard(root, client)).manifest.expected, 0);
  }));

test("governance failures are retryable, uncertain judgments stay pending, and malformed answers fail", async () =>
  temporary(async (root) => {
    await writeFile(join(root, "a.txt"), "access\n");
    const fake = fakeJev();
    let fail = true;
    const client = {
      model: fake.client.model,
      async evaluate(request: Parameters<typeof fake.client.evaluate>[0]) {
        if (!("resourceKind" in request.questions) && fail)
          throw new Error("governance unavailable");
        const response = await fake.client.evaluate(request);
        for (const answer of Object.values(response.answers))
          if (answer.type === "choice" && answer.choice === "useful") {
            (answer as { confidence: number }).confidence = 0.7;
          }
        return response;
      },
    };
    const first = await onboard(root, client);
    assert.equal(first.manifest.state, "incomplete");
    assert.ok(first.taxonomy.judgments.every((j) => j.status === "failed"));
    fail = false;
    const second = await onboard(root, client);
    assert.equal(second.manifest.state, "complete");
    assert.ok(second.taxonomy.judgments.every((j) => j.status === "pending"));
    assert.equal(second.taxonomy.labels.length, 0);
    const count = fake.calls.length;
    await onboard(root, client);
    assert.equal(fake.calls.length, count);
    const invalid = {
      model: "different-model",
      async evaluate(request: Parameters<typeof fake.client.evaluate>[0]) {
        return { ...(await fake.client.evaluate(request)), model: "different-model", answers: {} };
      },
    };
    const broken = await onboard(root, invalid);
    assert.equal(broken.manifest.state, "incomplete");
    assert.equal(broken.manifest.records.length, 0);
  }));

test("partial limit, exclusive lock, and model changes invalidate reuse", async () =>
  temporary(async (root) => {
    await writeFile(join(root, "a.ts"), "statement();\n".repeat(100));
    const fake = fakeJev();
    const partial = await onboard(root, fake.client, { limit: 1 });
    assert.equal(partial.manifest.state, "incomplete");
    assert.equal(partial.manifest.deferred.length, 2);
    const resumed = await onboard(root, fake.client);
    assert.equal(resumed.manifest.reused, 1);
    assert.equal(resumed.manifest.classified, 2);
    await writeFile(join(root, ".jev", "onboarding.lock"), "locked");
    await assert.rejects(onboard(root, fake.client), /locked/);
    await rm(join(root, ".jev", "onboarding.lock"));
    const evaluate = fake.client.evaluate;
    const newModel = {
      model: "new-pinned-model",
      async evaluate(request: Parameters<typeof evaluate>[0]) {
        return { ...(await evaluate(request)), model: "new-pinned-model" };
      },
    };
    const updated = await onboard(root, newModel);
    assert.equal(updated.manifest.reused, 0);
    assert.equal(updated.manifest.classified, 3);
  }));

test("projection-only changes reuse classification and repair the deterministic projection", async () =>
  temporary(async (root) => {
    await writeFile(join(root, "a.txt"), "access\n");
    const fake = fakeJev();
    const first = await onboard(root, fake.client);
    const path = join(root, ".jev", "records", `${first.manifest.records[0]!.id}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    record.embeddingDocument = "old projection";
    record.provenance.projectionVersion = "old-version";
    await writeFile(path, JSON.stringify(record));
    const calls = fake.calls.length;
    const repaired = await repairProjections(root);
    assert.equal(repaired.repaired, 1);
    assert.equal(repaired.projectionVersion, "semantic-projection-v4");
    assert.equal(fake.calls.length, calls);
    assert.notEqual(JSON.parse(await readFile(path, "utf8")).embeddingDocument, "old projection");
    const unchanged = await repairProjections(root);
    assert.equal(unchanged.unchanged, 1);
    const cli = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli/index.ts", "repair-projections", "--root", root, "--json"],
      { encoding: "utf8", env: { ...process.env, TYPESAFE_API_KEY: "" } },
    );
    assert.equal(cli.status, 0);
    assert.equal(JSON.parse(cli.stdout).unchanged, 1);
  }));

test("missing credentials exit nonzero with labelled stderr and no semantic writes", async () =>
  temporary(async (root) => {
    await writeFile(join(root, "a.txt"), "access\n");
    const response = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli/index.ts", "onboard", root, "--json"],
      { encoding: "utf8", env: { ...process.env, TYPESAFE_API_KEY: "" } },
    );
    assert.equal(response.status, 1);
    assert.equal(response.stdout, "");
    assert.match(response.stderr, /CLI: \[Error\] Missing TYPESAFE_API_KEY/);
    assert.deepEqual(await readdir(root), ["a.txt"]);
  }));
