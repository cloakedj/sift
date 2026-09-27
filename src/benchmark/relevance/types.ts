export interface RelevanceCase {
  id: string;
  /** Exhaustive relevant chunk IDs for this fixed corpus; empty means no answer exists. */
  relevantIds: string[];
  /** Ranked retrieved shortlist, before any answer/abstention decision. */
  retrievedIds: string[];
  /** Explicit policy decision, not inferred from a nonempty shortlist. */
  answered: boolean;
}

export interface RelevanceEvaluation {
  k: number;
  cases: number;
  positiveCases: number;
  negativeCases: number;
  hitRateAtK: number | null;
  meanRecallAtK: number | null;
  meanReciprocalRankAtK: number | null;
  negativeFalseAnswerRate: number | null;
  positiveAbstentionRate: number | null;
}
