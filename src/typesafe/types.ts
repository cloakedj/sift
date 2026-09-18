import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
export interface JevClient {
  readonly model: string;
  evaluate(
    request: SystemOneRequest<Questions>,
    signal?: AbortSignal,
  ): Promise<SystemOneResult<Questions>>;
}
