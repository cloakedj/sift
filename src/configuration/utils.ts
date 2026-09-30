import { isAbsolute } from "node:path";
import { Errors } from "../errors/index.js";
import type { SiftConfig } from "./types.js";

function object(value: unknown, keys: string[], section: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    Errors.raise("INVALID_ARGUMENT", `Expected an object for ${section}`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key)))
    Errors.raise("INVALID_ARGUMENT", `Unknown option in ${section}`);
  return record;
}

/**
 * Validate without echoing config contents, which may accidentally contain secrets.
 */
export function parseConfig(value: unknown): SiftConfig {
  const config = object(value, ["version", "discovery", "onboarding"], "configuration");
  if (config.version !== 1) Errors.raise("INVALID_ARGUMENT", "Configuration version must be 1");
  if (config.discovery !== undefined) {
    const discovery = object(
      config.discovery,
      ["include", "exclude", "respectGitignore", "hiddenDirectories"],
      "discovery",
    );
    for (const key of ["include", "exclude"]) {
      const patterns = discovery[key];
      if (patterns === undefined) continue;
      if (
        !Array.isArray(patterns) ||
        patterns.some(
          (pattern) =>
            typeof pattern !== "string" ||
            !pattern.trim() ||
            isAbsolute(pattern) ||
            pattern.includes("\\") ||
            pattern.includes("\0") ||
            pattern.split("/").includes("..") ||
            pattern.startsWith("!"),
        )
      )
        Errors.raise(
          "INVALID_ARGUMENT",
          `discovery.${key} must contain relative, non-negated glob patterns`,
        );
    }
    for (const key of ["respectGitignore", "hiddenDirectories"])
      if (discovery[key] !== undefined && typeof discovery[key] !== "boolean")
        Errors.raise("INVALID_ARGUMENT", `discovery.${key} must be a boolean`);
  }
  if (config.onboarding !== undefined) {
    const onboarding = object(
      config.onboarding,
      ["limit", "concurrency", "rerunGovernance"],
      "onboarding",
    );
    for (const key of ["limit", "concurrency"])
      if (
        onboarding[key] !== undefined &&
        (!Number.isSafeInteger(onboarding[key]) || (onboarding[key] as number) < 1)
      )
        Errors.raise("INVALID_ARGUMENT", `onboarding.${key} must be a positive integer`);
    if (onboarding.rerunGovernance !== undefined && typeof onboarding.rerunGovernance !== "boolean")
      Errors.raise("INVALID_ARGUMENT", "onboarding.rerunGovernance must be a boolean");
  }
  return config as unknown as SiftConfig;
}
