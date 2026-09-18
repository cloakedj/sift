export const COMMON_OPTIONS = { json: { type: "boolean" }, root: { type: "string" } } as const;
export const USAGE = [
  "npm run cli -- onboard [root] [--dry-run] [--json] [--limit <chunks>]",
  "npm run cli -- inspect records|taxonomy|validation --root <path> [--json]",
  "npm run cli -- index [root] (legacy lexical diagnostic)",
  "npm run cli -- search <query> --show-intent [--root <path>] [--json] (intent only; retrieval not implemented)",
  "npm run cli -- lexical-search <query> [--root <path>] (legacy lexical diagnostic)",
];
