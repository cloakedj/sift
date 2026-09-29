export interface SourceUnit {
  id: string;
  parentId: string;
  resourceId: string;
  resourceHash: string;
  label?: string;
  kind: string;
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
  contentHash: string;
}

export type Relationship = "reference" | "continuation" | "container" | "contains" | "adjacent";
export type RelationshipBasis =
  | "source-structure"
  | "bound-symbol"
  | "indexed-import"
  | "explicit-link";
export interface SourceLink {
  id: string;
  relation: Relationship;
  basis: RelationshipBasis;
}

export interface ChunkStructure {
  mode: "syntax" | "document" | "bounded";
  unit?: SourceUnit;
  ancestors?: SourceUnit[];
  part?: { index: number; count: number };
  label?: string;
  related: SourceLink[];
  // Optional facts supplied by the code extractor, not requirements for other sources.
  symbol?: string;
  container?: string;
  exported?: boolean;
  references?: { startByte?: number; module?: string; symbol?: string }[];
}
