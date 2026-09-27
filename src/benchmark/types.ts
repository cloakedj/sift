export type ScaleCorpusKind = "code" | "text" | "mixed";

export interface ScaleCorpusOptions {
  chunks: number;
  kind?: ScaleCorpusKind;
}

export interface ScaleCorpusReport {
  root: string;
  kind: ScaleCorpusKind;
  requestedChunks: number;
  files: number;
  estimatedChunks: number;
}

export interface TimingSample {
  stage: string;
  milliseconds: number;
}

export interface TimingSummary {
  stage: string;
  samples: number;
  p50Milliseconds: number;
  p95Milliseconds: number;
  minMilliseconds: number;
  maxMilliseconds: number;
}

export interface TimingSummaryReport {
  files: string[];
  reports: number;
  summaries: TimingSummary[];
}
