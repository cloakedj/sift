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

export interface DiscoveryOptions {
  strategy?: ShortlistStrategy;
  traceChunks?: readonly string[];
}

export interface DiscoverySignal {
  source: "semantic" | "lexical" | "anchor";
  rank: number;
  score?: number;
}
