import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { CorpusResolver } from "../src/cli/corpus/index.js";
import { ConfigurationPath } from "../src/configuration/index.js";

async function temporary(run: (root: string, child: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "sift-resolution-")));
  const child = join(root, "nested", "child");
  try {
    await mkdir(child, { recursive: true });
    await writeFile(join(root, "sift.config.json"), '{"version":1}');
    await run(root, child);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const cliPath = resolve("src/cli/index.ts");
const loader = resolve("node_modules/tsx/dist/loader.mjs");
const run = (command: string, args: string[], cwd: string, config?: string) =>
  Effect.runPromise(
    new CorpusResolver()
      .resolve(command, args, config, cwd)
      .pipe(Effect.provideService(ConfigurationPath, config)),
  );

test("all corpus commands share nearest ancestor resolution; nested config wins", async () => {
  await temporary(async (root, child) => {
    for (const command of [
      "onboard",
      "inspect",
      "search",
      "publish",
      "status",
      "repair-projections",
      "index",
      "lexical-search",
    ]) {
      const result = await run(command, [], child);
      assert.deepEqual(result.resolution, {
        resolvedRoot: root,
        configPath: join(root, "sift.config.json"),
        stateDirectory: join(root, ".sift"),
      });
      assert.deepEqual(result.args, ["--root", root]);
    }
    await writeFile(join(dirname(child), "sift.config.json"), '{"version":1}');
    assert.equal((await run("search", ["query"], child)).resolution?.resolvedRoot, dirname(child));
  });
});

test("explicit roots, config overrides, opt-out and positional roots retain scope", async () => {
  await temporary(async (root, child) => {
    for (const args of [["--root", child], [`--root=${child}`], ["--no-discover-config"]]) {
      assert.equal((await run("publish", args, child)).resolution?.resolvedRoot, child);
    }
    for (const command of ["onboard", "index"]) {
      const result = await run(command, [child], root);
      assert.equal(result.resolution?.resolvedRoot, child);
      assert.deepEqual(result.args, [child]);
    }
    const result = await run("status", [], child, join(root, "sift.config.json"));
    assert.equal(result.resolution?.resolvedRoot, child);
    assert.equal(result.resolution?.configPath, join(root, "sift.config.json"));
    await rm(join(root, "sift.config.json"));
    assert.equal((await run("status", [], child)).resolution?.resolvedRoot, child);
    assert.deepEqual(await run("help", [], child), { args: [] });
    assert.deepEqual(await run("generate-scale-corpus", [], child), { args: [] });
  });
});

test("option values and query positionals do not become corpus roots", async () => {
  await temporary(async (root, child) => {
    for (const [command, args] of [
      ["onboard", ["--limit", "2", "--concurrency=3", "--dry-run"]],
      ["search", ["--anchor", "one", "--anchor", "two", "--top-k", "5", "--", "--root"]],
    ] as const)
      assert.equal((await run(command, [...args], child)).resolution?.resolvedRoot, root);
    await writeFile(join(root, "file.txt"), "text");
    const result = await run("onboard", [join(root, "file.txt")], child);
    assert.equal(result.resolution?.stateDirectory, join(root, ".sift"));
  });
});

test("invalid and symlinked nearest configs fail instead of falling back", async () => {
  await temporary(async (root, child) => {
    const path = join(child, "sift.config.json");
    await writeFile(path, "not json");
    await assert.rejects(run("status", [], child));
    await rm(path);
    await symlink(join(root, "sift.config.json"), path);
    await assert.rejects(run("status", [], child), /symlinked/);
  });
});

test("CLI reports scope, previews without writes, and shares ancestor lexical assets", async () => {
  await temporary(async (root, child) => {
    await writeFile(join(root, "source.txt"), "hello world");
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, ["--import", loader, cliPath, ...args], {
        cwd: child,
        encoding: "utf8",
      });
    const json = cli("onboard", "--dry-run", "--json");
    assert.equal(json.status, 0, json.stderr);
    const report = JSON.parse(json.stdout);
    assert.equal(report.resolvedRoot, root);
    assert.equal(report.configPath, join(root, "sift.config.json"));
    assert.equal(report.stateDirectory, join(root, ".sift"));
    const human = cli("onboard", "--dry-run");
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout + human.stderr, /Corpus.*Root:/);
    const strict = cli("onboard", "--dry-run", "--json", "--no-discover-config");
    assert.equal(JSON.parse(strict.stdout).resolvedRoot, child);
    assert.ok(!(await readdir(root)).includes(".sift"));
    assert.ok(!(await readdir(child)).includes(".sift"));

    const status = cli("status", "--json");
    assert.equal(JSON.parse(status.stdout).resolvedRoot, root);
    const indexed = cli("index", "--json");
    assert.equal(indexed.status, 0, indexed.stderr);
    assert.equal(JSON.parse(indexed.stdout).stateDirectory, join(root, ".sift"));
    assert.ok((await readdir(root)).includes(".sift"));
    assert.ok(!(await readdir(child)).includes(".sift"));
    const searched = cli("lexical-search", "hello", "--json");
    assert.equal(searched.status, 0, searched.stderr);
    const hits = JSON.parse(searched.stdout);
    assert.equal(hits.resolvedRoot, root);
    assert.equal(hits.results.length, 1);
  });
});
