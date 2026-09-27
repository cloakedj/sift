import type { ErrorDetails } from "../../errors/types.js";
import type { RelevanceCase, RelevanceEvaluation } from "../relevance/types.js";
import type { SearchOptions, SearchReport } from "../../retrieval/types.js";
import type { Effect } from "effect";
import type { AppError } from "../../errors/index.js";

export interface BenchmarkSearch {
  search(
    root: string,
    query: string,
    options: SearchOptions,
  ): Effect.Effect<SearchReport, AppError>;
}

export interface LabeledCorpus {
  scope: string;
  files: Record<string, string>;
  chunks: { key: string; path: string; startLine: number; endLine: number }[];
  cases: { id: string; query: string; relevant: string[]; rationale: string }[];
}

export interface RelevanceSuite {
  schemaVersion: 1;
  corpora: LabeledCorpus[];
}

export interface RelevanceRunOptions {
  topK: number;
  rerank: boolean;
  policy: "answer-if-any" | "rerank-min-relevance";
  minRelevance?: number;
}

export interface RelevanceRunReport {
  schemaVersion: 1;
  suiteHash: string;
  startedAt: string;
  finishedAt: string;
  options: RelevanceRunOptions;
  policyKind: "hypothetical-baseline" | "explicit-threshold-experiment";
  complete: boolean;
  outcomes: ({ id: string; scope: string; query: string } & (
    | { state: "succeeded"; evaluation: RelevanceCase; search: SearchReport }
    | { state: "failed"; error: ErrorDetails }
  ))[];
  currencyFailures: { scope: string; error: ErrorDetails }[];
  metrics: RelevanceEvaluation | null;
}
