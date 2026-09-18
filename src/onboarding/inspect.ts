import { join, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { Errors } from "../errors/index.js";
import { FileSystem, type FileSystemService } from "../filesystem/index.js";
import { InventoryServiceTag, type InventoryService } from "../inventory/index.js";
import type { TaxonomySnapshot } from "../taxonomy/types.js";
import { Stores, type StoreService } from "./store.js";
import { DIMENSIONS } from "../taxonomy/consts.js";
import type {
  CandidateEvidenceSummary,
  ClassificationDimensionSummary,
  QualityFinding,
  RunManifest,
  SemanticChunkRecord,
  TaxonomyDimensionSummary,
  ValidationReport,
} from "./types.js";

export class InspectionService {
  public constructor(
    private readonly _fs: FileSystemService,
    private readonly _inventory: InventoryService,
    private readonly _stores: StoreService,
  ) {}
  public records(root: string) {
    return Effect.gen(this, function* () {
      const { directory, manifest } = yield* this._manifest(root);
      const inventory = yield* this._inventory.discover(root);
      const resources = new Map(inventory.resources.map((r) => [r.id, r]));
      const chunks = new Map(inventory.chunks.map((c) => [c.id, c]));
      const records: SemanticChunkRecord[] = [];
      const stale: string[] = [];
      const missing: string[] = [];
      for (const entry of manifest.records) {
        if (!/^[a-f0-9]{64}$/.test(entry.id))
          return yield* Errors.fail("INVALID_DATA", "Invalid chunk ID in manifest");
        const record = yield* this._fs.readJson<SemanticChunkRecord>(
          join(directory, "records", `${entry.id}.json`),
        );
        if (!record) {
          missing.push(entry.id);
          continue;
        }
        const current = record.resource && resources.get(record.resource.id);
        if (
          record.schemaVersion !== 1 ||
          record.id !== entry.id ||
          !current ||
          current.resourceHash !== entry.resourceHash ||
          current.resourceHash !== record.resource.resourceHash ||
          !chunks.has(entry.id) ||
          record.resource.chunkHash !== chunks.get(entry.id)!.chunkHash ||
          record.classificationFingerprint !== entry.fingerprint ||
          record.provenance?.taxonomyRegistryVersion !== manifest.taxonomyVersion
        )
          stale.push(entry.id);
        else records.push(record);
      }
      const current = new Set(records.map((r) => r.id));
      for (const chunk of inventory.chunks)
        if (!current.has(chunk.id) && !missing.includes(chunk.id)) missing.push(chunk.id);
      return {
        manifest,
        records,
        stale,
        missing,
        discoveryFailures: inventory.failures,
        complete:
          manifest.state === "complete" && inventory.complete && !stale.length && !missing.length,
      };
    });
  }
  public taxonomy(root: string) {
    return Effect.gen(this, function* () {
      const { directory } = yield* this._manifest(root);
      const taxonomy = yield* this._fs.readJson<TaxonomySnapshot>(join(directory, "taxonomy.json"));
      if (!taxonomy)
        return yield* Errors.fail(
          "NOT_FOUND",
          "No taxonomy snapshot; onboarding may have been interrupted",
        );
      return taxonomy;
    });
  }
  public validation(root: string) {
    return Effect.gen(this, function* () {
      const inspected = yield* this.records(root);
      const taxonomy = yield* this.taxonomy(root);
      const findings: QualityFinding[] = [];
      if (!inspected.complete)
        findings.push({
          severity: "error",
          subject: "records",
          message: "Current semantic records are incomplete, stale, or missing.",
        });
      if (!taxonomy.harvest.selected.length)
        findings.push({
          severity: "warning",
          subject: "taxonomy",
          message: "No candidates entered governance.",
        });
      if (taxonomy.harvest.overflow.length)
        findings.push({
          severity: "info",
          subject: "taxonomy",
          message: `${taxonomy.harvest.overflow.length} harvested candidates were left in overflow.`,
        });
      if (!taxonomy.labels.length)
        findings.push({
          severity: "warning",
          subject: "taxonomy",
          message:
            "No taxonomy labels were promoted; classifications can only report resource kind.",
        });
      const candidates = new Map(
        taxonomy.harvest.candidates.map((candidate) => [candidate.id, candidate]),
      );
      const selectedCandidates: CandidateEvidenceSummary[] = taxonomy.harvest.selected.map((id) => {
        const candidate = candidates.get(id)!;
        const sources: Record<string, number> = {};
        for (const evidence of candidate.evidence)
          sources[evidence.source] = (sources[evidence.source] ?? 0) + 1;
        return {
          id,
          name: candidate.name,
          evidenceCount: candidate.evidence.length,
          resourceCount: new Set(candidate.evidence.map((evidence) => evidence.resourceId)).size,
          sources,
          examples: candidate.evidence.slice(0, 3).map((evidence) => evidence.snippet),
        };
      });
      const taxonomyDimensions: TaxonomyDimensionSummary[] = DIMENSIONS.map((dimension) => {
        const judgments = taxonomy.judgments.filter((judgment) => judgment.dimension === dimension);
        const labels = taxonomy.labels
          .filter((label) => label.dimension === dimension)
          .map((label) => label.name)
          .sort();
        const summary = {
          dimension,
          selected: taxonomy.harvest.selected.length,
          promoted: labels.length,
          pending: judgments.filter((judgment) => judgment.status === "pending").length,
          unsuitable: judgments.filter((judgment) => judgment.status === "unsuitable").length,
          failed: judgments.filter((judgment) => judgment.status === "failed").length,
          labels,
        };
        if (summary.failed)
          findings.push({
            severity: "error",
            subject: `taxonomy.${dimension}`,
            message: `${summary.failed} governance judgments failed.`,
          });
        if (summary.pending)
          findings.push({
            severity: "warning",
            subject: `taxonomy.${dimension}`,
            message: `${summary.pending} candidate judgments remain pending.`,
          });
        if (!summary.promoted)
          findings.push({
            severity: "info",
            subject: `taxonomy.${dimension}`,
            message: "No labels promoted for this dimension.",
          });
        return summary;
      });
      const resourceKinds: Record<string, number> = {};
      const chunksWithoutLabels: string[] = [];
      const classificationDimensions: ClassificationDimensionSummary[] = DIMENSIONS.map(
        (dimension): ClassificationDimensionSummary => ({
          dimension,
          assignments: 0,
          central: 0,
          secondary: 0,
          labelsAssigned: [],
        }),
      );
      const assignedByDimension = new Map(
        classificationDimensions.map((summary) => [summary.dimension, new Set<string>()]),
      );
      for (const record of inspected.records) {
        if (record.taxonomy.resourceKind)
          resourceKinds[record.taxonomy.resourceKind.nameSnapshot] =
            (resourceKinds[record.taxonomy.resourceKind.nameSnapshot] ?? 0) + 1;
        let assigned = false;
        for (const summary of classificationDimensions)
          for (const score of record.taxonomy[summary.dimension])
            if (score.score > 0) {
              assigned = true;
              summary.assignments++;
              if (score.score === 1) summary.central++;
              else summary.secondary++;
              assignedByDimension.get(summary.dimension)!.add(score.nameSnapshot);
            }
        if (!assigned) chunksWithoutLabels.push(record.id);
      }
      for (const summary of classificationDimensions) {
        summary.labelsAssigned = [...assignedByDimension.get(summary.dimension)!].sort();
        const promoted = taxonomyDimensions.find(
          (item) => item.dimension === summary.dimension,
        )!.promoted;
        if (promoted && !summary.assignments)
          findings.push({
            severity: "warning",
            subject: `classification.${summary.dimension}`,
            message: "Promoted labels in this dimension were never assigned to current chunks.",
          });
      }
      if (chunksWithoutLabels.length)
        findings.push({
          severity: "warning",
          subject: "classification",
          message: `${chunksWithoutLabels.length} current chunks have no positive taxonomy label scores.`,
        });
      return {
        root: inspected.manifest.root,
        complete: inspected.complete,
        taxonomy: {
          candidates: taxonomy.harvest.candidates.length,
          selected: taxonomy.harvest.selected.length,
          overflow: taxonomy.harvest.overflow.length,
          excluded: taxonomy.harvest.excluded.length,
          dimensions: taxonomyDimensions,
          selectedCandidates,
        },
        classifications: {
          records: inspected.records.length,
          chunksWithoutLabels,
          resourceKinds,
          dimensions: classificationDimensions,
        },
        findings,
      } satisfies ValidationReport;
    });
  }
  private _manifest(root: string) {
    return Effect.gen(this, function* () {
      const directory = yield* this._stores.directory(root);
      const manifest = yield* this._fs.readJson<RunManifest>(join(directory, "index.json"));
      if (manifest?.schemaVersion !== 2 || manifest.root !== resolve(root))
        return yield* Errors.fail("NOT_FOUND", "No semantic onboarding manifest for this root", {
          root,
        });
      if (!Array.isArray(manifest.records))
        return yield* Errors.fail("INVALID_DATA", "Invalid records in semantic manifest", { root });
      return { directory, manifest };
    });
  }
}
export class Inspection extends Context.Tag("Inspection")<Inspection, InspectionService>() {}
export const InspectionLive = Layer.effect(
  Inspection,
  Effect.gen(function* () {
    return new InspectionService(yield* FileSystem, yield* InventoryServiceTag, yield* Stores);
  }),
);
export const inspectRecords = (root: string) =>
  Effect.flatMap(Inspection, (service) => service.records(root));
export const inspectTaxonomy = (root: string) =>
  Effect.flatMap(Inspection, (service) => service.taxonomy(root));
export const inspectValidation = (root: string) =>
  Effect.flatMap(Inspection, (service) => service.validation(root));
