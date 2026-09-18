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
export const FRONT_MATTER_FIELDS = new Set([
  "title",
  "description",
  "tags",
  "categories",
  "keywords",
]);
