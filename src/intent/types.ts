import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import type { Dimension } from "../taxonomy/types.js";
import type { INTENT_KINDS, ANSWER_SHAPES } from "./consts.js";
export interface QueryIntent {
  schemaVersion: 1;
  rawQuery: string;
  kind: keyof typeof INTENT_KINDS;
  expectedAnswerShape?: Exclude<keyof typeof ANSWER_SHAPES, "unspecified">;
  confidence: number;
  positiveTerms: string[];
  negativeSignals: string[];
  unmatchedCandidates: string[];
  taxonomy: Record<
    Dimension,
    { labelId: string; name: string; score: number; confidence: number }[]
  >;
  embeddingDocument: string;
  provenance: {
    model: string;
    taxonomyVersion: string;
    questionSetVersion: string;
    fingerprint: string;
  };
}
export interface IntentCache {
  schemaVersion: 1;
  fingerprint: string;
  response: SystemOneResult<Questions>;
}
