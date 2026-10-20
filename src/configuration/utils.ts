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
  const config = object(
    value,
    ["version", "discovery", "onboarding", "publication", "search"],
    "configuration",
  );
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
      [
        "limit",
        "concurrency",
        "rerunGovernance",
        "labelCache",
        "stableTaxonomy",
        "stickyTaxonomy",
        "stickyPromoteConfidence",
        "stickyEvidenceIds",
      ],
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
    for (const key of ["labelCache", "stableTaxonomy", "stickyTaxonomy"])
      if (onboarding[key] !== undefined && typeof onboarding[key] !== "boolean")
        Errors.raise("INVALID_ARGUMENT", `onboarding.${key} must be a boolean`);
    if (
      onboarding.stickyPromoteConfidence !== undefined &&
      (typeof onboarding.stickyPromoteConfidence !== "number" ||
        !(onboarding.stickyPromoteConfidence > 0 && onboarding.stickyPromoteConfidence <= 1))
    )
      Errors.raise(
        "INVALID_ARGUMENT",
        "onboarding.stickyPromoteConfidence must be a number in (0, 1]",
      );
    if (
      onboarding.stickyEvidenceIds !== undefined &&
      !["path", "hash", "relhash", "none"].includes(onboarding.stickyEvidenceIds as string)
    )
      Errors.raise(
        "INVALID_ARGUMENT",
        'onboarding.stickyEvidenceIds must be "path", "hash", "relhash" or "none"',
      );
  }
  if (config.publication !== undefined) {
    const publication = object(
      config.publication,
      ["concurrency", "upsertBatchSize", "fastNoChange", "waitForMutations"],
      "publication",
    );
    if (
      publication.concurrency !== undefined &&
      (!Number.isInteger(publication.concurrency) ||
        (publication.concurrency as number) < 1 ||
        (publication.concurrency as number) > 32)
    )
      Errors.raise("INVALID_ARGUMENT", "publication.concurrency must be an integer from 1 to 32");
    if (
      publication.upsertBatchSize !== undefined &&
      (!Number.isInteger(publication.upsertBatchSize) ||
        (publication.upsertBatchSize as number) < 1 ||
        (publication.upsertBatchSize as number) > 1000)
    )
      Errors.raise(
        "INVALID_ARGUMENT",
        "publication.upsertBatchSize must be an integer from 1 to 1000",
      );
    for (const key of ["fastNoChange", "waitForMutations"])
      if (publication[key] !== undefined && typeof publication[key] !== "boolean")
        Errors.raise("INVALID_ARGUMENT", `publication.${key} must be a boolean`);
  }
  if (config.search !== undefined) {
    const search = object(config.search, ["fusion", "verifyCache"], "search");
    if (search.verifyCache !== undefined && typeof search.verifyCache !== "boolean")
      Errors.raise("INVALID_ARGUMENT", "search.verifyCache must be a boolean");
    if (search.fusion !== undefined) {
      const fusion = object(
        search.fusion,
        [
          "method",
          "lexicalScorer",
          "rrfK",
          "lexicalWeight",
          "alpha",
          "route",
          "identifierLexicalWeight",
        ],
        "search.fusion",
      );
      if (
        fusion.method !== undefined &&
        !["rrf", "convex", "dense"].includes(fusion.method as string)
      )
        Errors.raise("INVALID_ARGUMENT", "search.fusion.method must be rrf, convex, or dense");
      if (
        fusion.lexicalScorer !== undefined &&
        !["legacy", "bm25"].includes(fusion.lexicalScorer as string)
      )
        Errors.raise("INVALID_ARGUMENT", "search.fusion.lexicalScorer must be legacy or bm25");
      for (const [key, min, max] of [
        ["rrfK", 1, 1000],
        ["lexicalWeight", 0, 10],
        ["identifierLexicalWeight", 0, 10],
        ["alpha", 0, 1],
      ] as const) {
        const value = fusion[key];
        if (
          value !== undefined &&
          (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
        )
          Errors.raise(
            "INVALID_ARGUMENT",
            `search.fusion.${key} must be between ${min} and ${max}`,
          );
      }
      if (fusion.route !== undefined && typeof fusion.route !== "boolean")
        Errors.raise("INVALID_ARGUMENT", "search.fusion.route must be a boolean");
    }
  }
  return config as unknown as SiftConfig;
}
