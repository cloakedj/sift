import { basename, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { Errors } from "../errors/index.js";
import { FileSystem, type FileSystemService } from "../filesystem/index.js";
import type {
  ScaleCorpusOptions,
  ScaleCorpusReport,
  TimingSample,
  TimingSummaryReport,
} from "./types.js";
import { SCALE_FILE_CHUNKS } from "./consts.js";
import { evaluateRelevance } from "./relevance/index.js";
import {
  extractTimingSamples,
  scaleCorpusContent,
  scaleCorpusPath,
  summarizeTimings,
} from "./utils.js";

export class BenchmarkService {
  public constructor(private readonly _fs: FileSystemService) {}

  /**
   * Generate a deterministic local corpus sized by expected chunk count. The
   * files are ordinary source/documents so benchmark runs keep using product
   * onboarding and search commands rather than checkpoint-only fixtures.
   * Nonempty destinations must exactly match the requested corpus and are never
   * rewritten. New files use exclusive creation; interrupted/failed generation
   * may leave a partial corpus that requires a fresh destination on retry.
   */
  public generateScaleCorpus(root: string, options: ScaleCorpusOptions) {
    return Effect.gen(this, function* () {
      if (!Number.isSafeInteger(options.chunks) || options.chunks < 1)
        return yield* Errors.fail("INVALID_ARGUMENT", "--chunks must be a positive integer");
      const kind = options.kind ?? "mixed";
      if (!["code", "text", "mixed"].includes(kind))
        return yield* Errors.fail("INVALID_ARGUMENT", "Unknown scale corpus kind");
      const target = resolve(root);
      const files = Math.ceil(options.chunks / SCALE_FILE_CHUNKS);
      yield* this._fs.mkdir(target);
      const info = yield* this._fs.stat(target);
      if (!info.isDirectory() || info.isSymbolicLink())
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "Scale corpus destination must be a real directory",
        );
      const entries = new Set(yield* this._fs.list(target));
      const conflict = () =>
        Errors.fail(
          "INVALID_ARGUMENT",
          "Scale corpus destination contains different or unrelated content; use a fresh directory",
        );
      if (entries.size) {
        if (entries.size !== files) return yield* conflict();
        for (let index = 0; index < files; index++) {
          const path = scaleCorpusPath(target, index, kind);
          if (!entries.has(basename(path))) return yield* conflict();
          const entry = yield* this._fs.stat(path);
          if (!entry.isFile() || entry.isSymbolicLink()) return yield* conflict();
          const chunks = Math.min(SCALE_FILE_CHUNKS, options.chunks - index * SCALE_FILE_CHUNKS);
          if ((yield* this._fs.read(path)) !== scaleCorpusContent(index, kind, chunks))
            return yield* conflict();
        }
      } else {
        for (let index = 0; index < files; index++) {
          const path = scaleCorpusPath(target, index, kind);
          const chunks = Math.min(SCALE_FILE_CHUNKS, options.chunks - index * SCALE_FILE_CHUNKS);
          yield* this._fs.write(path, scaleCorpusContent(index, kind, chunks), true);
        }
      }
      return {
        root: target,
        kind,
        requestedChunks: options.chunks,
        files,
        estimatedChunks: options.chunks,
      } satisfies ScaleCorpusReport;
    });
  }

  public evaluateRelevanceFile(path: string, k: number) {
    return Effect.gen(this, function* () {
      const cases = yield* this._fs.readJson<unknown>(path);
      if (cases === undefined)
        return yield* Errors.fail("NOT_FOUND", `Relevance cases not found: ${path}`);
      return yield* evaluateRelevance(cases, k);
    });
  }

  public summarize(samples: TimingSample[]) {
    return Errors.attempt(() => summarizeTimings(samples), "INVALID_DATA");
  }

  public summarizeReportFiles(paths: string[]) {
    return Effect.gen(this, function* () {
      if (!paths.length)
        return yield* Errors.fail("INVALID_ARGUMENT", "Provide at least one JSON report file");
      const samples: TimingSample[] = [];
      let reports = 0;
      for (const path of paths) {
        const parsed = yield* this._fs.readJson<unknown>(path);
        if (parsed === undefined)
          return yield* Errors.fail("NOT_FOUND", `Benchmark report not found: ${path}`);
        const extracted = yield* Errors.attempt(() => extractTimingSamples(parsed), "INVALID_DATA");
        reports += extracted.reports;
        samples.push(...extracted.samples);
      }
      if (!reports)
        return yield* Errors.fail(
          "INVALID_DATA",
          "No timing-bearing onboarding or search reports were found",
        );
      return {
        files: paths,
        reports,
        summaries: yield* this.summarize(samples),
      } satisfies TimingSummaryReport;
    });
  }
}

export class Benchmark extends Context.Tag("Benchmark")<Benchmark, BenchmarkService>() {}
export const BenchmarkLive = Layer.effect(
  Benchmark,
  Effect.gen(function* () {
    return new BenchmarkService(yield* FileSystem);
  }),
);
export const generateScaleCorpus = (root: string, options: ScaleCorpusOptions) =>
  Effect.flatMap(Benchmark, (service) => service.generateScaleCorpus(root, options));
export const evaluateRelevanceFile = (path: string, k: number) =>
  Effect.flatMap(Benchmark, (service) => service.evaluateRelevanceFile(path, k));
export const summarizeBenchmarkTimings = (samples: TimingSample[]) =>
  Effect.flatMap(Benchmark, (service) => service.summarize(samples));
export const summarizeBenchmarkReportFiles = (paths: string[]) =>
  Effect.flatMap(Benchmark, (service) => service.summarizeReportFiles(paths));
