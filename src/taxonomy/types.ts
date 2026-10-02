import type { ErrorDetails } from "../errors/types.js";

export type Dimension =
  | "domains"
  | "concepts"
  | "operations"
  | "dependencies"
  | "risks"
  | "evidenceKinds";
export type CandidateSource = "path" | "heading" | "frontMatter" | "identifier" | "body";
export interface Evidence {
  resourceId: string;
  resourceHash: string;
  source: CandidateSource;
  original: string;
  snippet: string;
  startByte?: number;
  endByte?: number;
  startLine?: number;
  endLine?: number;
}
export interface Candidate {
  id: string;
  name: string;
  evidence: Evidence[];
}
export interface HarvestConfig {
  perResource: Record<CandidateSource, number>;
  poolPerDimension: number;
  rareResourceCount: number;
  rareReservation: number;
  maxLabelLength: number;
  maxSnippetLength: number;
  maxFrontMatterBytes: number;
}
export interface Harvest {
  candidates: Candidate[];
  selected: string[];
  overflow: string[];
  excluded: { name: string; reason: string; resourceId: string }[];
  warnings: { path: string; message: string; details?: ErrorDetails }[];
}
export interface Label {
  id: string;
  name: string;
  dimension: Dimension;
}
export interface Judgment {
  candidateId: string;
  dimension: Dimension;
  fingerprint: string;
  status: "promoted" | "pending" | "unsuitable" | "failed";
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  error?: string;
  errorDetails?: ErrorDetails;
}
export interface TaxonomySnapshot {
  inputFingerprint?: string;
  schemaVersion: 1;
  version: string;
  model: string;
  harvest: Harvest;
  labels: Label[];
  judgments: Judgment[];
}
