import { Errors } from "../../errors/index.js";
import type { Inventory } from "../../inventory/types.js";
import type { LabeledCorpus, RelevanceSuite } from "./types.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return Errors.raise("INVALID_DATA", "Expected a relevance suite object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    return Errors.raise("INVALID_DATA", "Expected nonblank relevance suite text");
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value))
    return Errors.raise("INVALID_DATA", "Expected a relevance suite array");
  return value;
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length)
    Errors.raise("INVALID_DATA", "Duplicate relevance suite identifiers");
}
function path(value: unknown): string {
  const result = text(value);
  if (
    result.split("/").some((part) => !part || part === "." || part === "..") ||
    /[\\:]/u.test(result) ||
    result.includes("\0")
  )
    return Errors.raise("INVALID_DATA", "Suite paths must be safe relative paths");
  return result;
}
function line(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    return Errors.raise("INVALID_DATA", "Suite line numbers must be positive integers");
  return value;
}
function location(chunk: { path: string; startLine: number; endLine: number }) {
  return JSON.stringify([chunk.path, chunk.startLine, chunk.endLine]);
}

export function parseSuite(input: unknown): RelevanceSuite {
  const root = object(input);
  if (root.schemaVersion !== 1) Errors.raise("INVALID_DATA", "Unsupported relevance suite schema");
  const corpora = array(root.corpora).map((value): LabeledCorpus => {
    const corpus = object(value);
    const files = Object.fromEntries(
      Object.entries(object(corpus.files)).map(([name, digest]) => {
        if (typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest))
          Errors.raise("INVALID_DATA", "Suite files require SHA-256 hashes");
        return [path(name), digest];
      }),
    );
    const chunks = array(corpus.chunks).map((value) => {
      const chunk = object(value);
      const result = {
        key: text(chunk.key),
        path: path(chunk.path),
        startLine: line(chunk.startLine),
        endLine: line(chunk.endLine),
      };
      if (!Object.hasOwn(files, result.path) || result.endLine < result.startLine)
        Errors.raise("INVALID_DATA", "Invalid suite chunk location");
      return result;
    });
    unique(chunks.map((chunk) => chunk.key));
    unique(chunks.map(location));
    const keys = new Set(chunks.map((chunk) => chunk.key));
    const cases = array(corpus.cases).map((value) => {
      const item = object(value);
      const relevant = array(item.relevant).map(text);
      unique(relevant);
      if (relevant.some((key) => !keys.has(key)))
        Errors.raise("INVALID_DATA", "Unknown relevant chunk key");
      return {
        id: text(item.id),
        query: text(item.query),
        relevant,
        rationale: text(item.rationale),
      };
    });
    if (!Object.keys(files).length || !chunks.length || !cases.length)
      Errors.raise("INVALID_DATA", "Suite corpora must include files, chunks and cases");
    return { scope: path(corpus.scope), files, chunks, cases };
  });
  if (!corpora.length) Errors.raise("INVALID_DATA", "Suite must include at least one corpus");
  unique(corpora.map((corpus) => corpus.scope));
  unique(corpora.flatMap((corpus) => corpus.cases.map((item) => item.id)));
  return { schemaVersion: 1, corpora };
}

/**
 * Refuse stale or partial labels before resolving machine-specific chunk identities.
 */
export function resolveLabels(corpus: LabeledCorpus, inventory: Inventory): Map<string, string> {
  if (
    !inventory.complete ||
    inventory.resources.length !== Object.keys(corpus.files).length ||
    inventory.resources.some((resource) => corpus.files[resource.path] !== resource.resourceHash)
  )
    return Errors.raise("INCOMPLETE", "Benchmark corpus no longer matches pinned files");
  const actual = new Map(inventory.chunks.map((chunk) => [location(chunk), chunk.id]));
  if (actual.size !== corpus.chunks.length || inventory.chunks.length !== corpus.chunks.length)
    return Errors.raise("INCOMPLETE", "Benchmark chunk boundaries no longer match labels");
  return new Map(
    corpus.chunks.map((chunk) => {
      const id = actual.get(location(chunk));
      if (!id)
        return Errors.raise("INCOMPLETE", "Benchmark chunk boundaries no longer match labels");
      return [chunk.key, id];
    }),
  );
}
