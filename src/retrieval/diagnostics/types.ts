import type { SemanticChunkRecord } from "../../onboarding/types.js";
import type { DiscoveryTrace } from "../discovery/types.js";
import type { AssessmentTrace, RelevanceJudgment } from "../reranking/types.js";
import type { SearchResult } from "../types.js";

export type PrimaryOutcome =
  | "not-in-publication"
  | "not-discovered"
  | "outside-merge-pool"
  | "outside-shortlist"
  | "unassessed"
  | "rejected"
  | "omitted-by-top-k"
  | "returned";

export interface TargetTrace {
  id: string;
  published: boolean;
  source?: Pick<SemanticChunkRecord["resource"], "uri" | "range" | "resourceHash">;
  embedding?: {
    document: string;
    documentHash: string;
    collisionGroupSize: number;
    collidingChunkIds: string[];
    omittedCollidingChunks: number;
  };
  discovery: DiscoveryTrace;
  primaryJudgment?: RelevanceJudgment;
  finalJudgment?: RelevanceJudgment;
  primaryOutcome: PrimaryOutcome;
  returned: boolean;
  context: {
    eligibleFor: string[];
    assessed: boolean;
    judgment?: RelevanceJudgment;
    selectedFor: string[];
    returnedFor: string[];
  };
}

export interface StagedAssessmentTrace extends AssessmentTrace {
  stage: "primary" | "context" | "expanded";
}

export interface RetrievalDiagnostics {
  targets: TargetTrace[];
  assessments: StagedAssessmentTrace[];
}

export interface DiagnosticInput {
  traceChunks: readonly string[];
  records: SemanticChunkRecord[];
  discovery: DiscoveryTrace[];
  primary: SearchResult[];
  context: SearchResult[];
  final: SearchResult[];
  returned: SearchResult[];
  rerank: boolean;
  minRelevance: number;
  assessments: StagedAssessmentTrace[];
}
