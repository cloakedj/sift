import type { QueryIntent } from "../intent/types.js";
import type { SemanticChunkRecord } from "../onboarding/types.js";
import type { PublicationManifest } from "../publication/types.js";

import type { RelevanceJudgment } from "./reranking/types.js";

export interface SearchOptions {
  explain?: boolean;
  topK?: number;
  rerank?: boolean;
  lexicalFallback?: boolean;
}

export interface SearchResult {
  source?: "semantic" | "lexical-fallback";
  relevance?: RelevanceJudgment;
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
  judgments?: { reused: number; new: number };
  ranking: "vector" | "jev-relevance";
  intent?: QueryIntent;
  publication: Pick<
    PublicationManifest,
    "fingerprint" | "namespace" | "embeddingSpace" | "vectorBackend" | "verifiedAt"
  >;
  results: SearchResult[];
  findings: { severity: "info" | "warning" | "error"; message: string }[];
  timings: StageTiming[];
}
