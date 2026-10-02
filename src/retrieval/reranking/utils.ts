import type { Questions, SystemOneRequest } from "@typesafe-ai/sdk";
import { hash } from "../../shared/utils.js";
import type { AssessmentTrace } from "./types.js";

export function reportedTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function reportedUsage(value: unknown): AssessmentTrace["usage"] {
  const usage = typeof value === "object" && value !== null ? value : {};
  return {
    inputTokens: reportedTokenCount("input_tokens" in usage ? usage.input_tokens : undefined),
    outputTokens: reportedTokenCount("output_tokens" in usage ? usage.output_tokens : undefined),
  };
}

export function requestFingerprint(
  request: SystemOneRequest<Questions>,
  questionSetVersion: string,
) {
  return hash(JSON.stringify({ questionSetVersion, request }));
}
