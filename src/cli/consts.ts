export const COMMON_OPTIONS = { json: { type: "boolean" }, root: { type: "string" } } as const;
export const USAGE = [
  "npm run cli -- onboard [root] [--dry-run] [--json] [--limit <chunks>]",
  "npm run cli -- inspect records|taxonomy|validation --root <path> [--json]",
  "npm run cli -- repair-projections --root <path> [--json]",
  "npm run cli -- publish --root <path> [--json]",
  "npm run cli -- status --root <path> [--json]",
  "npm run cli -- generate-scale-corpus --root <path> --chunks <n> [--kind code|text|mixed] [--json]",
  "npm run cli -- benchmark-summary <report.json...> [--json]",
  "npm run cli -- evaluate-relevance <cases.json> --top-k <n> [--json]",
  "npm run cli -- benchmark-relevance <suite.json> --root <corpora-parent> --top-k <n> --policy answer-if-any|rerank-min-relevance --run-paid [--rerank --min-relevance <0..1>] [--json]",
  "npm run cli -- index [root] (legacy lexical diagnostic)",
  "npm run cli -- search <query> [--explain] [--rerank] [--lexical-fallback] [--top-k <n>] [--root <path>] [--json]",
  "npm run cli -- search <query> --show-intent [--root <path>] [--json]",
  "npm run cli -- lexical-search <query> [--root <path>] (legacy lexical diagnostic)",
];
