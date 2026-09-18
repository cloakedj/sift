import type { InventoryChunk } from "../inventory/types.js";
export interface IndexedChunk extends InventoryChunk {
  terms: string[];
}
export interface LexicalIndex {
  version: 1;
  root: string;
  chunks: IndexedChunk[];
}
export interface SearchHit {
  chunk: IndexedChunk;
  score: number;
}
