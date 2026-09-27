import { Effect, Layer } from "effect";
import { discoverInventory as discover } from "../../src/inventory/index.js";
import { onboard as onboardEffect, OnboardingLive } from "../../src/onboarding/index.js";
import {
  inspectRecords as inspect,
  inspectValidation as validate,
  repairProjections as repair,
} from "../../src/onboarding/inspect.js";
import type { OnboardOptions } from "../../src/onboarding/types.js";
import { LocalRuntimeLive } from "../../src/runtime/index.js";
import { TaxonomyLive } from "../../src/taxonomy/governance.js";
import { Jev, JevService } from "../../src/typesafe/client.js";
import type { JevClient } from "../../src/typesafe/types.js";

// Promise adaptation belongs at the node:test boundary, never in app services.
export const discoverInventory = (...args: Parameters<typeof discover>) =>
  Effect.runPromise(discover(...args).pipe(Effect.provide(LocalRuntimeLive)));
export const inspectRecords = (root: string) =>
  Effect.runPromise(inspect(root).pipe(Effect.provide(LocalRuntimeLive)));
export const inspectValidation = (root: string) =>
  Effect.runPromise(validate(root).pipe(Effect.provide(LocalRuntimeLive)));
export const repairProjections = (root: string) =>
  Effect.runPromise(repair(root).pipe(Effect.provide(LocalRuntimeLive)));
export const onboardingProgram = (root: string, client: JevClient, options: OnboardOptions = {}) =>
  onboardEffect(root, options).pipe(
    Effect.provide(OnboardingLive),
    Effect.provide(TaxonomyLive),
    Effect.provide(Layer.succeed(Jev, new JevService(client, false))),
    Effect.provide(LocalRuntimeLive),
  );
export const onboard = (root: string, client: JevClient, options: OnboardOptions = {}) =>
  Effect.runPromise(onboardingProgram(root, client, options));
