import { Errors } from "../errors/index.js";
import { LEXICAL_SCORER_CHOICES, type LexicalScorerChoice } from "../retrieval/discovery/types.js";

export function selectRoot(positionals: string[], root?: string) {
  if (positionals.length > 1 || (positionals.length && root))
    Errors.raise("INVALID_ARGUMENT", "Supply one root, either positionally or with --root");
  return root ?? positionals[0] ?? ".";
}
/**
 * Extract the shared config override without changing command-specific argument parsing.
 */
export function configurationArgs(args: string[]) {
  const remaining: string[] = [];
  let config: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") {
      remaining.push(...args.slice(index));
      break;
    }
    if (arg !== "--config" && !arg.startsWith("--config=")) {
      remaining.push(arg);
      continue;
    }
    if (config !== undefined) Errors.raise("INVALID_ARGUMENT", "Supply --config only once");
    config = arg === "--config" ? args[++index] : arg.slice("--config=".length);
    if (!config || config.startsWith("--"))
      Errors.raise("INVALID_ARGUMENT", "--config requires a file path");
  }
  return { args: remaining, config };
}

export function lexicalScorerOption(value: string | undefined): LexicalScorerChoice | undefined {
  if (value === undefined) return undefined;
  if (!(LEXICAL_SCORER_CHOICES as readonly string[]).includes(value))
    Errors.raise(
      "INVALID_ARGUMENT",
      `--lexical-scorer must be one of ${LEXICAL_SCORER_CHOICES.join(", ")}`,
    );
  return value as LexicalScorerChoice;
}

export function positiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
    Errors.raise("INVALID_ARGUMENT", "Expected a positive integer");
  return Number(value);
}
