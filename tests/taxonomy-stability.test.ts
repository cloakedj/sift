import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { Effect } from "effect";
import { harvestCandidates } from "../src/taxonomy/harvest.js";
import { HARVEST_CONFIG, TAXONOMY_ARCHIVE_FILE } from "../src/taxonomy/consts.js";
import { TaxonomyService } from "../src/taxonomy/governance.js";
import type { TaxonomyArchive, TaxonomySnapshot } from "../src/taxonomy/types.js";
import { JevService } from "../src/typesafe/client.js";
import type { JevClient } from "../src/typesafe/types.js";
import type { LocalStore } from "../src/onboarding/types.js";
import { hash } from "../src/shared/utils.js";
import { discoverInventory } from "./support/runtime.js";

async function temporary(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sift-stability-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
/** Governance answers "useful" at a per-name confidence (default: unsuitable); chunks score central. */
function scriptedJev(confidence: (name: string) => number | undefined) {
  const calls: SystemOneRequest<Questions>[] = [];
  const client: JevClient = {
    model: "test-pinned-model",
    async evaluate(request) {
      calls.push(request);
      const state = request.state as { candidates?: { key: string; name: string }[] };
      const answers: Record<string, SystemOneResult<Questions>["answers"][string]> = {};
      for (const [key, question] of Object.entries(request.questions)) {
        if (question.type === "choice" && "useful" in question.criteria) {
          const name = state.candidates!.find((c) => c.key === key)!.name;
          const value = confidence(name);
          const choice = value === undefined ? "unsuitable" : "useful";
          answers[key] = {
            type: "choice",
            choice,
            confidence: value ?? 1,
            probabilities: {
              useful: choice === "useful" ? 1 : 0,
              uncertain: 0,
              unsuitable: choice === "useful" ? 0 : 1,
            },
          };
        } else if (question.type === "choice")
          answers[key] = {
            type: "choice",
            choice: "code",
            confidence: 1,
            probabilities: { code: 1, document: 0, configuration: 0, other: 0 },
          };
        else
          answers[key] = {
            type: "score",
            score: 2,
            confidence: 1,
            legend: { 0: "Not relevant", 1: "Secondary", 2: "Central" },
            probabilities: { 0: 0, 1: 0, 2: 1 },
          };
      }
      return { model: client.model, answers, usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
  return { client, calls };
}
function memoryStore() {
  const files = new Map<string, unknown>();
  const store: LocalStore = {
    read: <T>(path: string) => Effect.succeed(structuredClone(files.get(path)) as T | undefined),
    write: (path, value) => Effect.sync(() => void files.set(path, structuredClone(value))),
    receipt: () => Effect.succeed("receipt"),
  };
  return { files, store };
}
const governanceCalls = (calls: SystemOneRequest<Questions>[]) =>
  calls.filter((c) => (c.state as { candidates?: unknown }).candidates).length;

test("path-ordered selection and evidence do not depend on the checkout location", async () =>
  temporary(async (parent) => {
    const roots = [join(parent, "a", "checkout"), join(parent, "zz-other-place")];
    for (const root of roots) {
      await mkdir(join(root, "src"), { recursive: true });
      for (let i = 0; i < 12; i++)
        await writeFile(
          join(root, "src", `module${i}.ts`),
          `export const Value${i} = SharedThing${i % 3} + OtherName${i};\n`,
        );
    }
    const config = { ...HARVEST_CONFIG, poolPerDimension: 10 };
    const names = async (root: string) => {
      const harvest = harvestCandidates(await discoverInventory(root), config, { pathOrder: true });
      const byId = new Map(harvest.candidates.map((c) => [c.id, c.name]));
      return harvest.selected.map((id) => byId.get(id));
    };
    assert.deepEqual(await names(roots[0]!), await names(roots[1]!));
    const requests: string[] = [];
    for (const root of roots) {
      const jev = scriptedJev((name) => (name === "shared" ? 0.9 : undefined));
      const { store } = memoryStore();
      const inventory = await discoverInventory(root);
      const taxonomy = await Effect.runPromise(
        new TaxonomyService(new JevService(jev.client, false)).govern(
          inventory,
          store,
          false,
          undefined,
          { stable: true, sticky: true },
        ),
      );
      assert.ok(taxonomy.labels.some((label) => label.name === "shared"));
      requests.push(JSON.stringify(jev.calls.map((c) => c.state)));
    }
    assert.equal(requests[0], requests[1]);
  }));

test("sticky governance: archive, promote/keep hysteresis, and labels that leave the pool", async () =>
  temporary(async (root) => {
    const words = Array.from({ length: 260 }, (_, i) => `Term${i.toString(36)}Word`);
    await writeFile(join(root, "big.ts"), `${words.join(" ")}\nexport const alphaValue = 1;\n`);
    const inventory = await discoverInventory(root);
    const levels: Record<string, number> = { alpha: 0.9, value: 0.82 };
    const jev = scriptedJev((name) => levels[name]);
    const { files, store } = memoryStore();
    const service = new TaxonomyService(new JevService(jev.client, false));
    const govern = () =>
      Effect.runPromise(
        service.govern(inventory, store, false, undefined, { stable: true, sticky: true }),
      );
    const first = await govern();
    const names = new Set(first.labels.map((label) => label.name));
    assert.ok(names.has("alpha"), "0.9 >= promote threshold");
    assert.ok(!names.has("value"), "0.82 is below the 0.85 promote threshold");
    // A working snapshot that forgot most judgments (as when candidates leave the pool) is refilled
    // from the archive without new Jev calls.
    const snapshot = files.get("taxonomy.json") as TaxonomySnapshot;
    files.set("taxonomy.json", {
      ...snapshot,
      inputFingerprint: "changed",
      judgments: snapshot.judgments.slice(0, 5),
    });
    const before = governanceCalls(jev.calls);
    const second = await govern();
    assert.equal(governanceCalls(jev.calls), before);
    assert.deepEqual(second.labels, first.labels);
    // An active label whose candidate is harvested but outside the selected pool is kept.
    const outside = first.harvest.candidates.find((c) => !first.harvest.selected.includes(c.id))!;
    assert.ok(outside, "corpus exceeds the candidate pool");
    const archive = files.get(TAXONOMY_ARCHIVE_FILE) as TaxonomyArchive;
    archive.judgments[`concepts:${outside.id}`] = {
      candidateId: outside.id,
      dimension: "concepts",
      fingerprint: "",
      status: "promoted",
      choice: "useful",
      confidence: 0.81,
    };
    const current = files.get("taxonomy.json") as TaxonomySnapshot;
    files.set("taxonomy.json", {
      ...current,
      inputFingerprint: "changed-again",
      labels: [
        ...current.labels,
        { id: hash(`concepts:${outside.name}`), name: outside.name, dimension: "concepts" },
      ],
    });
    const third = await govern();
    assert.ok(third.labels.some((label) => label.name === outside.name));
    assert.ok(third.labels.some((label) => label.name === "alpha"));
  }));

test("stickyEvidenceIds controls how governance evidence names its resource", async () =>
  temporary(async (root) => {
    await writeFile(join(root, "a.ts"), "export const alphaValue = 1;\n");
    const inventory = await discoverInventory(root);
    const seen: Record<string, unknown> = {};
    for (const evidenceIds of ["path", "hash", "none"] as const) {
      const jev = scriptedJev(() => undefined);
      await Effect.runPromise(
        new TaxonomyService(new JevService(jev.client, false)).govern(
          inventory,
          memoryStore().store,
          false,
          undefined,
          { stable: true, sticky: true, evidenceIds },
        ),
      );
      const state = jev.calls[0]!.state as {
        candidates: { evidence: { resourceId?: string }[] }[];
      };
      seen[evidenceIds] = state.candidates[0]!.evidence[0]!.resourceId;
    }
    assert.equal(seen.path, "a.ts");
    assert.equal(seen.hash, inventory.resources[0]!.id);
    assert.equal(seen.none, undefined);
  }));

test("stickyEvidenceIds relhash is identical at two absolute roots and is not the path or the absolute hash", async () => {
  const evidenceAt = async (root: string, evidenceIds: "relhash" | "hash") => {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export const alphaValue = 1;\n");
    const inventory = await discoverInventory(root);
    const jev = scriptedJev(() => undefined);
    await Effect.runPromise(
      new TaxonomyService(new JevService(jev.client, false)).govern(
        inventory,
        memoryStore().store,
        false,
        undefined,
        { stable: true, sticky: true, evidenceIds },
      ),
    );
    const state = jev.calls[0]!.state as {
      candidates: { evidence: { resourceId?: string }[] }[];
    };
    return state.candidates[0]!.evidence[0]!.resourceId;
  };
  const seen: { relhash?: string; hash?: string }[] = [];
  await temporary(async (first) =>
    temporary(async (second) => {
      for (const root of [first, second]) {
        seen.push({
          relhash: await evidenceAt(root, "relhash"),
          hash: await evidenceAt(root, "hash"),
        });
      }
    }),
  );
  const [a, b] = seen;
  assert.ok(a!.relhash !== undefined);
  assert.equal(a!.relhash, b!.relhash);
  assert.equal(a!.relhash, hash("src/a.ts"));
  assert.notEqual(a!.relhash, "src/a.ts");
  assert.notEqual(a!.hash, b!.hash);
  assert.notEqual(a!.relhash, a!.hash);
  assert.notEqual(b!.relhash, b!.hash);
});
