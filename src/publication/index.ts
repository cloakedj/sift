import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { Errors } from "../errors/index.js";
import { FileSystem, type FileSystemService } from "../filesystem/index.js";
import { Messages, type MessageService } from "../messages/index.js";
import { StoreService } from "../onboarding/store.js";
import { Inspection, type InspectionService } from "../onboarding/inspect.js";
import {
  EMBEDDING_BATCH_SIZE,
  MAX_EMBEDDING_BYTES,
  GET_VECTOR_BATCH_SIZE,
  PUBLICATION_FILE,
  VISIBILITY_POLL_ROUNDS,
  VISIBILITY_MAX_DELAY_SECONDS,
} from "./consts.js";
import { CloudflareAuthService } from "./auth.js";
import { CloudflarePublicationClient } from "./client.js";
import { EmbeddingCache } from "./embedding-cache.js";
import { GenerationCleanup } from "./cleanup.js";
import type { EmbeddingVector, PublicationManifest, RemoteVector } from "./types.js";
import {
  publicationFingerprint,
  stateDirectory,
  summarizeStatus,
  hashIdentity,
  embeddingSpaceId,
  vectorMetadata,
  metadataMatches,
  reconcileVectors,
  vectorId,
} from "./utils.js";
import type { RunManifest } from "../onboarding/types.js";

export class PublicationService {
  public constructor(
    private readonly _fs: FileSystemService,
    private readonly _inspection: InspectionService,
    private readonly _messages: MessageService,
  ) {}

