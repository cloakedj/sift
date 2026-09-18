import type { ERROR_DEFINITIONS } from "./consts.js";
export type ErrorCode = keyof typeof ERROR_DEFINITIONS;
export type ErrorMetadata = Readonly<Record<string, string | number | boolean | null>>;
export interface ErrorDetails {
  readonly code: ErrorCode;
  readonly reason: string;
  readonly message: string;
  readonly metadata: ErrorMetadata;
  readonly retryable: boolean;
}
