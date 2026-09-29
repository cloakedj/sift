import type { SourceUnit } from "../structure/types.js";

export interface DocumentRegion {
  start: number;
  end: number;
  line: number;
  endLine: number;
  kind: "section" | "paragraph" | "fenced-block";
  label?: string;
  depth?: number;
  parent?: DocumentRegion;
  unit?: SourceUnit;
}
export interface DocumentPiece {
  region: DocumentRegion;
  start: number;
  end: number;
  line: number;
}