  /**
   * Resume an immutable generation under the writer lock. Cache embeddings before
   * upsert and require per-vector query visibility before completion. Re-check
   * source currency after polling; never activate stale input.
   */
  public publish(root: string) {
    return Effect.scoped(
      Effect.gen(this, function* () {
        yield* this._messages.activity("Publication: authenticating and inspecting records");
        const config = yield* new CloudflareAuthService().config();
        const client = new CloudflarePublicationClient(config);
        const runId = randomUUID();
        const store = yield* new StoreService(this._fs).open(root, runId);
        const { manifest, records, complete } = yield* this._inspection.records(root);
        if (!complete || records.length === 0)
          return yield* Errors.fail(
            "INCOMPLETE",
            "Nonempty, complete semantic records are required for publication",
          );
        records.sort((a, b) => a.id.localeCompare(b.id));
        // BGE documents a 512-token input limit. This byte guard is an interim
        // policy, not verified tokenizer parity or proof against hosted truncation.
        for (const record of records) {
          if (
            !record.embeddingDocument ||
            Buffer.byteLength(record.embeddingDocument, "utf8") > MAX_EMBEDDING_BYTES
          )
            return yield* Errors.fail(
              "PAYLOAD_LIMIT",
              "Embedding document exceeds the conservative 500-byte guardrail",
              { id: record.id },
            );
        }
        const fingerprint = publicationFingerprint(manifest.root, records, config);
        const publication: PublicationManifest = {
          schemaVersion: 3,
          corpusId: hashIdentity(manifest.root),
          embeddingSpaceId: embeddingSpaceId(records, config.model),
          supersededIds: [],
          fingerprint,
          visible: [],
          root: manifest.root,
          state: "incomplete",
          namespace: fingerprint,
          mutations: [],
          embeddingSpace: {
            provider: "cloudflare-workers-ai",
            model: config.model,
            dimensions: 768,
            pooling: "cls",
            metric: "cosine",
          },
          vectorBackend: {
            provider: "cloudflare-vectorize",
            index: config.vectorizeIndex,
            accountId: config.accountId,
          },
          sourceIndexRunId: manifest.runId,
          expected: records.length,
          published: [],
          failures: [],
          startedAt: new Date().toISOString(),
          finishedAt: "",
        };
        const saved = yield* store.read<PublicationManifest>(PUBLICATION_FILE);
        if (
          saved?.schemaVersion === 3 &&
          saved.fingerprint === fingerprint &&
          Array.isArray(saved.published) &&
          Array.isArray(saved.mutations)
        ) {
          publication.published = saved.published;
          publication.mutations = saved.mutations;
          publication.startedAt = saved.startedAt;
        }
        if (
          saved &&
          saved.root === manifest.root &&
          saved.vectorBackend.accountId === config.accountId &&
          saved.vectorBackend.index === config.vectorizeIndex
        ) {
          publication.cleanup = saved.cleanup;
          publication.supersededIds = [
            ...new Set([
              ...(saved.supersededIds ?? []),
              ...(saved.fingerprint !== fingerprint ? saved.published : []),
            ]),
          ];
        }
        yield* store.write(PUBLICATION_FILE, publication);
        yield* this._messages.activity("Publication: verifying index");
        const outcome = yield* Effect.either(
          Effect.gen(this, function* () {
            yield* client.verifyIndex();
            const progress = yield* Effect.acquireRelease(
              Effect.sync(() =>
                this._messages.progress({
                  label: "Publication vectors",
                  total: records.length,
                  payload: { stage: "embedding and submitting" },
                }),
              ),
              (handle) => Effect.sync(() => handle.stop()),
            );
            const embeddings = new EmbeddingCache(store, client, config.model);
            const allVectors: EmbeddingVector[] = [];
            for (let offset = 0; offset < records.length; offset += EMBEDDING_BATCH_SIZE) {
              progress.update(offset, { stage: "embedding/loading cached batch" });
              const batch = records.slice(offset, offset + EMBEDDING_BATCH_SIZE);
              const cachePath = `publication-${fingerprint}-${offset}.json`;
              const cached = yield* store.read<{ fingerprint: string; vectors: number[][] }>(
                cachePath,
              );
              if (
                cached &&
                (cached.fingerprint !== fingerprint ||
                  !Array.isArray(cached.vectors) ||
                  cached.vectors.length !== batch.length ||
                  cached.vectors.some(
                    (values) =>
                      !Array.isArray(values) ||
                      values.length !== 768 ||
                      !values.every(
                        (value) => typeof value === "number" && Number.isFinite(value),
                      ) ||
                      !values.some((value) => value !== 0),
                  ))
              )
                return yield* Errors.fail("INVALID_DATA", "Invalid cached publication embeddings");
              const vectors = yield* embeddings.load(
                batch.map((record) => record.embeddingDocument),
                cached?.vectors,
              );
              const payload = vectors.map((values, index): EmbeddingVector => {
                const record = batch[index]!;
                return {
                  id: vectorId(fingerprint, record.id),
                  namespace: fingerprint,
                  values,
                  metadata: vectorMetadata(
                    record,
                    publication.corpusId!,
                    publication.embeddingSpaceId!,
                  ),
                };
              });
              allVectors.push(...payload);
              progress.update(offset, { stage: "checking/submitting batch" });
              const remote = new Map(
                (yield* client.getVectors(payload.map((vector) => vector.id))).map((vector) => [
                  vector.id,
                  vector,
                ]),
              );
              const missing = payload.filter(
                (vector) => !metadataMatches(vector, remote.get(vector.id)),
              );
              if (missing.length) publication.mutations.push(yield* client.upsert(missing));
              // Recover IDs already present remotely even if an earlier process
              // stopped after mutation acceptance but before saving its manifest.
              publication.published = [
                ...new Set([...publication.published, ...payload.map((vector) => vector.id)]),
              ];
              yield* store.write(PUBLICATION_FILE, publication);
              progress.update(offset + batch.length, { stage: "submitted or already present" });
            }
            publication.state = "pending";
            yield* store.write(PUBLICATION_FILE, publication);
            for (let attempt = 0; attempt < VISIBILITY_POLL_ROUNDS; attempt++) {
              yield* this._messages.activity(
                `Publication: checking visibility (round ${attempt + 1}/${VISIBILITY_POLL_ROUNDS})`,
              );
              publication.visible = [];
              for (const vector of allVectors)
                if (yield* client.visible(vector)) publication.visible.push(vector.id);
              yield* store.write(PUBLICATION_FILE, publication);
              yield* this._messages.activity(
                `Publication: ${publication.visible.length}/${publication.expected} visible; reconciling or waiting for indexing`,
              );
              if (publication.visible.length === publication.expected) {
                const ids = [
                  ...new Set([
                    ...(yield* client.listVectors()),
                    ...allVectors.map((vector) => vector.id),
                    ...publication.supersededIds!,
                  ]),
                ];
                const remote: RemoteVector[] = [];
                for (let offset = 0; offset < ids.length; offset += GET_VECTOR_BATCH_SIZE)
                  remote.push(
                    ...(yield* client.getVectors(
                      ids.slice(offset, offset + GET_VECTOR_BATCH_SIZE),
                    )),
                  );
                publication.reconciliation = reconcileVectors(
                  allVectors,
                  remote,
                  fingerprint,
                  publication.corpusId!,
                  publication.supersededIds!,
                );
                if (
                  !publication.reconciliation.missing.length &&
                  !publication.reconciliation.mismatched.length &&
                  !publication.reconciliation.extra.length
                )
                  break;
              }
              if (attempt < VISIBILITY_POLL_ROUNDS - 1)
                yield* Effect.sleep(
                  `${Math.min(VISIBILITY_MAX_DELAY_SECONDS, 2 ** attempt)} seconds`,
                );
            }
            yield* this._messages.activity("Publication: checking final source currency");
            const current = yield* this._inspection.records(root);
            if (
              !current.complete ||
              current.manifest.runId !== manifest.runId ||
              publicationFingerprint(current.manifest.root, current.records, config) !== fingerprint
            )
              return yield* Errors.fail(
                "INCOMPLETE",
                "Semantic sources changed during publication",
              );
            if (
              publication.visible.length === publication.expected &&
              publication.reconciliation &&
              !publication.reconciliation.missing.length &&
              !publication.reconciliation.mismatched.length &&
              !publication.reconciliation.extra.length
            ) {
              publication.state = "complete";
              publication.verifiedAt = new Date().toISOString();
            }
          }),
        );
        publication.finishedAt = new Date().toISOString();
        if (outcome._tag === "Left") {
          publication.state = "incomplete";
          publication.failures.push({
            subject: runId,
            error: outcome.left.message,
            details: Errors.serialize(outcome.left),
          });
          yield* store.write(PUBLICATION_FILE, publication);
          return yield* Effect.fail(outcome.left);
        }
        yield* store.write(PUBLICATION_FILE, publication);
        // Activation is durable before cleanup. Cleanup failures must not
        // invalidate a verified replacement or destroy rollback on publish failure.
        if (publication.state === "complete")
          yield* new GenerationCleanup(store, client, this._messages).run(publication);
        return publication;
      }),
    );
  }

