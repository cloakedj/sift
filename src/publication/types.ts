import type { ErrorDetails } from "../errors/types.js";
import type { Effect } from "effect";
import type { AppError } from "../errors/index.js";

export type WranglerCommand = (args: string[]) => Effect.Effect<unknown, AppError>;

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  vectorizeIndex: string;
  model: string;
}

export interface EmbeddingVector {
  id: string;
  namespace: string;
  values: number[];
  metadata: Record<string, string | number | boolean>;
}

export interface RemoteVector {
  id: string;
  namespace: string;
  metadata: Record<string, unknown>;
}

export interface VectorMatch extends RemoteVector {
  score: number;
}

export interface Reconciliation {
  observedAt: string;
  missing: string[];
  mismatched: string[];
  extra: string[];
  stale: string[];
}

export interface PublicationManifest {
  schemaVersion: 2 | 3;
  reconciliation?: Reconciliation;
  supersededIds?: string[];
  corpusId?: string;
  embeddingSpaceId?: string;
  fingerprint: string;
  visible: string[];
  verifiedAt?: string;
  root: string;
  state: "pending" | "incomplete" | "complete";
  namespace: string;
  mutations: string[];
  embeddingSpace: {
    provider: "cloudflare-workers-ai";
    model: string;
    dimensions: number;
    pooling: "cls";
    metric: "cosine";
  };
  vectorBackend: {
    provider: "cloudflare-vectorize";
    index: string;
    accountId: string;
  };
  sourceIndexRunId: string;
  expected: number;
  published: string[];
  failures: { subject: string; error: string; details?: ErrorDetails }[];
  startedAt: string;
  finishedAt: string;
}

export interface PublicationStatus {
  root: string;
  recordsComplete: boolean;
  semanticRecords: number;
  publication?: PublicationManifest;
  activeEmbeddingSpace?: PublicationManifest["embeddingSpace"];
  complete: boolean;
  missing: number;
  visible: number;
  stale: number;
  extra: number;
  findings: { severity: "info" | "warning" | "error"; message: string }[];
}
