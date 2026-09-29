import type { ChunkStructure } from "./structure/types.js";
import type { ErrorDetails } from "../errors/types.js";

export interface DiscoveryPolicy {
  hiddenDirectories: boolean;
  directories: ReadonlySet<string>;
  files: ReadonlySet<string>;
  extensions: ReadonlySet<string>;
  patterns: readonly RegExp[];
}
export interface InventoryChunk {
  id: string;
  resourceId: string;
  path: string;
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number; // Exclusive; byte ranges address original content, including CRLF.
  chunkHash: string;
  text: string;
  structure?: ChunkStructure;
}
export interface InventoryResource {
  id: string;
  uri: string;
  path: string;
  resourceHash: string;
  bytes: number;
  chunkCount: number;
}
export interface Unit {
  text: string;
  start: number;
  end: number;
  line: number;
}
export interface Inventory {
  schemaVersion: number;
  mode: string;
  root: string;
  chunkerVersion: string;
  limits: { maxChunkBytes: number; maxChunkLines: number };
  resources: InventoryResource[];
  chunks: InventoryChunk[];
  skipped: { path: string; reason: string }[];
  failures: { path: string; error: string; details?: ErrorDetails }[];
  complete: boolean;
  inferenceCalls: number;
  published: boolean;
}
