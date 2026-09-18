import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { discoverInventory } from "./support/runtime.js";
import { defaultPolicy, MAX_CHUNK_BYTES, MAX_CHUNK_LINES } from "../src/inventory/consts.js";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const cli = (args: string[]) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli/index.ts", "onboard", ...args, "--dry-run", "--json"],
      {
        encoding: "utf8",
        env: { ...process.env, TYPESAFE_API_KEY: "", CLOUDFLARE_API_TOKEN: "" },
      },
    ),
  );
async function temporary(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "jev-inventory-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const [scope, expected] of Object.entries({
  code: ["session.ts"],
  text: ["handbook.md"],
  mixed: ["operations.txt", "queue.ts"],
})) {
  test(`product CLI inventories ${scope} without writes or credentials`, async () => {
    const root = resolve("tests/fixtures", scope);
    const before = await readdir(root);
    const result = cli(["--root", root]);
    assert.deepEqual(
      result.resources.map((r: { path: string }) => r.path),
      expected,
    );
    assert.ok(result.chunks.length >= expected.length);
    assert.equal(result.inferenceCalls, 0);
    assert.equal(result.published, false);
    assert.equal(result.complete, true);
    assert.deepEqual(result, cli([root]));
    assert.deepEqual(await readdir(root), before);
  });
}

test("privacy exclusions, binary detection, symlinks, and source policy overrides", async () =>
  temporary(async (root) => {
    const excluded = [
      ".env",
      ".env.production",
      "private.pem",
      "server.key",
      "credentials.json",
      "id_ed25519",
      "secrets.yaml",
      "service-account-prod.json",
      "node_modules/pkg/index.js",
      ".hidden/note.md",
      ".git/config",
      ".jev/index.json",
      "dist/output.js",
    ];
    for (const path of [...excluded, "allowed.txt"]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), "fixture content\n");
    }
    await writeFile(join(root, "binary.dat"), Buffer.from([65, 0, 66]));
    await writeFile(join(root, "invalid.txt"), Buffer.from([0xff, 0xfe]));
    await symlink(join(root, "allowed.txt"), join(root, "alias.txt"));
    await symlink(root, join(root, "loop"));
    const result = await discoverInventory(root);
    assert.deepEqual(
      result.resources.map((r) => r.path),
      ["allowed.txt"],
    );
    assert.equal(result.skipped.length, excluded.length + 4);
    assert.equal(result.failures.length, 0);
    const allowedHidden = await discoverInventory(root, {
      ...defaultPolicy,
      hiddenDirectories: false,
    });
    assert.ok(allowedHidden.resources.some((r) => r.path === ".hidden/note.md"));
    const deniedText = await discoverInventory(root, {
      ...defaultPolicy,
      files: new Set([...defaultPolicy.files, "allowed.txt"]),
    });
    assert.equal(deniedText.resources.length, 0);
    assert.equal((await discoverInventory(join(root, ".env"))).resources.length, 0);
  }));

test("large resources and long Unicode lines are bounded, source-linked, and deterministic", async () =>
  temporary(async (root) => {
    const content =
      "😀é".repeat(360_000) +
      "\r\n" +
      Array.from({ length: 110 }, (_, i) => `line ${i}\r\n`).join("");
    const file = join(root, "large.ts");
    await writeFile(file, content);
    const raw = await readFile(file);
    assert.ok(raw.length > 2_000_000);
    const result = await discoverInventory(file);
    assert.equal(result.resources.length, 1);
    assert.equal(result.resources[0]!.resourceHash, sha(raw));
    let covered = 0;
    for (const chunk of result.chunks) {
      assert.ok(chunk.startByte <= covered);
      covered = Math.max(covered, chunk.endByte);
      assert.ok(chunk.endByte - chunk.startByte <= MAX_CHUNK_BYTES);
      assert.ok(chunk.endLine - chunk.startLine + 1 <= MAX_CHUNK_LINES);
      assert.equal(chunk.text, raw.subarray(chunk.startByte, chunk.endByte).toString("utf8"));
      assert.equal(chunk.chunkHash, sha(raw.subarray(chunk.startByte, chunk.endByte)));
      assert.ok(!chunk.text.includes("�"));
    }
    assert.equal(covered, raw.length);
    assert.deepEqual(result, await discoverInventory(file));
    await writeFile(file, content + "changed\n");
    const changed = await discoverInventory(file);
    assert.equal(result.resources[0]!.id, changed.resources[0]!.id);
    assert.notEqual(result.resources[0]!.resourceHash, changed.resources[0]!.resourceHash);
    assert.notEqual(result.chunks.at(-1)!.id, changed.chunks.at(-1)!.id);
  }));

test("code windows overlap, documents respect paragraphs and headings, empty files remain resources", async () =>
  temporary(async (root) => {
    await writeFile(join(root, "code.ts"), "statement();\n".repeat(100));
    await writeFile(
      join(root, "doc.md"),
      "# First\n\nParagraph one.\n\n# Second\nParagraph two.\n",
    );
    await writeFile(join(root, "empty.txt"), "");
    const result = await discoverInventory(root);
    const code = result.chunks.filter((c) => c.path === "code.ts");
    assert.deepEqual(
      code.map((c) => [c.startLine, c.endLine]),
      [
        [1, 48],
        [41, 88],
        [81, 100],
      ],
    );
    assert.deepEqual(
      result.chunks.filter((c) => c.path === "doc.md").map((c) => c.text),
      ["# First\n\n", "Paragraph one.\n\n", "# Second\nParagraph two.\n"],
    );
    assert.equal(result.resources.find((r) => r.path === "empty.txt")!.chunkCount, 0);
  }));

test("late binary detection discards all proposed chunks", async () =>
  temporary(async (root) => {
    await writeFile(join(root, "late.bin"), "valid text\n".repeat(10_000) + "\0");
    const result = await discoverInventory(root);
    assert.equal(result.resources.length, 0);
    assert.equal(result.chunks.length, 0);
    assert.equal(result.skipped.length, 1);
  }));

test("missing credentials and invalid arguments fail explicitly", () => {
  for (const args of [
    [],
    ["--dry-run", "--unknown"],
    ["--dry-run", "a", "b"],
    ["--dry-run", "--root", "a", "b"],
    ["--dry-run", "/nonexistent-jev-fixture"],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli/index.ts", "onboard", ...args],
      { encoding: "utf8", env: { ...process.env, TYPESAFE_API_KEY: "" } },
    );
    assert.notEqual(result.status, 0);
  }
});
