import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { Errors } from "../errors/index.js";
import { FileSystem, type FileSystemService } from "../filesystem/index.js";
import type { LocalStore, Receipt } from "./types.js";

export class StateStore implements LocalStore {
  public constructor(
    private readonly _directory: string,
    private readonly _runId: string,
    private readonly _fs: FileSystemService,
    private readonly _receiptSemaphore: Effect.Semaphore,
  ) {}
  public read<T>(path: string) {
    return this._fs.readJson<T>(join(this._directory, path));
  }
  /**
   * Publish JSON by atomic rename and remove temporary files even after failure.
   */
  public write(path: string, value: unknown) {
    return Effect.scoped(
      Effect.gen(this, function* () {
        const destination = join(this._directory, path);
        const temporary = `${destination}.${randomUUID()}.tmp`;
        const content = yield* Errors.attempt(
          () => JSON.stringify(value, null, 2),
          "INVALID_DATA",
          { path },
        );
        // Register cleanup even if writing the temporary file fails part-way.
        yield* Effect.acquireRelease(Effect.void, () =>
          this._fs.remove(temporary).pipe(Effect.orDie),
        );
        yield* this._fs.write(temporary, content, true);
        yield* this._fs.rename(temporary, destination);
      }),
    );
  }
  public receipt(subject: Receipt["subject"], action: Receipt["action"]) {
    return this._receiptSemaphore.withPermits(1)(
      Effect.gen(this, function* () {
        const receipt: Receipt = {
          id: randomUUID(),
          runId: this._runId,
          timestamp: new Date().toISOString(),
          subject,
          action,
        };
        const content = yield* Errors.attempt(() => JSON.stringify(receipt), "INVALID_DATA");
        yield* this._fs.append(
          join(this._directory, "receipts", `${this._runId}.jsonl`),
          `${content}\n`,
        );
        return receipt.id;
      }),
    );
  }
}
export class StoreService {
  public constructor(private readonly _fs: FileSystemService) {}
  public directory(root: string) {
    return Effect.gen(this, function* () {
      const path = resolve(root);
      const info = yield* this._fs.stat(path);
      if (info.isSymbolicLink())
        return yield* Errors.fail("UNSAFE_PATH", "Onboarding root cannot be a symlink", { path });
      return join(info.isDirectory() ? path : dirname(path), ".jev");
    });
  }
  /**
   * Acquire a single-writer lock for the scope; failed acquisition must never
   * release another run's lock. Reject symlinked state directories before writing.
   */
  public open(root: string, runId: string) {
    return Effect.gen(this, function* () {
      const directory = yield* this.directory(root);
      for (const path of [directory, join(directory, "records"), join(directory, "receipts")]) {
        yield* this._fs.mkdir(path);
        if ((yield* this._fs.stat(path)).isSymbolicLink())
          return yield* Errors.fail("UNSAFE_PATH", "Refusing a symlinked state directory", {
            path,
          });
      }
      const lock = join(directory, "onboarding.lock");
      yield* Effect.acquireRelease(
        this._fs.write(lock, JSON.stringify({ pid: process.pid, runId }), true).pipe(
          Effect.catchIf(
            (error) => error.metadata.nativeCode === "EEXIST",
            () =>
              Errors.fail(
                "STORE_LOCKED",
                `Onboarding is locked. If its process has stopped, remove ${lock} to resume.`,
                { path: lock },
              ),
          ),
        ),
        () => this._fs.remove(lock).pipe(Effect.orDie),
      );
      return new StateStore(directory, runId, this._fs, yield* Effect.makeSemaphore(1));
    });
  }
}
export class Stores extends Context.Tag("Stores")<Stores, StoreService>() {}
export const StoresLive = Layer.effect(
  Stores,
  Effect.map(FileSystem, (fs) => new StoreService(fs)),
);
