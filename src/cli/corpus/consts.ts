export const CORPUS_COMMANDS = new Set([
  "onboard",
  "inspect",
  "search",
  "repair-projections",
  "publish",
  "status",
  "index",
  "lexical-search",
]);
export const CORPUS_STRING_OPTIONS = [
  "root",
  "limit",
  "concurrency",
  "min-relevance",
  "top-k",
  "anchor",
  "trace-chunk",
] as const;
