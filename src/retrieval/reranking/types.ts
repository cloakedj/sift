import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";

export interface AssessmentTrace {
  candidateId: string;
  contextIds: string[];
  cache: "reused" | "new";
  usage: { inputTokens: number | null; outputTokens: number | null };
  request: SystemOneRequest<Questions>;
  judgment: RelevanceJudgment;
}

export interface JudgmentCache {
  schemaVersion: 1;
  fingerprint: string;
  response: Pick<SystemOneResult<Questions>, "model" | "answers">;
}

export interface RelevanceJudgment {
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
  questionSetVersion: string;
  fingerprint: string;
}