  public status(root: string) {
    return Effect.gen(this, function* () {
      const directory = yield* stateDirectory(this._fs, root);
      const manifest = yield* this._fs.readJson<RunManifest>(join(directory, "index.json"));
      const publication = yield* this._fs.readJson<PublicationManifest>(
        join(directory, PUBLICATION_FILE),
      );
      const status = summarizeStatus(root, manifest, publication);
      if (manifest) {
        const current = yield* this._inspection.records(root);
        status.recordsComplete = current.complete;
        status.semanticRecords = current.records.length;
        const matchesPublication =
          publication?.schemaVersion === 3 &&
          publicationFingerprint(current.manifest.root, current.records, {
            accountId: publication.vectorBackend.accountId,
            vectorizeIndex: publication.vectorBackend.index,
            model: publication.embeddingSpace.model,
          }) === publication.fingerprint;
        if (!current.complete || (publication && !matchesPublication)) {
          status.complete = false;
          delete status.activeEmbeddingSpace;
          status.findings.push({
            severity: "warning",
            message: !current.complete
              ? "Source-current semantic records are incomplete, stale, or missing."
              : "Publication does not match the current semantic projections.",
          });
        }
      }
      return status;
    });
  }
}

export class Publication extends Context.Tag("Publication")<Publication, PublicationService>() {}
export const PublicationLive = Layer.effect(
  Publication,
  Effect.gen(function* () {
    return new PublicationService(yield* FileSystem, yield* Inspection, yield* Messages);
  }),
);
export const publishVectors = (root: string) =>
  Effect.flatMap(Publication, (service) => service.publish(root));
export const publicationStatus = (root: string) =>
  Effect.flatMap(Publication, (service) => service.status(root));
