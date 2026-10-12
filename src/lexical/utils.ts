import type { IndexedChunk } from "./types.js";

export const tokenize = (input: string) => [
  ...new Set(
    input
      .toLowerCase()
      .split(/[^\p{L}\p{N}_.$/-]+/u)
      .filter((term) => term.length >= 2),
  ),
];
export function scoreChunk(
  chunk: Pick<IndexedChunk, "text" | "path" | "terms">,
  query: string,
  terms: string[],
) {
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

/**
 * Okapi BM25 (k1 1.2, b 0.75) over the same tokenizer as the legacy scorer.
 * Document frequency is computed over the supplied documents only.
 */
export function bm25Scores(documents: string[][], terms: string[]) {
  const k1 = 1.2;
  const b = 0.75;
  const lengths = documents.map((document) => document.length);
  const average = lengths.reduce((sum, length) => sum + length, 0) / Math.max(1, documents.length);
  const frequencies = documents.map((document) => {
    const counts = new Map<string, number>();
    for (const term of document) counts.set(term, (counts.get(term) ?? 0) + 1);
    return counts;
  });
  const idf = new Map(
    terms.map((term) => {
      const df = frequencies.filter((counts) => counts.has(term)).length;
      return [term, Math.log(1 + (documents.length - df + 0.5) / (df + 0.5))];
    }),
  );
  return frequencies.map((counts, index) => {
    let score = 0;
    for (const term of terms) {
      const tf = counts.get(term) ?? 0;
      if (!tf) continue;
      score +=
        idf.get(term)! *
        ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * lengths[index]!) / (average || 1))));
    }
    return score;
  });
}

/** Token stream (with repeats) for BM25 term frequencies. */
export const tokenStream = (input: string) =>
  input
    .toLowerCase()
    .split(/[^\p{L}\p{N}_.$/-]+/u)
    .filter((term) => term.length >= 2);

/**
 * Identifier-like queries: code identifiers, paths, error codes, config keys, or
 * quoted literals, where exact lexical evidence should carry more weight.
 */
export const identifierLike = (query: string) => {
  const trimmed = query.trim();
  if (/[`"']/.test(trimmed)) return true;
  const words = trimmed.split(/\s+/);
  const code = words.filter(
    (word) =>
      /[a-z][A-Z]/.test(word) ||
      /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(word) ||
      /[a-z0-9]_[a-z0-9]/i.test(word) ||
      /\w\.\w/.test(word) ||
      /\//.test(word) ||
      word.endsWith("()") ||
      /^--?[a-z]/.test(word),
  );
  return code.length > 0 && (words.length <= 4 || code.length / words.length >= 0.25);
};
