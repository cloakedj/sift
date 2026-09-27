import type { Questions, SystemOneRequest } from "@typesafe-ai/sdk";
import { hash } from "../../shared/utils.js";

export function requestFingerprint(
  request: SystemOneRequest<Questions>,
  questionSetVersion: string,
) {
  return hash(JSON.stringify({ questionSetVersion, request }));
}
