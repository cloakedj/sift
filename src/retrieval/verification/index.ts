import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect } from "effect";
import type { FileSystemService } from "../../filesystem/index.js";
import { VERIFICATION_FILE, VERIFICATION_SCHEMA_VERSION, VERIFICATION_TTL_MS } from "./consts.js";
import type { VerificationEntry } from "./types.js";

/**
 * The verified Cloudflare target of one publication under one configuration. Cache failures
 * never fail a search: unreadable or expired entries are misses and writes are best effort.
 */
export class VerificationCache {
  public constructor(
    private readonly _stateDirectory: string,
    private readonly _fs: FileSystemService,
    private readonly _now = () => Date.now(),
  ) {}

  public get(key: string) {
    return this._fs.readJson<VerificationEntry>(join(this._stateDirectory, VERIFICATION_FILE)).pipe(
      Effect.map((entry) => {
        const age = entry ? this._now() - Date.parse(entry.verifiedAt) : NaN;
        return entry?.schemaVersion === VERIFICATION_SCHEMA_VERSION &&
          entry.key === key &&
          typeof entry.accountId === "string" &&
          entry.accountId &&
          age >= 0 &&
          age < VERIFICATION_TTL_MS
          ? entry
          : undefined;
      }),
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
  }

  public put(key: string, target: { accountId: string; vectorizeIndex: string; model: string }) {
    const entry: VerificationEntry = {
      schemaVersion: VERIFICATION_SCHEMA_VERSION,
      key,
      accountId: target.accountId,
      index: target.vectorizeIndex,
      model: target.model,
      verifiedAt: new Date(this._now()).toISOString(),
    };
    const temporary = join(this._stateDirectory, `.${VERIFICATION_FILE}.${randomUUID()}.tmp`);
    return Effect.gen(this, function* () {
      yield* this._fs.mkdir(this._stateDirectory);
      yield* this._fs.write(temporary, JSON.stringify(entry), true);
      yield* this._fs.rename(temporary, join(this._stateDirectory, VERIFICATION_FILE));
    }).pipe(Effect.catchAll(() => this._fs.remove(temporary).pipe(Effect.ignore)));
  }

  public clear() {
    return this._fs
      .remove(join(this._stateDirectory, VERIFICATION_FILE))
      .pipe(Effect.catchAll(() => Effect.void));
  }
}
