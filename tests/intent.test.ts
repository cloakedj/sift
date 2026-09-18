import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { Effect } from "effect";
import { Intent, IntentLive } from "../src/intent/index.js";
import { Errors } from "../src/errors/index.js";
import { LocalRuntimeLive } from "../src/runtime/index.js";
import { JevService } from "../src/typesafe/client.js";
import type { JevClient } from "../src/typesafe/types.js";
import { candidateTerms } from "../src/intent/utils.js";
import { onboard } from "./support/runtime.js";
import { fakeJev } from "./support/jev.js";

function infer(
  root: string,
  query: string,
  model: string,
  provider: Effect.Effect<JevService, import("../src/errors/index.js").AppError>,
) {
  return Effect.runPromise(
    Effect.flatMap(Intent, (service) => service.infer(root, query, model, provider)).pipe(
      Effect.provide(IntentLive),
      Effect.provide(LocalRuntimeLive),
    ),
  );
}
test("query intent validates cache, invalidates inputs, preserves negatives, and never silently bypasses inference", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-intent-"));
  try {
    await writeFile(join(root, "a.ts"), "credentials();\n");
    await onboard(root, fakeJev().client);
    const taxonomyPath = join(root, ".jev", "taxonomy.json");
    const original = await readFile(taxonomyPath, "utf8");
    let calls = 0;
    const client: JevClient = {
      model: "intent-test-v1",
      async evaluate(request) {
        calls++;
        const answers: Record<
          string,
          Awaited<ReturnType<JevClient["evaluate"]>>["answers"][string]
        > = {};
        for (const [key, question] of Object.entries(request.questions)) {
          if (question.type === "choice") {
            const choice =
              key === "kind"
                ? "find_configuration"
                : key === "shape"
                  ? "configuration"
                  : String(question.instructions).includes("password")
                    ? "negative"
                    : "positive";
            answers[key] = {
              type: "choice",
              choice,
              confidence: 1,
              probabilities: Object.fromEntries(
                Object.keys(question.criteria).map((value) => [value, value === choice ? 1 : 0]),
              ),
            };
          } else if (question.type === "score")
            answers[key] = {
              type: "score",
              score: 2,
              confidence: 1,
              probabilities: { 0: 0, 1: 0, 2: 1 },
              legend: { 0: "Not relevant", 1: "Secondary", 2: "Central" },
            };
        }
        return { model: request.model!, answers, usage: { input_tokens: 1, output_tokens: 1 } };
      },
    };
    const provider = Effect.succeed(new JevService(client, false));
    const query = "credentials without password";
    const first = await infer(root, query, client.model, provider);
    assert.equal(first.reused, false);
    assert.equal(first.retrieval, "not-implemented");
    assert.ok(first.intent.negativeSignals.includes("password"));
    assert.ok(
      !first.intent.embeddingDocument
        .split("\n")
        .find((line) => line.startsWith("Terms:"))!
        .includes("password"),
    );
    const unavailable = Errors.fail("CONFIGURATION", "No provider available");
    const reused = await infer(root, query, client.model, unavailable);
    assert.equal(reused.reused, true);
    assert.deepEqual(reused.intent, first.intent);
    assert.equal(calls, 1);
    await assert.rejects(
      infer(root, "different query", client.model, unavailable),
      /No provider available/,
    );
    await assert.rejects(
      infer(root, query, "intent-test-v2", unavailable),
      /No provider available/,
    );
    const cachePath = join(root, ".jev", "intent", `${first.intent.provenance.fingerprint}.json`);
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    cache.response.answers = {};
    await writeFile(cachePath, JSON.stringify(cache));
    await assert.rejects(infer(root, query, client.model, unavailable), /No provider available/);
    await infer(root, query, client.model, provider);
    assert.equal(calls, 2);
    assert.equal(await readFile(taxonomyPath, "utf8"), original);
    const taxonomy = JSON.parse(original);
    taxonomy.version = "changed-version";
    await writeFile(taxonomyPath, JSON.stringify(taxonomy));
    await assert.rejects(infer(root, query, client.model, unavailable), /No provider available/);
    const malformed = Effect.succeed(
      new JevService(
        {
          model: client.model,
          async evaluate() {
            return {
              model: client.model,
              answers: {},
              usage: { input_tokens: 0, output_tokens: 0 },
            };
          },
        },
        false,
      ),
    );
    await assert.rejects(infer(root, query, client.model, malformed));
    await assert.rejects(infer(root, " ", client.model, provider), /nonempty/);
    await assert.rejects(infer(root, "a".repeat(2049), client.model, provider), /2048/);
    assert.ok(candidateTerms("word ".repeat(100)).length <= 24);
    const cli = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli/index.ts",
        "search",
        query,
        "--show-intent",
        "--root",
        root,
        "--json",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, TYPESAFE_API_KEY: "", TYPESAFE_DEFAULT_MODEL: client.model },
      },
    );
    assert.equal(cli.status, 1);
    assert.equal(cli.stdout, "");
    assert.match(cli.stderr, /Missing TYPESAFE_API_KEY/);
    await writeFile(taxonomyPath, original);
    const cachedCli = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli/index.ts",
        "search",
        query,
        "--show-intent",
        "--root",
        root,
        "--json",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, TYPESAFE_API_KEY: "", TYPESAFE_DEFAULT_MODEL: client.model },
      },
    );
    assert.equal(cachedCli.status, 0, cachedCli.stderr);
    assert.equal(JSON.parse(cachedCli.stdout).reused, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
