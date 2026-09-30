import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { ConfigurationPath, ConfigurationService } from "../src/configuration/index.js";
import { parseConfig } from "../src/configuration/utils.js";
import { FileSystemService } from "../src/filesystem/index.js";
import { discoverInventory as discover } from "../src/inventory/index.js";
import { Lexical } from "../src/lexical/index.js";
import { LocalRuntimeLive } from "../src/runtime/index.js";
import { configurationArgs } from "../src/cli/utils.js";
import {
  discoverInventory,
  inspectRecords,
  onboard,
  onboardingProgram,
} from "./support/runtime.js";
import { fakeJev } from "./support/jev.js";

async function temporary(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sift-config-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function files(root: string, entries: Record<string, string>) {
  for (const [path, content] of Object.entries(entries)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}
const config = (root: string, value: unknown) =>
  writeFile(join(root, "sift.config.json"), JSON.stringify(value));
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
    encoding: "utf8",
    env: { ...process.env, TYPESAFE_API_KEY: "", CLOUDFLARE_API_TOKEN: "" },
  });

test("strict versioned configuration rejects unknown, invalid and escaping options", () => {
  for (const value of [
    null,
    [],
    {},
    { version: 2 },
    { version: 1, secret: "do-not-echo" },
    { version: 1, discovery: { incldue: [] } },
    ...["*.ts", ["../private/**"], ["/tmp/**"], ["!private/**"], ["a\\b"], [""], [1]].map(
      (include) => ({ version: 1, discovery: { include } }),
    ),
    { version: 1, discovery: { respectGitignore: "true" } },
    ...[0, -1, 1.5, "2", null].map((concurrency) => ({ version: 1, onboarding: { concurrency } })),
    { version: 1, onboarding: { rerunGovernance: "false" } },
  ])
    assert.throws(
      () => parseConfig(value),
      (error: unknown) => {
        assert.ok(error && typeof error === "object" && "code" in error);
        assert.equal(error.code, "INVALID_ARGUMENT");
        assert.ok(!String(error).includes("do-not-echo"));
        return true;
      },
    );
  assert.deepEqual(parseConfig({ version: 1, discovery: { include: [] } }), {
    version: 1,
    discovery: { include: [] },
  });
  assert.deepEqual(configurationArgs(["--config=x.json", "--root", "."]), {
    args: ["--root", "."],
    config: "x.json",
  });
  for (const args of [
    ["--config"],
    ["--config", "--json"],
    ["--config="],
    ["--config=a", "--config=b"],
  ])
    assert.throws(() => configurationArgs(args));
  assert.deepEqual(configurationArgs(["--", "--config=x"]), {
    args: ["--", "--config=x"],
    config: undefined,
  });
});

test("root config selects relative globs, prunes exclusions, retains safety rules and explains skips", async () =>
  temporary(async (root) => {
    await files(root, {
      "src/a.ts": "export const a = 1;",
      "src/nested/b.ts": "export const b = 2;",
      "src/a.test.ts": "test();",
      "src/private/secret.ts": "secret();",
      "docs/readme.md": "hello",
      ".hidden/allowed.txt": "hidden",
      "node_modules/a.ts": "dependency",
      "dist/a.ts": "build",
      ".sift/index.json": "state",
      ".jev/index.json": "legacy",
      ".env": "credential",
      "key.pem": "key",
    });
    await config(root, {
      version: 1,
      discovery: {
        include: [
          "src/**",
          ".hidden/**",
          ".env",
          "key.pem",
          "node_modules/**",
          "dist/**",
          ".sift/**",
          ".jev/**",
        ],
        exclude: ["**/*.test.ts", "src/private/"],
        hiddenDirectories: false,
      },
    });
    const inventory = await discoverInventory(root);
    assert.deepEqual(
      inventory.resources.map((r) => r.path),
      [".hidden/allowed.txt", "src/a.ts", "src/nested/b.ts"],
    );
    assert.equal(inventory.configuration?.path, join(root, "sift.config.json"));
    assert.ok(
      inventory.skipped.some(
        (s) => s.path === "src/private" && s.reason === "excluded by configuration",
      ),
    );
    assert.ok(
      inventory.skipped.some(
        (s) => s.path === "docs/readme.md" && s.reason === "not included by configuration",
      ),
    );
    await config(root, { version: 1, discovery: { include: [] } });
    assert.equal((await discoverInventory(root)).resources.length, 0);
  }));

test("gitignore honors root and nested negation, prunes ignored parents, and is opt-in", async () =>
  temporary(async (root) => {
    await files(root, {
      ".gitignore": "*.txt\ncache/\n!keep.txt\n",
      "keep.txt": "keep",
      "drop.txt": "drop",
      "cache/keep.txt": "pruned",
      "nested/.gitignore": "!nested.txt\nlocal.md\n",
      "nested/nested.txt": "keep nested",
      "nested/local.md": "drop nested",
      "nested/code.ts": "code",
    });
    await config(root, {
      version: 1,
      discovery: { include: ["**/*.txt", "**/*.md", "**/*.ts"], respectGitignore: true },
    });
    assert.deepEqual(
      (await discoverInventory(root)).resources.map((r) => r.path),
      ["keep.txt", "nested/code.ts", "nested/nested.txt"],
    );
    await config(root, { version: 1, discovery: { include: ["**/*.txt"] } });
    assert.equal((await discoverInventory(root)).resources.length, 4);
  }));

