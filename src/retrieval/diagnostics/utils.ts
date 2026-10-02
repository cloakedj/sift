import { hash } from "../../shared/utils.js";
import { MAX_SEEDS, MIN_SEED_RELEVANCE } from "../context/consts.js";
import { contextLinks } from "../context/utils.js";
import { MAX_COLLISION_PEERS } from "./consts.js";
import type {
  DiagnosticInput,
  PrimaryOutcome,
  RetrievalDiagnostics,
  TargetTrace,
} from "./types.js";

/**
 * Explain known pipeline losses for explicitly requested chunk IDs, not a recall
 * estimate. A missing ID is absent from this validated publication; it may belong
 * to an old generation or excluded scope. Context judgments/selection stay separate
 * from primary acceptance. Exact assessment requests are opt-in diagnostic data.
 */
export function retrievalDiagnostics(input: DiagnosticInput): RetrievalDiagnostics {
  const byId = new Map(input.records.map((record) => [record.id, record]));
  const seeds = input.rerank
    ? input.primary
        .slice(0, MAX_SEEDS)
        .filter((hit) => (hit.relevance?.score ?? 0) >= MIN_SEED_RELEVANCE)
    : [];
  const targets = input.traceChunks.map((id): TargetTrace => {
    const record = byId.get(id);
    const discovery = input.discovery.find((trace) => trace.id === id) ?? {
      id,
      inPool: false,
      shortlisted: false,
    };
    const primary = input.primary.find((hit) => hit.record.id === id);
    const final = input.final.find((hit) => hit.record.id === id);
    const context = input.context.find((hit) => hit.record.id === id);
    const peers = record
      ? input.records
          .filter((item) => item.id !== id && item.embeddingDocument === record.embeddingDocument)
          .map((item) => item.id)
          .sort()
      : [];
    let primaryOutcome: PrimaryOutcome;
    if (!record) primaryOutcome = "not-in-publication";
    else if (!discovery.semanticRank && !discovery.lexicalRank && !discovery.anchorRank)
      primaryOutcome = "not-discovered";
    else if (!discovery.inPool) primaryOutcome = "outside-merge-pool";
    else if (!discovery.shortlisted) primaryOutcome = "outside-shortlist";
    else if (!input.rerank) primaryOutcome = "unassessed";
    else if ((final?.relevance?.score ?? 0) < input.minRelevance) primaryOutcome = "rejected";
    else if (!input.returned.some((hit) => hit.record.id === id))
      primaryOutcome = "omitted-by-top-k";
    else primaryOutcome = "returned";
    return {
      id,
      published: record !== undefined,
      source: record
        ? {
            uri: record.resource.uri,
            range: record.resource.range,
            resourceHash: record.resource.resourceHash,
          }
        : undefined,
      embedding: record
        ? {
            document: record.embeddingDocument,
            documentHash: hash(record.embeddingDocument),
            collisionGroupSize: peers.length + 1,
            collidingChunkIds: peers.slice(0, MAX_COLLISION_PEERS),
            omittedCollidingChunks: Math.max(0, peers.length - MAX_COLLISION_PEERS),
          }
        : undefined,
      discovery,
      primaryJudgment: primary?.relevance,
      finalJudgment: final?.relevance,
      primaryOutcome,
      returned: input.returned.some((hit) => hit.record.id === id),
      context: {
        eligibleFor: record
          ? seeds
              .filter((seed) => {
                const source = byId.get(seed.record.id);
                return (
                  source &&
                  source.id !== id &&
                  contextLinks(source, input.records).some((link) => link.id === id)
                );
              })
              .map((seed) => seed.record.id)
          : [],
        assessed: context?.relevance !== undefined,
        judgment: context?.relevance,
        selectedFor: input.final
          .filter((hit) => hit.context?.some((item) => item.record.id === id))
          .map((hit) => hit.record.id),
        returnedFor: input.returned
          .filter((hit) => hit.context?.some((item) => item.record.id === id))
          .map((hit) => hit.record.id),
      },
    };
  });
  return { targets, assessments: input.assessments };
}
