import type { IndexedChunk } from "./types.js";

export const tokenize = (input: string) => [
  ...new Set(
    input
      .toLowerCase()
      .split(/[^a-z0-9_.$/-]+/)
      .filter((term) => term.length >= 2),
  ),
];
export function scoreChunk(chunk: IndexedChunk, query: string, terms: string[]) {
  const text = chunk.text.toLowerCase();
  const path = chunk.path.toLowerCase();
  const vocabulary = new Set(chunk.terms);
  let score = 0;
  for (const term of terms) {
    if (vocabulary.has(term)) score += 10;
    if (path.includes(term)) score += 8;
    if (text.includes(term)) score += 5;
  }
  if (text.includes(query.toLowerCase())) score += 40;
  if (path.includes(query.toLowerCase())) score += 20;
  return score;
}
