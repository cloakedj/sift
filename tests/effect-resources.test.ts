import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Cause, Effect, Exit } from "effect";
import { Errors } from "../src/errors/index.js";
import { FileSystemService } from "../src/filesystem/index.js";
import { StoreService } from "../src/onboarding/store.js";
import { onboardingProgram } from "./support/runtime.js";
import type { JevClient } from "../src/typesafe/types.js";

test("interrupting a scoped onboarding run aborts provider work and releases its lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-interrupt-"));
  try {
    await writeFile(join(root, "input.txt"), "identity\n");
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted = false;
    const client: JevClient = {
      model: "test-model",
      evaluate(_request, signal) {
        return new Promise((_resolve, reject) => {
          signal!.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(Errors.create("PROVIDER", "Cancelled"));
            },
            { once: true },
          );
          started();
        });
      },
    };
    const controller = new AbortController();
    const running = Effect.runPromiseExit(onboardingProgram(root, client), {
      signal: controller.signal,
    });
    await ready;
    assert.ok((await readdir(join(root, ".sift"))).includes("onboarding.lock"));
    controller.abort();
    const exit = await running;
    assert.ok(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) assert.ok(Cause.isInterruptedOnly(exit.cause));
    assert.equal(aborted, true);
    assert.ok(!(await readdir(join(root, ".sift"))).includes("onboarding.lock"));
    assert.equal(
      JSON.parse(await readFile(join(root, ".sift", "index.json"), "utf8")).state,
      "running",
    );
    assert.deepEqual(await readdir(join(root, ".sift", "records")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class FailingFileSystem extends FileSystemService {
  public override write(path: string, data: string, exclusive = false) {
    const write = super.write(path, data, exclusive);
    return path.endsWith(".tmp")
      ? write.pipe(Effect.zipRight(Errors.fail("IO", "Controlled disk failure", { path })))
      : write;
  }
}

test("failed atomic writes remove temporary files and release the scoped lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-store-failure-"));
  try {
    const stores = new StoreService(new FailingFileSystem());
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* stores.open(root, "test-run");
          yield* store.write("index.json", { fixture: true });
        }),
      ),
    );
    assert.ok(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) assert.equal(Errors.fromCause(exit.cause).code, "IO");
    assert.deepEqual((await readdir(join(root, ".sift"))).sort(), ["receipts", "records"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed lock acquisition never releases another run's lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-owned-lock-"));
  try {
    const stores = new StoreService(new FileSystemService());
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* stores.open(root, "owner");
          const second = yield* Effect.either(Effect.scoped(stores.open(root, "contender")));
          assert.equal(second._tag, "Left");
          if (second._tag === "Left") assert.equal(second.left.code, "STORE_LOCKED");
          const fs = new FileSystemService();
          assert.equal(
            JSON.parse(yield* fs.read(join(root, ".sift", "onboarding.lock"))).runId,
            "owner",
          );
        }),
      ),
    );
    assert.ok(!(await readdir(join(root, ".sift"))).includes("onboarding.lock"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume refuses locks whose writer cannot be proven stopped", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-resume-live-lock-"));
  try {
    const stores = new StoreService(new FileSystemService());
    const lock = join(root, ".sift", "onboarding.lock");
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* stores.open(root, "owner");
          const second = yield* Effect.either(
            Effect.scoped(stores.open(root, "contender", { resume: true })),
          );
          assert.equal(second._tag, "Left");
          if (second._tag === "Left") assert.equal(second.left.code, "STORE_LOCKED");
          const fs = new FileSystemService();
          assert.equal(JSON.parse(yield* fs.read(lock)).runId, "owner");
        }),
      ),
    );
    assert.ok(!(await readdir(join(root, ".sift"))).includes("onboarding.lock"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resume removes only stale process locks and rejects unverifiable locks", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-resume-stale-lock-"));
  try {
    const stores = new StoreService(new FileSystemService());
    const lock = join(root, ".sift", "onboarding.lock");
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* stores.open(root, "initial");
        }),
      ),
    );

    await writeFile(lock, JSON.stringify({ pid: 2147483647, runId: "stale" }));
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* stores.open(root, "replacement", { resume: true });
          const fs = new FileSystemService();
          assert.equal(JSON.parse(yield* fs.read(lock)).runId, "replacement");
        }),
      ),
    );

    await writeFile(lock, "locked");
    const malformed = await Effect.runPromiseExit(
      Effect.scoped(stores.open(root, "unsafe", { resume: true })),
    );
    assert.ok(Exit.isFailure(malformed));
    if (Exit.isFailure(malformed))
      assert.equal(Errors.fromCause(malformed.cause).code, "STORE_LOCKED");
    assert.equal(await readFile(lock, "utf8"), "locked");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
