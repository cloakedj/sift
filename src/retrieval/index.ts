import { Config, Context, Effect, Layer } from "effect";
import { Errors } from "../errors/index.js";
import { Inspection, type InspectionService } from "../onboarding/inspect.js";
import { DEFAULT_MODEL } from "../typesafe/consts.js";
import { createJevClient } from "../typesafe/client.js";
import { Intent, type IntentService } from "../intent/index.js";
import { CloudflareAuthService } from "../publication/auth.js";
import { CloudflarePublicationClient } from "../publication/client.js";
import { Publication, type PublicationService } from "../publication/index.js";
import {
  embeddingSpaceId,
  hashIdentity,
  metadataMatches,
  publicationFingerprint,
  vectorId,
  vectorMetadata,
} from "../publication/utils.js";
import type { SearchOptions, SearchReport } from "./types.js";
import { Reranking, RerankingLive, type RerankingService } from "./reranking/index.js";
import { MAX_CANDIDATES } from "./reranking/consts.js";
import { DEFAULT_TOP_K, DEFAULT_MIN_RELEVANCE } from "./consts.js";
import { contextCandidates, expandContext } from "./context/utils.js";
import { MAX_CONTEXT_BYTES, MAX_CONTEXT_CHUNKS, MAX_SEEDS } from "./context/consts.js";
import { discoverCandidates } from "./discovery/utils.js";
import { MAX_ANCHORS, MAX_ANCHOR_BYTES } from "./discovery/consts.js";
import { orderEvidence } from "./utils.js";
import { MAX_QUERY_TOP_K, MAX_EMBEDDING_BYTES } from "../publication/consts.js";

export class RetrievalService {
  public constructor(
    private readonly _inspection: InspectionService,
    private readonly _intent: IntentService,
    private readonly _publication: PublicationService,
    private readonly _reranking: RerankingService,
  ) {}

