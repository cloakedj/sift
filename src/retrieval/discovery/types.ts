export type ContextAnchor =
  | { kind: "literal"; value: string }
  | { kind: "location"; uri: string; line?: number };

export type ShortlistStrategy = "ranked" | "diversified";

export interface ShortlistSummary {
  strategy: ShortlistStrategy | "semantic";
  poolCandidates: number;
  lexicalPoolLimit: number;
}

export interface DiscoveryTrace {
  id: string;
  semanticRank?: number;
  lexicalRank?: number;
  anchorRank?: number;
  inPool: boolean;
  shortlisted: boolean;
}

/**
 * Hybrid fusion of the semantic and lexical lanes. Defaults: unweighted RRF-60 over
 * the BM25 lexical scorer; "legacy" restores the previous term/substring scorer.
 */
export interface FusionOptions {
  /** "rrf": weighted reciprocal ranks; "convex": normalized-score blend; "dense": semantic + anchors only. */
  method?: "rrf" | "convex" | "dense";
  /** Lexical lane scorer: Okapi BM25 over path + text (default), or legacy term/substring points. */
  lexicalScorer?: "legacy" | "bm25";
  /** RRF offset k (default 60). */
  rrfK?: number;
  /** Lexical lane weight relative to semantic weight 1 (rrf) or lexical share 1-alpha (convex uses alpha). */
  lexicalWeight?: number;
  /** Convex blend: alpha * normalized semantic + (1 - alpha) * normalized lexical. */
  alpha?: number;
  /** Use identifierLexicalWeight for identifier-like queries and lexicalWeight otherwise. */
  route?: boolean;
  identifierLexicalWeight?: number;
}

/** Search-time lexical lane choice; "none" is dense-only (semantic + anchors). */
export type LexicalScorerChoice = "bm25" | "legacy" | "none";

export const LEXICAL_SCORER_CHOICES: readonly LexicalScorerChoice[] = ["bm25", "legacy", "none"];

/**
 * Apply a per-search lexical scorer override on top of configured fusion options.
 */
export function resolveFusion(
  configured: FusionOptions | undefined,
  lexicalScorer: LexicalScorerChoice | undefined,
): FusionOptions | undefined {
  if (lexicalScorer === undefined) return configured;
  if (lexicalScorer === "none") return { ...configured, method: "dense" };
  return {
    ...configured,
    lexicalScorer,
    method: configured?.method === "dense" ? "rrf" : configured?.method,
  };
}

export interface DiscoveryOptions {
  strategy?: ShortlistStrategy;
  fusion?: FusionOptions;
  traceChunks?: readonly string[];
}

export interface DiscoverySignal {
  source: "semantic" | "lexical" | "anchor";
  rank: number;
  score?: number;
}
