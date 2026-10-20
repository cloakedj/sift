import type { FusionOptions } from "../retrieval/discovery/types.js";

export interface SiftConfig {
  version: 1;
  discovery?: {
    include?: string[];
    exclude?: string[];
    respectGitignore?: boolean;
    hiddenDirectories?: boolean;
  };
  onboarding?: {
    limit?: number;
    concurrency?: number;
    rerunGovernance?: boolean;
    /** Default true. Reuse Jev answers per (content, question, question-set version, model) instead of per whole request. */
    labelCache?: boolean;
    /** Default true. Reuse taxonomy judgments per candidate identity; only newly harvested candidates are judged. Set false (or use rerunGovernance) to re-judge everything. */
    stableTaxonomy?: boolean;
    /** Default true. Archive every taxonomy judgment, promote new labels at >= 0.85 and keep active ones above 0.7, keep active labels that leave the candidate pool while their term still occurs, and order candidates/evidence by repo-relative path. */
    stickyTaxonomy?: boolean;
    /** Sticky mode only: promotion threshold for new labels (default 0.85). */
    stickyPromoteConfidence?: number;
    /** Sticky mode only: how governance evidence names its resource: "relhash" (default; opaque hash of the repo-relative path), "path" (repo-relative path), "hash" (absolute-URI ID, checkout-dependent) or "none". */
    stickyEvidenceIds?: "path" | "hash" | "relhash" | "none";
  };
  search?: {
    /** Hybrid fusion of semantic and lexical discovery lanes. */
    fusion?: FusionOptions;
    /** Default true. Reuse the Cloudflare index verification of the active publication for up to one hour; re-verified after publish, configuration change, or any Cloudflare rejection. */
    verifyCache?: boolean;
  };
  publication?: {
    /** Default 8. Parallel Vectorize reads/visibility checks; 1 = sequential. */
    concurrency?: number;
    /** Default 500. Vectors per Vectorize upsert request (max 1000). */
    upsertBatchSize?: number;
    /** Default true. When the saved publication is complete for the same fingerprint and index, verify by direct reads instead of re-uploading and re-polling. */
    fastNoChange?: boolean;
    /** Default true. Poll index info until the last upsert is processed before per-vector visibility checks. */
    waitForMutations?: boolean;
  };
}

export interface ResolvedConfig {
  path?: string;
  base: string;
  config: SiftConfig;
}
