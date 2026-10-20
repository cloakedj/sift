import type { CandidateSource, Dimension, HarvestConfig } from "./types.js";
export const DIMENSIONS: readonly Dimension[] = [
  "domains",
  "concepts",
  "operations",
  "dependencies",
  "risks",
  "evidenceKinds",
];
export const SOURCE_PRIORITY: readonly CandidateSource[] = [
  "frontMatter",
  "heading",
  "path",
  "identifier",
  "body",
];
export const HARVEST_VERSION = "language-light-v1";
export const GOVERNANCE_VERSION = "independent-choice-v1";
export const HARVEST_CONFIG: HarvestConfig = {
  perResource: { path: 16, heading: 20, frontMatter: 30, identifier: 64, body: 64 },
  poolPerDimension: 200,
  rareResourceCount: 2,
  rareReservation: 0.25,
  maxLabelLength: 80,
  maxSnippetLength: 240,
  maxFrontMatterBytes: 16 * 1024,
};
export const GOVERNANCE_CONFIG = {
  maxCandidates: 16,
  maxEvidence: 3,
  maxPayloadBytes: 16 * 1024,
  promotionConfidence: 0.8,
};
/**
 * Sticky governance (onboarding.stickyTaxonomy): hysteresis so labels near the promotion
 * threshold do not flip on run-to-run noise. New labels need >= promote; an active label is
 * dropped only when re-judged below keep (or judged unsuitable) or when its term disappears.
 */
export const STICKY_GOVERNANCE = {
  promoteConfidence: 0.85,
  keepConfidence: 0.7,
};
export const TAXONOMY_ARCHIVE_FILE = "taxonomy-archive.json";
export const FRONT_MATTER_FIELDS = new Set([
  "title",
  "description",
  "tags",
  "categories",
  "keywords",
]);
