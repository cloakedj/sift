import { Cause, Data, Effect, Option } from "effect";
import { ERROR_DEFINITIONS } from "./consts.js";
import type { ErrorCode, ErrorDetails, ErrorMetadata } from "./types.js";

// All specific errors implement the same serializable contract. New error codes
// and subclasses belong here, not scattered through feature scopes.
export class AppError extends Data.TaggedError("AppError")<ErrorDetails> implements ErrorDetails {}

export class Errors {
  public static create(code: ErrorCode, reason: string, metadata: ErrorMetadata = {}): AppError {
    return new AppError({
      code,
      reason,
      message: reason,
      metadata,
      retryable: ERROR_DEFINITIONS[code].retryable,
    });
  }

  public static fail(code: ErrorCode, reason: string, metadata: ErrorMetadata = {}) {
    return Effect.fail(Errors.create(code, reason, metadata));
  }

  // Only synchronous parsers/guards use this escape hatch. Service methods
  // return typed Effect failures instead of throwing.
  public static raise(code: ErrorCode, reason: string, metadata: ErrorMetadata = {}): never {
    throw Errors.create(code, reason, metadata);
  }

  public static normalize(
    cause: unknown,
    code: ErrorCode = "INTERNAL",
    metadata: ErrorMetadata = {},
  ): AppError {
    if (cause instanceof AppError) return cause;
    const nativeCode =
      cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
        ? cause.code
        : undefined;
    const status =
      cause && typeof cause === "object" && "status" in cause && typeof cause.status === "number"
        ? cause.status
        : undefined;
    const error = Errors.create(code, ERROR_DEFINITIONS[code].message, {
      ...metadata,
      ...(nativeCode ? { nativeCode } : {}),
      ...(status ? { status } : {}),
    });
    if (code === "PROVIDER" && status && ![408, 429].includes(status) && status < 500)
      return new AppError({ ...Errors.serialize(error), retryable: false });
    return error;
  }

  public static restore(details: ErrorDetails): AppError {
    return new AppError(Errors.serialize(details));
  }

  public static serialize(error: ErrorDetails): ErrorDetails {
    // Deliberately omit raw causes/stacks/provider bodies/credentials.
    return {
      code: error.code,
      reason: error.reason,
      message: error.message,
      metadata: error.metadata,
      retryable: error.retryable,
    };
  }

  public static fromCause(cause: Cause.Cause<AppError>): AppError {
    const failure = Cause.failureOption(cause);
    if (Option.isSome(failure)) return failure.value;
    const defect = Cause.dieOption(cause);
    if (Option.isSome(defect)) return Errors.normalize(defect.value);
    return Errors.create(
      Cause.isInterruptedOnly(cause) ? "INTERRUPTED" : "INTERNAL",
      Cause.isInterruptedOnly(cause) ? "Operation interrupted" : "Unexpected application failure",
    );
  }

  public static attempt<A>(action: () => A, code: ErrorCode, metadata: ErrorMetadata = {}) {
    return Effect.try({ try: action, catch: (cause) => Errors.normalize(cause, code, metadata) });
  }

  // Promise boundaries only: Node APIs / third-party SDKs. Application
  // orchestration stays in Effect; the signal is forwarded where supported.
  public static async<A>(
    action: (signal: AbortSignal) => PromiseLike<A>,
    code: ErrorCode,
    metadata: ErrorMetadata = {},
  ) {
    return Effect.tryPromise({
      try: action,
      catch: (cause) => Errors.normalize(cause, code, metadata),
    });
  }
}