test("explicit config is shared, config-relative, required to exist, and never searched in ancestors", async () =>
  temporary(async (root) => {
    await files(root, {
      "src/a.ts": "a();",
      "src/b.txt": "b",
      "custom.json": JSON.stringify({ version: 1, discovery: { include: ["src/*.ts"] } }),
    });
    await config(root, { version: 1, discovery: { include: [] } });
    assert.equal((await discoverInventory(join(root, "src"))).resources.length, 2);
    const selected = await Effect.runPromise(
      discover(join(root, "src")).pipe(
        Effect.provide(LocalRuntimeLive),
        Effect.provideService(ConfigurationPath, join(root, "custom.json")),
      ),
    );
    assert.deepEqual(
      selected.resources.map((r) => r.path),
      ["a.ts"],
    );
    assert.equal((await discoverInventory(join(root, "src/a.ts"))).resources.length, 1);
    const service = new ConfigurationService(new FileSystemService());
    await assert.rejects(
      Effect.runPromise(
        service
          .load(root)
          .pipe(Effect.provideService(ConfigurationPath, join(root, "missing.json"))),
      ),
    );
    await files(root, { "src/custom.json": '{"version":1}' });
    await assert.rejects(
      Effect.runPromise(
        service
          .load(root)
          .pipe(Effect.provideService(ConfigurationPath, join(root, "src/custom.json"))),
      ),
      /Root must be inside/,
    );
  }));

test("CLI dry-run loads config without writes and rejects malformed config with clean JSON stdout", async () =>
  temporary(async (root) => {
    await files(root, { "a.txt": "a", "b.txt": "b" });
    await config(root, {
      version: 1,
      discovery: { include: ["a.txt"] },
      onboarding: { limit: 1, concurrency: 2, rerunGovernance: true },
    });
    const before = await readdir(root);
    const result = cli("onboard", root, "--dry-run", "--json");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(result.stdout).resources.map((r: { path: string }) => r.path),
      ["a.txt"],
    );
    assert.deepEqual(await readdir(root), before);
    await files(root, {
      "alternate.json": JSON.stringify({ version: 1, discovery: { include: ["b.txt"] } }),
    });
    const alternate = cli(
      "onboard",
      root,
      "--dry-run",
      "--config",
      join(root, "alternate.json"),
      "--json",
    );
    assert.equal(alternate.status, 0, alternate.stderr);
    assert.deepEqual(
      JSON.parse(alternate.stdout).resources.map((r: { path: string }) => r.path),
      ["b.txt"],
    );
    await writeFile(join(root, "sift.config.json"), '{"private":"do-not-echo",');
    const invalid = cli("onboard", root, "--dry-run", "--json");
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout, "");
    assert.ok(!invalid.stderr.includes("do-not-echo"));
  }));

test("controlled onboarding merges options and inspection/lexical discovery follow changed scope", async () =>
  temporary(async (root) => {
    await files(root, {
      "a.ts": "export function alpha() { return 1; }",
      "b.ts": "export function beta() { return 2; }",
    });
    await config(root, {
      version: 1,
      discovery: { include: ["*.ts"] },
      onboarding: { limit: 1, concurrency: 1 },
    });
    const fake = fakeJev();
    const limited = await onboard(root, fake.client);
    assert.equal(limited.manifest.state, "incomplete");
    assert.equal(limited.manifest.classified, 1);
    const complete = await onboard(root, fake.client, { limit: 100, concurrency: 2 });
    assert.equal(complete.manifest.state, "complete");
    assert.equal((await inspectRecords(root)).complete, true);
    await Effect.runPromise(
      Effect.flatMap(Lexical, (service) => service.build(root)).pipe(
        Effect.provide(LocalRuntimeLive),
      ),
    );
    await config(root, {
      version: 1,
      discovery: { include: ["a.ts"] },
      onboarding: { rerunGovernance: true },
    });
    const inspected = await inspectRecords(root);
    assert.equal(inspected.complete, false);
    assert.ok(inspected.stale.length > 0);
    const hits = await Effect.runPromise(
      Effect.flatMap(Lexical, (service) => service.search("beta", root)).pipe(
        Effect.provide(LocalRuntimeLive),
      ),
    );
    assert.equal(hits.length, 0);
    const resumed = await onboard(root, fake.client, { rerunGovernance: false });
    assert.equal(resumed.manifest.state, "complete");
    assert.equal((await inspectRecords(root)).complete, true);
    assert.ok((await readdir(root)).includes(".sift"));
    assert.ok(!(await readdir(root)).includes(".jev"));
  }));

test("explicit subroots cannot bypass excluded ancestors and ignore symlinks are not followed", async () =>
  temporary(async (root) => {
    await files(root, {
      "private/nested/a.ts": "export const privateValue = 1;",
      "allowed.ts": "export const allowed = 1;",
      "ignore-source.txt": "*.ts\n",
    });
    await config(root, { version: 1, discovery: { exclude: ["private"], respectGitignore: true } });
    await symlink(join(root, "ignore-source.txt"), join(root, ".gitignore"));
    const selected = await Effect.runPromise(
      discover(join(root, "private/nested")).pipe(
        Effect.provide(LocalRuntimeLive),
        Effect.provideService(ConfigurationPath, join(root, "sift.config.json")),
      ),
    );
    assert.equal(selected.resources.length, 0);
    assert.ok(
      (await discoverInventory(root)).resources.some((resource) => resource.path === "allowed.ts"),
    );
  }));

test("explicit configuration reaches onboarding through the Effect context", async () =>
  temporary(async (root) => {
    await files(root, {
      "a.ts": "export const alpha = 1;",
      "b.ts": "export const beta = 2;",
      "alternate.json": JSON.stringify({ version: 1, discovery: { include: ["a.ts"] } }),
    });
    const result = await Effect.runPromise(
      onboardingProgram(root, fakeJev().client).pipe(
        Effect.provideService(ConfigurationPath, join(root, "alternate.json")),
      ),
    );
    assert.equal(result.manifest.expected, 1);
  }));
