import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { Errors } from "../errors/index.js";
import type { FileSystemService } from "../filesystem/index.js";
import type { RunManifest, SemanticChunkRecord } from "../onboarding/types.js";
import type {
  CloudflareConfig,
  PublicationManifest,
  PublicationStatus,
  EmbeddingVector,
  RemoteVector,
  Reconciliation,
} from "./types.js";

export const hashIdentity = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const embeddingSpaceId = (records: SemanticChunkRecord[], model: string) =>
  hashIdentity({
    provider: "cloudflare-workers-ai",
    model,
    dimensions: 768,
    metric: "cosine",
    pooling: "cls",
    preprocessing: "identity-v1",
    role: "symmetric",
    schemas: [...new Set(records.map((record) => record.schemaVersion))].sort(),
    projections: [...new Set(records.map((record) => record.provenance.projectionVersion))].sort(),
  });

export const semanticRecordHash = (record: SemanticChunkRecord) =>
  hashIdentity({
    ...record,
    provenance: { ...record.provenance, runId: undefined, receiptIds: undefined },
  });

export const vectorId = (fingerprint: string, recordId: string) =>
  createHash("sha256").update(`${fingerprint}:${recordId}`).digest("hex");

export const vectorMetadata = (record: SemanticChunkRecord, corpusId: string, spaceId: string) => ({
  corpus_id: corpusId,
  resource_id: record.resource.id,
  chunk_id: record.id,
  semantic_record_version: record.schemaVersion,
  embedding_space_id: spaceId,
  content_hash: record.resource.chunkHash,
  semantic_record_hash: semanticRecordHash(record),
});

export const metadataMatches = (expected: EmbeddingVector, remote: RemoteVector | undefined) =>
  !!remote &&
  remote.namespace === expected.namespace &&
  Object.entries(expected.metadata).every(([key, value]) => remote.metadata[key] === value);

/**
 * Only the current namespace, corpus-tagged vectors, and recorded prior IDs are
 * considered part of this corpus. Stale vectors are reported, never deleted here.
 */
export const reconcileVectors = (
  expected: EmbeddingVector[],
  remote: RemoteVector[],
  namespace: string,
  corpusId: string,
  superseded: string[],
): Reconciliation => {
  const wanted = new Map(expected.map((vector) => [vector.id, vector]));
  const found = new Map(remote.map((vector) => [vector.id, vector]));
  const prior = new Set(superseded);
  return {
    observedAt: new Date().toISOString(),
    missing: expected.filter((vector) => !found.has(vector.id)).map((vector) => vector.id),
    mismatched: expected
      .filter((vector) => found.has(vector.id) && !metadataMatches(vector, found.get(vector.id)))
      .map((vector) => vector.id),
    extra: remote
      .filter((vector) => vector.namespace === namespace && !wanted.has(vector.id))
      .map((vector) => vector.id),
    stale: remote
      .filter(
        (vector) =>
          vector.namespace !== namespace &&
          (vector.metadata.corpus_id === corpusId || prior.has(vector.id)),
      )
      .map((vector) => vector.id),
  };
};

export const publicationFingerprint = (
  root: string,
  records: SemanticChunkRecord[],
  config: Omit<CloudflareConfig, "apiToken">,
) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        version: 3,
        metadataVersion: 1,
        root,
        account: config.accountId,
        index: config.vectorizeIndex,
        model: config.model,
        dimensions: 768,
        pooling: "cls",
        metric: "cosine",
        preprocessing: "identity-v1",
        records: records
          .map((record) => ({
            id: record.id,
            document: record.embeddingDocument,
            provenance: { ...record.provenance, runId: undefined, receiptIds: undefined },
            schema: record.schemaVersion,
            classification: record.classificationFingerprint,
            semanticRecordHash: semanticRecordHash(record),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest("hex");

export const stateDirectory = (fs: FileSystemService, root: string) =>
  Effect.gen(function* () {
    const path = resolve(root);
    const info = yield* fs.stat(path);
    if (info.isSymbolicLink())
      return yield* Errors.fail("UNSAFE_PATH", "Publication root cannot be a symlink", { path });
    return join(info.isDirectory() ? path : dirname(path), ".sift");
  });

export const summarizeStatus = (
  root: string,
  manifest: RunManifest | undefined,
  publication: PublicationManifest | undefined,
): PublicationStatus => {
  const recordsComplete = manifest?.state === "complete";
  const complete = !!(
    recordsComplete &&
    publication?.schemaVersion === 3 &&
    publication.reconciliation &&
    !publication.reconciliation.missing.length &&
    !publication.reconciliation.mismatched.length &&
    !publication.reconciliation.extra.length &&
    publication.state === "complete" &&
    publication.verifiedAt &&
    publication.sourceIndexRunId === manifest?.runId &&
    publication.expected > 0 &&
    new Set(publication.visible).size === publication.expected &&
    publication.visible.every((id) => publication.published.includes(id))
  );
  const findings: PublicationStatus["findings"] = [];
  if (!manifest)
    findings.push({ severity: "error", message: "No semantic index has been created." });
  else if (!recordsComplete)
    findings.push({
      severity: "warning",
      message: "Semantic records are incomplete; publication is not current.",
    });
  if (!publication)
    findings.push({ severity: "info", message: "No vector publication manifest exists." });
  else {
    if (publication.sourceIndexRunId !== manifest?.runId)
      findings.push({
        severity: "warning",
        message: "Vector publication was built from a different semantic index run.",
      });
    findings.push({
      severity: complete ? "info" : "warning",
      message: complete
        ? "Publication was query-visible at the recorded verification time; status does not contact Cloudflare."
        : "Publication is not active: current-source remote visibility is not verified.",
    });
  }
  if (publication?.reconciliation?.stale.length)
    findings.push({
      severity: "warning",
      message: `${publication.reconciliation.stale.length} superseded vectors remain outside the current namespace; no remote deletion was performed.`,
    });
  return {
    root,
    recordsComplete,
    semanticRecords: manifest?.records.length ?? 0,
    publication,
    complete,
    visible: publication?.visible?.length ?? 0,
    stale: publication?.reconciliation?.stale.length ?? 0,
    extra: publication?.reconciliation?.extra.length ?? 0,
    missing: Math.max(
      0,
      (publication?.expected ?? manifest?.expected ?? 0) - (publication?.visible?.length ?? 0),
    ),
    activeEmbeddingSpace: complete ? publication?.embeddingSpace : undefined,
    findings,
  };
};
