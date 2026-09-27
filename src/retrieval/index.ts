import { Config, Context, Effect, Layer } from "effect";
import { Errors } from "../errors/index.js";
import { Inspection, type InspectionService } from "../onboarding/inspect.js";
import { mediaFacts } from "../onboarding/utils.js";
import { DEFAULT_MODEL } from "../typesafe/consts.js";
import { createJevClient } from "../typesafe/client.js";
import { Intent, type IntentService } from "../intent/index.js";
import { Lexical, type LexicalService } from "../lexical/index.js";
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
import { DEFAULT_TOP_K } from "./consts.js";
import { MAX_QUERY_TOP_K, MAX_EMBEDDING_BYTES } from "../publication/consts.js";

export class RetrievalService {
  public constructor(
    private readonly _inspection: InspectionService,
    private readonly _intent: IntentService,
    private readonly _publication: PublicationService,
    private readonly _reranking: RerankingService,
    private readonly _lexical: LexicalService,
  ) {}

  /**
   * Search only the source-current, query-visible publication generation. The
   * query is embedded with the same pinned Workers AI space recorded by publish;
   * Vectorize metadata is rechecked before a match becomes a source-linked result.
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
      const matches = yield* client.query(queryVector!, publication.namespace, topK);
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
      const ranked =
        options.rerank && results.length
          ? yield* this._reranking.rank(root, intentResult.intent, results, reranker!)
          : { results, judgments: { reused: 0, new: 0 } };
      if (options.rerank && results.length) mark("jev-rerank");
      if (options.rerank && results.length) {
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
          ? "Ranked by Jev relevance; original scores remain cosine similarities. Neither relevance nor model confidence is calibrated search confidence. No abstention threshold is applied."
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
      if (!results.length) {
        findings.push({
          severity: "info",
          message: "No active-generation vectors matched the query.",
        });
        if (options.lexicalFallback) {
          const lexical = yield* this._lexical.recover(query, root, topK);
          mark("lexical-fallback");
          for (const hit of lexical)
            ranked.results.push({
              source: "lexical-fallback",
              rank: ranked.results.length + 1,
              score: hit.score,
              vectorId: `lexical:${hit.chunk.id}`,
              record: {
                id: hit.chunk.id,
                resource: {
                  id: hit.chunk.resourceId,
                  uri: hit.chunk.path,
                  mediaType: mediaFacts(hit.chunk.path).mediaType,
                  language: mediaFacts(hit.chunk.path).language,
                  range: {
                    startLine: hit.chunk.startLine,
                    endLine: hit.chunk.endLine,
                    startByte: hit.chunk.startByte,
                    endByte: hit.chunk.endByte,
                  },
                  resourceHash: hit.resource.resourceHash,
                  chunkHash: hit.chunk.chunkHash,
                  textPreview: hit.chunk.text.slice(0, 240),
                },
              },
            });
          findings.push({
            severity: lexical.length ? "warning" : "info",
            message: lexical.length
              ? "Lexical fallback was explicitly enabled; fallback results are labeled and are not semantic retrieval."
              : "Lexical fallback was explicitly enabled, but found no matching chunks.",
          });
        } else
          findings.push({
            severity: "warning",
            message:
              "Lexical fallback is disabled; no string-matching results were substituted for semantic retrieval.",
          });
      }
      timings.push({ stage: "end-to-end", milliseconds: performance.now() - searchStarted });
      return {
        schemaVersion: 1,
        root: inspected.manifest.root,
        query,
        reusedIntent: intentResult.reused,
        ranking: options.rerank ? "jev-relevance" : "vector",
        intent: options.explain ? intentResult.intent : undefined,
        publication: {
          fingerprint: publication.fingerprint,
          namespace: publication.namespace,
          embeddingSpace: publication.embeddingSpace,
          vectorBackend: publication.vectorBackend,
          verifiedAt: publication.verifiedAt,
        },
        results: ranked.results,
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
      yield* Lexical,
    );
  }),
).pipe(Layer.provide(RerankingLive));
export const searchSemantic = (root: string, query: string, options: SearchOptions) =>
  Effect.flatMap(Retrieval, (service) => service.search(root, query, options));
