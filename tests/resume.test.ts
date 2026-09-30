import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { onboard, inspectRecords } from "./support/runtime.js";
import { fakeJev } from "./support/jev.js";

test("single-file onboarding resumes saved records after an unfinished manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-resume-"));
  try {
    const source = join(root, "single.txt");
    await writeFile(source, "identity\n");
    const fake = fakeJev();
    await onboard(source, fake.client);
    const path = join(root, ".sift", "index.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    // Simulate interruption after the durable record write, before final manifest publication.
    manifest.state = "running";
    manifest.records = [];
    await writeFile(path, JSON.stringify(manifest));
    assert.equal((await inspectRecords(source)).complete, false);
    const calls = fake.calls.length;
    const resumed = await onboard(source, fake.client);
    assert.equal(resumed.manifest.state, "complete");
    assert.equal(resumed.manifest.reused, 1);
    assert.equal(fake.calls.length, calls);
    assert.equal((await inspectRecords(source)).complete, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
