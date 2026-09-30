import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function run(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli/index.ts", "evaluate-relevance", ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TYPESAFE_API_KEY: "",
        CLOUDFLARE_API_TOKEN: "",
        CLOUDFLARE_ACCOUNT_ID: "",
        PATH: "",
      },
    },
  );
}

test("relevance CLI evaluates labeled JSON without credentials, external commands, or writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-relevance-"));
  try {
    const path = join(root, "cases.json");
    const content = JSON.stringify([
      {
        id: "positive",
        relevantIds: ["guide"],
        retrievedIds: ["distractor", "guide"],
        answered: true,
      },
      { id: "negative", relevantIds: [], retrievedIds: ["distractor"], answered: true },
    ]);
    await writeFile(path, content);
    const result = run([path, "--top-k", "2", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      k: 2,
      cases: 2,
      positiveCases: 1,
      negativeCases: 1,
      hitRateAtK: 1,
      meanRecallAtK: 1,
      meanReciprocalRankAtK: 0.5,
      negativeFalseAnswerRate: 1,
      positiveAbstentionRate: 0,
    });
    const text = run([path, "--top-k", "1"]);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /Metrics are not a semantic quality pass/);
    assert.match(text.stdout, /"hitRateAtK": 0/);
    assert.equal(await readFile(path, "utf8"), content);
    assert.deepEqual(await readdir(root), ["cases.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("relevance CLI rejects missing files, malformed JSON, and invalid labels without stdout", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-relevance-invalid-"));
  try {
    const path = join(root, "cases.json");
    const missing = run([path, "--top-k", "2", "--json"]);
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /NOT_FOUND/);
    for (const content of [
      "{",
      "[]",
      "null",
      JSON.stringify([{ id: "x", relevantIds: [], retrievedIds: [] }]),
    ]) {
      await writeFile(path, content);
      const result = run([path, "--top-k", "2", "--json"]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /INVALID_DATA/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("relevance CLI requires one file and an explicit positive cutoff", () => {
  for (const args of [
    [],
    ["cases.json"],
    ["--top-k", "2"],
    ["a.json", "b.json", "--top-k", "2"],
    ["cases.json", "--top-k", "0"],
    ["cases.json", "--top-k", "1.5"],
    ["cases.json", "--top-k", "2", "--root", "."],
  ]) {
    const result = run([...args, "--json"]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /INVALID_ARGUMENT/);
  }
});
