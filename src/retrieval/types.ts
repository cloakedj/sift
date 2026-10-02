import type { QueryIntent } from "../intent/types.js";
import type { SemanticChunkRecord } from "../onboarding/types.js";
import type { PublicationManifest } from "../publication/types.js";

import type { RelevanceJudgment } from "./reranking/types.js";
import type {
  ContextAnchor,
  DiscoverySignal,
  ShortlistStrategy,
  ShortlistSummary,
} from "./discovery/types.js";
import type { RetrievalDiagnostics } from "./diagnostics/types.js";
import type { Relationship, RelationshipBasis } from "../inventory/structure/types.js";

export interface SearchOptions {
  explain?: boolean;
  topK?: number;
  rerank?: boolean;
  discovery?: "hybrid" | "semantic";
  anchors?: readonly ContextAnchor[];
  minRelevance?: number;
  shortlist?: ShortlistStrategy;
  traceChunks?: readonly string[];
}

export interface SearchResult {
  source?: "semantic" | "lexical" | "hybrid" | "anchor";
  discovery?: DiscoverySignal[];
  relevance?: RelevanceJudgment;
  primaryRelevance?: RelevanceJudgment;
  context?: {
    relation: Relationship | "same-file";
    basis?: RelationshipBasis;
    record: Pick<SemanticChunkRecord, "id" | "resource">;
  }[];
  rank: number;
  score: number;
  vectorId: string;
  record: Pick<SemanticChunkRecord, "id" | "resource"> &
    Partial<Pick<SemanticChunkRecord, "taxonomy" | "provenance">>;
}

export interface StageTiming {
  stage: string;
  milliseconds: number;
}

export interface SearchReport {
  schemaVersion: 1;
  root: string;
  query: string;
  reusedIntent: boolean;
  evidence?: {
    state: "supported" | "insufficient" | "not-assessed";
    threshold?: number;
    considered: number;
  };
  candidates?: SearchResult[];
  judgments?: { reused: number; new: number };
  ranking: "vector" | "hybrid" | "jev-relevance";
  execution?: "complete";
  coverage?: {
    scope: "active-publication";
    exhaustive: false;
    totalChunks: number;
    discoveredPrimaryCandidates: number;
    assessedPrimaryCandidates: number;
    boundedChunks: number;
    anchorMatches: number;
    limitations: ("bounded-discovery" | "bounded-expansion" | "unstructured-sources")[];
  };
  truncation?: {
    results: boolean;
    omittedResults: number;
    candidates: boolean;
    omittedCandidates: number;
  };
  budget?: {
    primaryCandidates: number;
    contextCandidates: number;
    contextChunksPerSeed: number;
    contextBytesPerSeed: number;
    seeds: number;
  };
  intent?: QueryIntent;
  shortlist?: ShortlistSummary;
  diagnostics?: RetrievalDiagnostics;
  publication: Pick<
    PublicationManifest,
    "fingerprint" | "namespace" | "embeddingSpace" | "vectorBackend" | "verifiedAt"
  >;
  results: SearchResult[];
  findings: { severity: "info" | "warning" | "error"; message: string }[];
  timings: StageTiming[];
}
