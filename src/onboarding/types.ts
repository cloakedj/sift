import type { ChunkStructure } from "../inventory/structure/types.js";
import type { Effect } from "effect";
import type { AppError } from "../errors/index.js";
import type { ErrorDetails } from "../errors/types.js";
import type { Dimension, TaxonomySnapshot } from "../taxonomy/types.js";
export interface LabelScore {
  labelId: string;
  nameSnapshot: string;
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}
export interface SemanticChunkRecord {
  schemaVersion: 1;
  id: string;
  resource: {
    id: string;
    uri: string;
    mediaType: string;
    language?: string;
    range: { startLine: number; endLine: number; startByte: number; endByte: number };
    resourceHash: string;
    chunkHash: string;
    textPreview: string;
    structure?: ChunkStructure;
  };
  taxonomy: Record<Dimension, LabelScore[]> & { resourceKind?: LabelScore };
  embeddingDocument: string;
  classificationFingerprint: string;
  provenance: {
    runId: string;
    questionSetId: string;
    taxonomyRegistryVersion: string;
    model: string;
    chunkerVersion: string;
    projectionVersion: string;
    receiptIds: string[];
  };
}
export interface RunManifest {
  schemaVersion: 2;
  runId: string;
  root: string;
  state: "running" | "complete" | "incomplete";
  expected: number;
  records: { id: string; resourceHash: string; fingerprint: string }[];
  failures: { subject: string; error: string; details?: ErrorDetails }[];
  deferred: string[];
  taxonomyVersion?: string;
  reused: number;
  classified: number;
  startedAt: string;
  finishedAt?: string;
}
export interface Receipt {
  id: string;
  runId: string;
  timestamp: string;
  subject: { kind: "run" | "candidate" | "chunk"; id: string };
  action: Record<string, unknown>;
}
export interface OnboardOptions {
  limit?: number;
  concurrency?: number;
  rerunGovernance?: boolean;
  resume?: boolean;
}
export interface LocalStore {
  read<T>(path: string): Effect.Effect<T | undefined, AppError>;
  write(path: string, value: unknown): Effect.Effect<void, AppError>;
  receipt(subject: Receipt["subject"], action: Receipt["action"]): Effect.Effect<string, AppError>;
}
export interface QualityFinding {
  severity: "info" | "warning" | "error";
  subject: string;
  message: string;
}
export interface CandidateEvidenceSummary {
  id: string;
  name: string;
  evidenceCount: number;
  resourceCount: number;
  sources: Record<string, number>;
  examples: string[];
}
export interface TaxonomyDimensionSummary {
  dimension: Dimension;
  selected: number;
  promoted: number;
  pending: number;
  unsuitable: number;
  failed: number;
  labels: string[];
}
export interface ClassificationDimensionSummary {
  dimension: Dimension;
  assignments: number;
  central: number;
  secondary: number;
  labelsAssigned: string[];
}
export interface ProjectionSummary {
  records: number;
  uniqueDocuments: number;
  collidingRecords: number;
  collisionGroups: {
    documentHash: string;
    chunks: {
      id: string;
      uri: string;
      range: SemanticChunkRecord["resource"]["range"];
    }[];
  }[];
}
export interface ProjectionRepairReport {
  root: string;
  repaired: number;
  unchanged: number;
  projectionVersion: string;
}
export interface ValidationReport {
  root: string;
  complete: boolean;
  taxonomy: {
    candidates: number;
    selected: number;
    overflow: number;
    excluded: number;
    dimensions: TaxonomyDimensionSummary[];
    selectedCandidates: CandidateEvidenceSummary[];
  };
  classifications: {
    records: number;
    chunksWithoutLabels: string[];
    resourceKinds: Record<string, number>;
    dimensions: ClassificationDimensionSummary[];
  };
  projections: ProjectionSummary;
  findings: QualityFinding[];
}
export interface StageTiming {
  stage: string;
  milliseconds: number;
}
export interface OnboardResult {
  manifest: RunManifest;
  taxonomy: TaxonomySnapshot;
  timings: StageTiming[];
}
