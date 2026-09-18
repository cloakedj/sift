import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverInventory } from "./support/runtime.js";
import { harvestCandidates } from "../src/taxonomy/harvest.js";
import { HARVEST_CONFIG } from "../src/taxonomy/consts.js";
import { identifierForms, normalizeLabel } from "../src/taxonomy/utils.js";

async function temporary(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "jev-taxonomy-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("harvesting captures source spans, front matter and Unicode without treating positions as labels", async () =>
  temporary(async (root) => {
    const text =
      '---\ntitle: "Session recovery"\ntags: [access, recovery, "two, words"]\nkeywords:\n  - identity\n---\n# Café access\n\nRevokeSession tokens. Restore identity!\n';
    await writeFile(join(root, "sessionGuide.mdx"), text);
    const inventory = await discoverInventory(root);
    const harvest = harvestCandidates(inventory);
    assert.deepEqual(harvest.warnings, []);
    for (const label of [
      "session recovery",
      "access",
      "recovery",
      "two, words",
      "identity",
      "café access",
      "revoke",
      "session",
    ])
      assert.ok(
        harvest.candidates.some((c) => c.name === label),
        label,
      );
    const heading = harvest.candidates.find((c) => c.name === "café access")!;
    const evidence = heading.evidence.find((e) => e.source === "heading")!;
    assert.equal(
      Buffer.from(text).subarray(evidence.startByte, evidence.endByte).toString("utf8"),
      "# Café access\n",
    );
    assert.equal(evidence.startLine, 7);
    assert.equal(evidence.endLine, 7);
    assert.ok(!harvest.candidates.some((c) => c.name === "tokens restore"));
    assert.equal(normalizeLabel("CAFE\u0301"), "café");
    assert.deepEqual(identifierForms("HTTPServer_name"), [
      "HTTPServer_name",
      "HTTP",
      "Server",
      "name",
    ]);
  }));

test("unsafe, malformed or oversized front matter warns without excluding the document", async () =>
  temporary(async (root) => {
    await writeFile(
      join(root, "alias.md"),
      "---\ntitle: &alias secret\ntags: *alias\n---\n# Still present\n",
    );
    await writeFile(
      join(root, "nested.md"),
      "---\ntags:\n  deep:\n    value: nested\n---\n# Still present\n",
    );
    await writeFile(
      join(root, "large.md"),
      `---\ntitle: ${"a".repeat(17_000)}\n---\n# Still present\n`,
    );
    const inventory = await discoverInventory(root);
    const harvest = harvestCandidates(inventory);
    assert.equal(inventory.resources.length, 3);
    assert.equal(harvest.warnings.length, 3);
    assert.ok(harvest.candidates.some((c) => c.name === "still present"));
    assert.ok(!harvest.candidates.some((c) => c.evidence.some((e) => e.source === "frontMatter")));
    assert.ok(harvest.excluded.some((entry) => entry.reason.includes("code-point")));
  }));

test("selection reserves rare explicit labels, shows overflow, deduplicates, and ignores discovery order", async () =>
  temporary(async (root) => {
    for (let i = 0; i < 4; i++)
      await writeFile(
        join(root, `resource${i}.md`),
        `# Rare ${i}\n\ncommon phrase repeated common phrase repeated\n`,
      );
    const inventory = await discoverInventory(root);
    const config = {
      ...HARVEST_CONFIG,
      poolPerDimension: 4,
      perResource: { path: 1, heading: 1, frontMatter: 1, identifier: 1, body: 1 },
    };
    const harvest = harvestCandidates(inventory, config);
    const reversed = harvestCandidates(
      {
        ...inventory,
        resources: [...inventory.resources].reverse(),
        chunks: [...inventory.chunks].reverse(),
      },
      config,
    );
    assert.deepEqual(harvest.selected, reversed.selected);
    assert.equal(harvest.selected.length, 4);
    assert.equal(new Set(harvest.selected).size, 4);
    assert.ok(harvest.overflow.length > 0);
    assert.ok(
      harvest.selected.some((id) =>
        harvest.candidates.find((c) => c.id === id)!.name.startsWith("rare"),
      ),
    );
    assert.equal(harvest.candidates.filter((c) => c.name === "common").length, 1);
  }));
