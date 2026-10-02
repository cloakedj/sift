import { Effect } from "effect";
import { Errors } from "../errors/index.js";
import type { LocalStore } from "../onboarding/types.js";
import type { MessageService } from "../messages/index.js";
import type { CloudflarePublicationClient } from "./client.js";
import {
  DELETE_VECTOR_BATCH_SIZE,
  GENERATION_RETENTION_MS,
  GET_VECTOR_BATCH_SIZE,
  PUBLICATION_FILE,
} from "./consts.js";
import type { PublicationManifest } from "./types.js";

export class GenerationCleanup {
  public constructor(
    private readonly _store: LocalStore,
    private readonly _client: CloudflarePublicationClient,
    private readonly _messages: MessageService,
  ) {}

  /**
   * Schedule retired vectors after activation, then retry eligible deletions.
   * Ownership and namespace are checked immediately before mutation. Mutation
   * acceptance never proves absence: unconfirmed IDs stay queued across runs.
   * Failures are recorded separately; the active generation remains complete.
   */
  public run(publication: PublicationManifest, now = Date.now()) {
    return Effect.scoped(
      Effect.gen(this, function* () {
        if (publication.state !== "complete" || !publication.verifiedAt || !publication.corpusId)
          return;
        const cleanup = publication.cleanup ?? { pending: [], mutations: [], failures: [] };
        publication.cleanup = cleanup;
        cleanup.failures = [];
        const outcome = yield* Effect.either(
          Effect.gen(this, function* () {
            yield* this._messages.activity(
              "Publication: scheduling and retrying retired-generation cleanup",
            );
            const queued = new Set(cleanup.pending.map((item) => item.id));
            const stale = (publication.reconciliation?.stale ?? []).filter((id) => !queued.has(id));
            for (let offset = 0; offset < stale.length; offset += GET_VECTOR_BATCH_SIZE) {
              const remote = yield* this._client.getVectors(
                stale.slice(offset, offset + GET_VECTOR_BATCH_SIZE),
              );
              for (const vector of remote) {
                if (
                  vector.metadata.corpus_id === publication.corpusId &&
                  vector.namespace !== publication.namespace &&
                  !publication.published.includes(vector.id)
                ) {
                  cleanup.pending.push({
                    id: vector.id,
                    notBefore: new Date(now + GENERATION_RETENTION_MS).toISOString(),
                  });
                }
              }
            }
            yield* this._store.write(PUBLICATION_FILE, publication);
            const eligible = cleanup.pending
              .filter((item) => Date.parse(item.notBefore) <= now)
              .map((item) => item.id);
            for (let offset = 0; offset < eligible.length; offset += DELETE_VECTOR_BATCH_SIZE) {
              const ids = eligible.slice(offset, offset + DELETE_VECTOR_BATCH_SIZE);
              const remote = yield* this._client.getVectors(ids);
              const present = new Set(remote.map((vector) => vector.id));
              // Fail closed on changed ownership. Never delete current or foreign vectors.
              const owned = remote.filter(
                (vector) =>
                  vector.metadata.corpus_id === publication.corpusId &&
                  vector.namespace !== publication.namespace &&
                  !publication.published.includes(vector.id),
              );
              if (owned.length !== remote.length)
                return yield* Errors.fail(
                  "INVALID_DATA",
                  "Retired vector ownership changed; cleanup refused",
                );
              this._forget(publication, new Set(ids.filter((id) => !present.has(id))));
              if (owned.length) {
                cleanup.mutations.push(
                  yield* this._client.deleteVectors(owned.map((vector) => vector.id)),
                );
                yield* this._store.write(PUBLICATION_FILE, publication);
                const remaining = new Set(
                  (yield* this._client.getVectors(owned.map((vector) => vector.id))).map(
                    (vector) => vector.id,
                  ),
                );
                this._forget(publication, new Set(ids.filter((id) => !remaining.has(id))));
              }
              yield* this._store.write(PUBLICATION_FILE, publication);
            }
          }),
        );
        if (outcome._tag === "Left") cleanup.failures.push(Errors.serialize(outcome.left));
        yield* this._store.write(PUBLICATION_FILE, publication);
      }),
    );
  }

  private _forget(publication: PublicationManifest, absent: Set<string>): void {
    if (publication.cleanup)
      publication.cleanup.pending = publication.cleanup.pending.filter(
        (item) => !absent.has(item.id),
      );
    publication.supersededIds = publication.supersededIds?.filter((id) => !absent.has(id));
    if (publication.reconciliation)
      publication.reconciliation.stale = publication.reconciliation.stale.filter(
        (id) => !absent.has(id),
      );
  }
}
