import { Errors } from "../errors/index.js";

export function selectRoot(positionals: string[], root?: string) {
  if (positionals.length > 1 || (positionals.length && root))
    Errors.raise("INVALID_ARGUMENT", "Supply one root, either positionally or with --root");
  return root ?? positionals[0] ?? ".";
}
export function positiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
    Errors.raise("INVALID_ARGUMENT", "Expected a positive integer");
  return Number(value);
}
