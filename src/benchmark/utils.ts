import { basename } from "node:path";
import { Errors } from "../errors/index.js";
import { MAX_CHUNK_LINES, OVERLAP_LINES } from "../inventory/consts.js";
import { SCALE_FILE_CHUNKS } from "./consts.js";
import type { ScaleCorpusKind, TimingSample, TimingSummary } from "./types.js";

const codeBlock = (file: number, chunk: number) => `export function scaleCase${file}_${chunk}() {
  const queueName = "semantic checkpoint ${chunk}";
  const retryPolicy = "bounded exponential backoff";
  return { queueName, retryPolicy, owner: "operations" };
${"  // Deterministic scale workload.\n".repeat(MAX_CHUNK_LINES - OVERLAP_LINES - 5)}}
`;

const textBlock = (file: number, chunk: number) => `Scale handbook ${file}.${chunk}
The semantic search checkpoint explains how operations teams diagnose retry policy,
queue ownership, and stale publication signals without relying on exact query words.
This paragraph is intentionally deterministic so repeated benchmark runs compare the
same source material.
`;

export function scaleCorpusPath(root: string, index: number, kind: ScaleCorpusKind) {
  const prefix = kind === "code" ? "code" : kind === "text" ? "text" : index % 2 ? "text" : "code";
  return `${root}/${prefix}-${String(index).padStart(5, "0")}${prefix === "code" ? ".ts" : ".md"}`;
}

export function scaleCorpusContent(
  index: number,
  kind: ScaleCorpusKind,
  chunksPerFile = SCALE_FILE_CHUNKS,
) {
  const name = basename(scaleCorpusPath(".", index, kind));
  const blocks: string[] = [];
  for (let chunk = 0; chunk < chunksPerFile; chunk++)
    blocks.push(name.endsWith(".ts") ? codeBlock(index, chunk) : textBlock(index, chunk));
  return blocks.join(name.endsWith(".ts") ? "" : "\n");
}

export function percentile(sorted: number[], percentileRank: number) {
  if (!sorted.length) return 0;
  const index = Math.ceil((percentileRank / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)]!;
}

function parseTimingSample(value: unknown): TimingSample {
  if (
    !value ||
    typeof value !== "object" ||
    !("stage" in value) ||
    typeof value.stage !== "string" ||
    !value.stage.trim() ||
    !("milliseconds" in value) ||
    typeof value.milliseconds !== "number" ||
    !Number.isFinite(value.milliseconds) ||
    value.milliseconds < 0
  )
    return Errors.raise(
      "INVALID_DATA",
      "Timing samples require a nonempty stage and finite nonnegative milliseconds",
    );
  return { stage: value.stage, milliseconds: value.milliseconds };
}

/**
 * Ignore unrelated reports, but reject malformed timing-bearing reports rather
 * than silently dropping measurements and biasing their percentiles.
 */
export function extractTimingSamples(value: unknown): { reports: number; samples: TimingSample[] } {
  const values = Array.isArray(value) ? value : [value];
  const samples: TimingSample[] = [];
  let reports = 0;
  for (const report of values) {
    if (!report || typeof report !== "object" || !("timings" in report)) continue;
    const timings = (report as { timings?: unknown }).timings;
    if (!Array.isArray(timings))
      return Errors.raise("INVALID_DATA", "Report timings must be an array");
    if (!timings.length) continue;
    reports++;
    for (const timing of timings) samples.push(parseTimingSample(timing));
  }
  return { reports, samples };
}

export function summarizeTimings(samples: TimingSample[]): TimingSummary[] {
  const byStage = new Map<string, number[]>();
  for (const input of samples) {
    const sample = parseTimingSample(input);
    const values = byStage.get(sample.stage) ?? [];
    values.push(sample.milliseconds);
    byStage.set(sample.stage, values);
  }
  return [...byStage.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([stage, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        stage,
        samples: sorted.length,
        p50Milliseconds: percentile(sorted, 50),
        p95Milliseconds: percentile(sorted, 95),
        minMilliseconds: sorted[0]!,
        maxMilliseconds: sorted.at(-1)!,
      };
    });
}
