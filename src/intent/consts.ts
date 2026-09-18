export const QUESTION_SET_VERSION = "query-intent-v1";
export const MAX_QUERY_BYTES = 2048;
export const MAX_TERMS = 24;
export const MAX_PAYLOAD_BYTES = 32 * 1024;
export const INTENT_KINDS = {
  find_implementation: "Find implementation",
  find_configuration: "Find configuration",
  find_usage: "Find usage examples",
  find_explanation: "Find explanation",
  find_risk: "Find risks",
  other: "Other intent",
};
export const ANSWER_SHAPES = {
  implementation: "Implementation",
  configuration: "Configuration",
  example: "Example",
  explanation: "Explanation",
  unspecified: "No clear requested shape",
};
export const TERM_ROLES = {
  positive: "Wanted meaning",
  negative: "Meaning to avoid; a soft preference, not a filter",
  unmatched: "Relevant candidate not covered by the supplied taxonomy",
  irrelevant: "Not useful for search",
};
export const SCORE_CRITERIA: [string, string, string] = ["Not relevant", "Secondary", "Central"];
