export type ContextAnchor =
  | { kind: "literal"; value: string }
  | { kind: "location"; uri: string; line?: number };

export interface DiscoverySignal {
  source: "semantic" | "lexical" | "anchor";
  rank: number;
  score?: number;
}