  /**
   * Search only the source-current, query-visible publication generation. The
   * query is embedded with the same pinned Workers AI space recorded by publish;
   * Vectorize metadata is rechecked before a match becomes a source-linked result.
   * Hybrid discovery merges lexical/anchor and vector seeds from that same
   * publication before any assessment. Reranking judges a bounded shortlist;
   * candidate/output truncation and non-exhaustive coverage remain explicit.
   */
  public search(root: string, query: string, options: SearchOptions) {
    return Effect.gen(this, function* () {
      const timings: SearchReport["timings"] = [];
      const searchStarted = performance.now();
      let stageStarted = searchStarted;
      const mark = (stage: string) => {
        const now = performance.now();
        timings.push({ stage, milliseconds: now - stageStarted });
        stageStarted = now;
      };
      const topK = options.topK ?? DEFAULT_TOP_K;
      const hybrid = options.discovery !== "semantic";
      const anchors = options.anchors ?? [];
      if (
        (options.discovery !== undefined && !["hybrid", "semantic"].includes(options.discovery)) ||
        (!hybrid && anchors.length) ||
        anchors.length > MAX_ANCHORS ||
        anchors.some((anchor) =>
          anchor.kind === "literal"
            ? !anchor.value.trim() || Buffer.byteLength(anchor.value) > MAX_ANCHOR_BYTES
            : anchor.kind !== "location" ||
              !anchor.uri.trim() ||
              Buffer.byteLength(anchor.uri) > MAX_ANCHOR_BYTES ||
              (anchor.line !== undefined && (!Number.isInteger(anchor.line) || anchor.line < 1)),
        )
      )
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "Use hybrid discovery with at most eight nonempty literal/location anchors (2048 bytes each); location lines must be positive integers",
        );
      const candidateLimit = options.rerank
        ? MAX_CANDIDATES
        : hybrid
          ? Math.max(MAX_CANDIDATES, topK)
          : topK;
      const minRelevance = options.minRelevance ?? DEFAULT_MIN_RELEVANCE;
      if (
        !Number.isFinite(minRelevance) ||
        minRelevance < 0 ||
        minRelevance > 1 ||
        (options.minRelevance !== undefined && !options.rerank)
      )
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "--min-relevance requires --rerank and a number between 0 and 1",
        );
      if (!Number.isInteger(topK) || topK < 1 || topK > MAX_QUERY_TOP_K)
        return yield* Errors.fail("INVALID_ARGUMENT", "--top-k must be between 1 and 50");
      if (options.rerank && topK > MAX_CANDIDATES)
        return yield* Errors.fail("INVALID_ARGUMENT", "--rerank requires --top-k between 1 and 8");
      const model = yield* Config.string("TYPESAFE_DEFAULT_MODEL").pipe(
        Config.withDefault(DEFAULT_MODEL),
        Effect.mapError(() => Errors.create("CONFIGURATION", "Invalid TYPESAFE_DEFAULT_MODEL")),
      );
      mark("configuration");
      const status = yield* this._publication.status(root);
      mark("publication-status");
      const publication = status.publication;
      if (!status.complete || !publication?.reconciliation || !publication.verifiedAt)
        return yield* Errors.fail(
          "INCOMPLETE",
          "Search requires a complete current vector publication; run publish first",
        );
      const initial = yield* this._inspection.records(root);
      mark("records-inspection");
      if (
        !initial.complete ||
        publication.namespace !== publication.fingerprint ||
        publication.embeddingSpace.provider !== "cloudflare-workers-ai" ||
        publication.embeddingSpace.dimensions !== 768 ||
        publication.embeddingSpace.pooling !== "cls" ||
        publication.embeddingSpace.metric !== "cosine" ||
        publication.corpusId !== hashIdentity(initial.manifest.root) ||
        publication.embeddingSpaceId !==
          embeddingSpaceId(initial.records, publication.embeddingSpace.model)
      )
        return yield* Errors.fail("CONFIGURATION", "Incompatible active embedding space");
      const reranker = options.rerank ? yield* createJevClient() : undefined;
      const intentResult = yield* this._intent.infer(root, query, model, createJevClient());
      mark(intentResult.reused ? "query-intent-cached" : "query-intent-uncached");
      if (intentResult.intent.provenance.taxonomyVersion !== initial.manifest.taxonomyVersion)
        return yield* Errors.fail(
          "INCOMPLETE",
          "Query taxonomy does not match the published records",
        );
      if (Buffer.byteLength(intentResult.intent.embeddingDocument, "utf8") > MAX_EMBEDDING_BYTES)
        return yield* Errors.fail(
          "PAYLOAD_LIMIT",
          "Query embedding document exceeds the conservative 500-byte guardrail",
        );
      const config = yield* new CloudflareAuthService().config();
      if (
        config.accountId !== publication.vectorBackend.accountId ||
        config.vectorizeIndex !== publication.vectorBackend.index ||
        config.model !== publication.embeddingSpace.model
      )
        return yield* Errors.fail(
          "CONFIGURATION",
          "Cloudflare configuration does not match the active publication",
        );
      const client = new CloudflarePublicationClient(config);
      yield* client.verifyIndex();
      mark("vector-index-verification");
      const [queryVector] = yield* client.embed([intentResult.intent.embeddingDocument]);
      mark("query-embedding");
      const matches = yield* client.query(queryVector!, publication.namespace, candidateLimit);
      mark("vector-query");
      const inspected = yield* this._inspection.records(root);
      const finalStatus = yield* this._publication.status(root);
      mark("result-validation");
      if (
        !inspected.complete ||
        !finalStatus.complete ||
        finalStatus.publication?.fingerprint !== publication.fingerprint ||
        publicationFingerprint(inspected.manifest.root, inspected.records, config) !==
          publication.fingerprint
      )
        return yield* Errors.fail(
          "INCOMPLETE",
          "Semantic records or publication changed during search",
        );
      const byVector = new Map(
        inspected.records.map((record) => [vectorId(publication.fingerprint, record.id), record]),
      );
      const findings: SearchReport["findings"] = [];
      const results: SearchReport["results"] = [];
      const seen = new Set<string>();
      for (const match of [...matches].sort(
        (a, b) => b.score - a.score || a.id.localeCompare(b.id),
      )) {
        if (seen.has(match.id)) continue;
        seen.add(match.id);
        const record = byVector.get(match.id);
        if (!record)
          return yield* Errors.fail(
            "INCOMPLETE",
            "Remote search matches failed active-generation validation: unknown vector; republish before retrying",
          );
        const expected = {
          id: match.id,
          namespace: publication.namespace,
          values: queryVector!,
          metadata: vectorMetadata(record, publication.corpusId!, publication.embeddingSpaceId!),
        };
        if (!metadataMatches(expected, match))
          return yield* Errors.fail(
            "INCOMPLETE",
            "Remote search matches failed active-generation validation: namespace or metadata mismatch; republish before retrying",
          );
        results.push({
          rank: results.length + 1,
          score: match.score,
          source: "semantic",
          vectorId: match.id,
          record: {
            id: record.id,
            resource: record.resource,
            taxonomy: record.taxonomy,
            provenance: record.provenance,
          },
        });
      }
      const discovery = hybrid
        ? discoverCandidates(query, inspected.records, results, candidateLimit, anchors)
        : { results, discovered: results.length, omitted: 0, anchorMatches: 0 };
      const candidates = discovery.results;
      mark(hybrid ? "hybrid-discovery" : "semantic-discovery");
      let ranked =
        options.rerank && candidates.length
          ? yield* this._reranking.rank(root, intentResult.intent, candidates, reranker!)
          : { results: candidates, judgments: { reused: 0, new: 0 } };
      if (options.rerank && candidates.length) {
        mark("jev-rerank");
        const pool = contextCandidates(ranked.results, inspected.records);
        const contextJudgments = yield* this._reranking.rank(
          root,
          intentResult.intent,
          pool,
          reranker!,
        );
        ranked.judgments.reused += contextJudgments.judgments.reused;
        ranked.judgments.new += contextJudgments.judgments.new;
        const expanded = expandContext(ranked.results, inspected.records, contextJudgments.results);
        if (expanded.some((result) => result.context?.length)) {
          const contextual = yield* this._reranking.rank(
            root,
            intentResult.intent,
            expanded,
            reranker!,
          );
          ranked = {
            results: orderEvidence(contextual.results, minRelevance),
            judgments: {
              reused: ranked.judgments.reused + contextual.judgments.reused,
              new: ranked.judgments.new + contextual.judgments.new,
            },
          };
          mark("context-rerank");
        }
      }
      if (options.rerank && candidates.length) {
        const afterRanking = yield* this._publication.status(root);
        if (
          !afterRanking.complete ||
          afterRanking.publication?.fingerprint !== publication.fingerprint
        )
          return yield* Errors.fail(
            "INCOMPLETE",
            "Sources or publication changed during reranking",
          );
      }
      findings.push({
        severity: "info",
        message: options.rerank
          ? `Ranked by Jev relevance with bounded supporting context. Results below ${minRelevance} are withheld as insufficient evidence. This is a policy threshold, not calibrated search confidence.`
          : hybrid
            ? "Ranked by reciprocal discovery ranks, not combined raw scores or search confidence. Evidence is not assessed without reranking."
            : "Scores are cosine similarities, not search confidence. No relevance threshold or Jev reranking is applied.",
      });
      if (!options.rerank && intentResult.intent.negativeSignals.length)
        findings.push({
          severity: "warning",
          message:
            "Negative signals are recorded in intent, but are not separately penalized or filtered in this retrieval checkpoint.",
        });
      if (
        new Set(inspected.records.map((record) => record.embeddingDocument)).size <
        inspected.records.length
      )
        findings.push({
          severity: "warning",
          message:
            "Some records have identical embedding documents; vector similarity cannot distinguish them.",
        });
      if (!results.length)
        findings.push({
          severity: "info",
          message:
            "No active-generation vectors matched the query. Hybrid candidates use the shared assessment path when reranking is enabled.",
        });
      findings.push({
        severity: "info",
        message:
          "Completed bounded retrieval, not an exhaustive corpus answer. Source relationships guide exploration; they do not establish relevance or cache validity.",
      });
      const considered = ranked.results.length;
      const assessed = options.rerank === true;
      const accepted = assessed
        ? ranked.results.filter((result) => (result.relevance?.score ?? 0) >= minRelevance)
        : ranked.results;
      const evidence = {
        state: assessed ? (accepted.length ? "supported" : "insufficient") : "not-assessed",
        threshold: assessed ? minRelevance : undefined,
        considered,
      } as const;
      if (evidence.state === "insufficient")
        findings.push({
          severity: "warning",
          message:
            "Insufficient evidence to answer this question in the retrieved source and bounded context. This does not prove the feature is absent. Use --explain to inspect rejected candidates.",
        });
      if (discovery.omitted > 0)
        findings.push({
          severity: "info",
          message: `${discovery.omitted} discovered primary candidates were omitted before assessment by the candidate budget.`,
        });
      if (accepted.length > topK)
        findings.push({
          severity: "info",
          message: `${accepted.length - topK} eligible results were omitted by --top-k. This is response truncation, not missing corpus coverage.`,
        });
      timings.push({ stage: "end-to-end", milliseconds: performance.now() - searchStarted });
      return {
        schemaVersion: 1,
        root: inspected.manifest.root,
        query,
        reusedIntent: intentResult.reused,
        ranking: options.rerank ? "jev-relevance" : hybrid ? "hybrid" : "vector",
        execution: "complete",
        coverage: {
          scope: "active-publication",
          exhaustive: false,
          totalChunks: inspected.records.length,
          discoveredPrimaryCandidates: discovery.discovered,
          assessedPrimaryCandidates: assessed ? candidates.length : 0,
          boundedChunks: inspected.records.filter((record) => !record.resource.structure?.unit)
            .length,
          anchorMatches: discovery.anchorMatches,
          limitations: [
            "bounded-discovery",
            ...(options.rerank ? ["bounded-expansion" as const] : []),
            ...(inspected.records.some((record) => !record.resource.structure?.unit)
              ? ["unstructured-sources" as const]
              : []),
          ],
        },
        truncation: {
          results: accepted.length > topK,
          omittedResults: Math.max(0, accepted.length - topK),
          candidates: discovery.omitted > 0,
          omittedCandidates: discovery.omitted,
        },
        budget: {
          primaryCandidates: candidateLimit,
          contextCandidates: options.rerank ? MAX_CANDIDATES : 0,
          contextChunksPerSeed: options.rerank ? MAX_CONTEXT_CHUNKS : 0,
          contextBytesPerSeed: options.rerank ? MAX_CONTEXT_BYTES : 0,
          seeds: options.rerank ? MAX_SEEDS : 0,
        },
        intent: options.explain ? intentResult.intent : undefined,
        publication: {
          fingerprint: publication.fingerprint,
          namespace: publication.namespace,
          embeddingSpace: publication.embeddingSpace,
          vectorBackend: publication.vectorBackend,
          verifiedAt: publication.verifiedAt,
        },
        results: accepted.slice(0, topK).map((result, index) => ({ ...result, rank: index + 1 })),
        evidence,
        candidates: options.explain ? ranked.results : undefined,
        judgments: options.explain && options.rerank ? ranked.judgments : undefined,
        findings,
        timings,
      } satisfies SearchReport;
    });
  }
}

export class Retrieval extends Context.Tag("Retrieval")<Retrieval, RetrievalService>() {}
export const RetrievalLive = Layer.effect(
  Retrieval,
  Effect.gen(function* () {
    return new RetrievalService(
      yield* Inspection,
      yield* Intent,
      yield* Publication,
      yield* Reranking,
    );
  }),
).pipe(Layer.provide(RerankingLive));
export const searchSemantic = (root: string, query: string, options: SearchOptions) =>
  Effect.flatMap(Retrieval, (service) => service.search(root, query, options));
