import { TypeSafeClient, type Questions, type SystemOneRequest } from "@typesafe-ai/sdk";
import { Config, Context, Duration, Effect, Layer, Redacted, Schedule } from "effect";
import { Errors } from "../errors/index.js";
import { DEFAULT_MODEL, REQUEST_TIMEOUT, RETRY_POLICY } from "./consts.js";
import type { JevClient } from "./types.js";

// Promise-shaped transport is intentionally confined to the SDK boundary.
class SdkJevClient implements JevClient {
  public constructor(
    private readonly _client: TypeSafeClient,
    public readonly model: string,
  ) {}
  public evaluate(request: SystemOneRequest<Questions>, signal?: AbortSignal) {
    return this._client.systemOne({ ...request, model: this.model }, { signal });
  }
}
export class JevService {
  public constructor(
    private readonly _transport: JevClient,
    private readonly _retry = true,
  ) {}
  public get model() {
    return this._transport.model;
  }
  public evaluate(request: SystemOneRequest<Questions>) {
    const call = Errors.async((signal) => this._transport.evaluate(request, signal), "PROVIDER", {
      model: this.model,
    }).pipe(
      Effect.timeoutFail({
        duration: REQUEST_TIMEOUT,
        onTimeout: () => Errors.create("PROVIDER", "Jev request timed out", { model: this.model }),
      }),
    );
    return this._retry
      ? call.pipe(
          Effect.retry({
            schedule: Schedule.exponential(`${RETRY_POLICY.backoffInitialMs} millis`).pipe(
              Schedule.modifyDelay((_, duration) =>
                Duration.min(duration, Duration.millis(RETRY_POLICY.backoffMaxMs)),
              ),
              Schedule.intersect(Schedule.recurs(RETRY_POLICY.maxRetries)),
            ),
            while: (error) => error.retryable,
          }),
        )
      : call;
  }
}
export class Jev extends Context.Tag("Jev")<Jev, JevService>() {}
export const createJevClient = () =>
  Effect.gen(function* () {
    const apiKey = yield* Config.redacted("TYPESAFE_API_KEY").pipe(
      Effect.mapError(() =>
        Errors.create(
          "CONFIGURATION",
          "Missing TYPESAFE_API_KEY; uncached semantic inference requires Jev.",
        ),
      ),
    );
    if (!Redacted.value(apiKey))
      return yield* Errors.fail(
        "CONFIGURATION",
        "Missing TYPESAFE_API_KEY; uncached semantic inference requires Jev.",
      );
    const model = yield* Config.string("TYPESAFE_DEFAULT_MODEL").pipe(
      Config.withDefault(DEFAULT_MODEL),
      Effect.mapError(() => Errors.create("CONFIGURATION", "Invalid TYPESAFE_DEFAULT_MODEL")),
    );
    if (model.endsWith("latest") || model.endsWith("preview"))
      return yield* Errors.fail(
        "CONFIGURATION",
        "Use a pinned TYPESAFE_DEFAULT_MODEL, not a moving alias.",
      );
    const client = yield* Errors.attempt(
      () =>
        new TypeSafeClient({
          apiKey: Redacted.value(apiKey),
          defaultModel: model,
          retry: { maxRetries: 0 },
          logLevel: "off",
        }),
      "CONFIGURATION",
    );
    // SDK logging is disabled: failures/diagnostics flow through our Effect pipeline.
    return new JevService(new SdkJevClient(client, model));
  });
export const JevLive = Layer.effect(Jev, createJevClient());
