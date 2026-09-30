import type { Inventory, InventoryResource } from "../inventory/types.js";
import type { Candidate, CandidateSource, HarvestConfig } from "./types.js";
import { SOURCE_PRIORITY } from "./consts.js";

export const normalizeLabel = (value: string) =>
  value.normalize("NFC").toLowerCase().trim().replace(/\s+/gu, " ");
export const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function resourceTexts(inventory: Inventory) {
  const chunksByResource = new Map<string, typeof inventory.chunks>();
  for (const chunk of inventory.chunks) {
    const chunks = chunksByResource.get(chunk.resourceId) ?? [];
    chunks.push(chunk);
    chunksByResource.set(chunk.resourceId, chunks);
  }
  const texts = new Map<string, string>();
  for (const resource of inventory.resources) {
    const pieces: Buffer[] = [];
    let end = 0;
    for (const chunk of (chunksByResource.get(resource.id) ?? []).sort(
      (a, b) => a.startByte - b.startByte,
    )) {
      if (chunk.endByte <= end) continue;
      pieces.push(Buffer.from(chunk.text).subarray(Math.max(0, end - chunk.startByte)));
      end = chunk.endByte;
    }
    texts.set(resource.id, Buffer.concat(pieces).toString("utf8"));
  }
  return texts;
}
export function resourceText(inventory: Inventory, resource: InventoryResource) {
  return resourceTexts(inventory).get(resource.id) ?? "";
}
export const identifierForms = (value: string) => [
  ...new Set([
    value,
    ...value
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
      .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  ]),
];

/**
 * Reserve capacity for rare explicit labels, then select round-robin across resources
 * within each source-priority tier. Rank by global frequency within each resource;
 * code-point ordering keeps results independent of locale and discovery order.
 */
export function selectCandidates(candidates: Candidate[], config: HarvestConfig) {
  const frequencies = new Map<string, number>();
  const sources = new Map<string, Set<CandidateSource>>();
  const resourcesBySource = new Map<CandidateSource, Set<string>>();
  for (const candidate of candidates) {
    const resources = new Set<string>();
    const candidateSources = new Set<CandidateSource>();
    for (const evidence of candidate.evidence) {
      resources.add(evidence.resourceId);
      candidateSources.add(evidence.source);
      const sourceResources = resourcesBySource.get(evidence.source) ?? new Set<string>();
      sourceResources.add(evidence.resourceId);
      resourcesBySource.set(evidence.source, sourceResources);
    }
    frequencies.set(candidate.id, resources.size);
    sources.set(candidate.id, candidateSources);
  }
  const chosen = new Set<string>();
  const ordered = [...candidates].sort(
    (a, b) => frequencies.get(b.id)! - frequencies.get(a.id)! || compareText(a.name, b.name),
  );
  const candidatesBySourceResource = new Map<string, Candidate[]>();
  for (const candidate of ordered)
    for (const evidence of candidate.evidence) {
      const key = `${evidence.source}\0${evidence.resourceId}`;
      const queue = candidatesBySourceResource.get(key) ?? [];
      queue.push(candidate);
      candidatesBySourceResource.set(key, queue);
    }
  const buildQueues = (pool: Candidate[], source: CandidateSource) => {
    const poolIds = new Set(pool.map((candidate) => candidate.id));
    return [...(resourcesBySource.get(source) ?? [])]
      .sort(compareText)
      .map((resource) =>
        (candidatesBySourceResource.get(`${source}\0${resource}`) ?? []).filter((candidate) =>
          poolIds.has(candidate.id),
        ),
      )
      .filter((queue) => queue.length);
  };
  const choose = (pool: Candidate[], limit: number) => {
    for (const source of SOURCE_PRIORITY) {
      const queues = buildQueues(pool, source);
      let progress = true;
      while (progress && chosen.size < limit) {
        progress = false;
        for (const queue of queues) {
          while (queue.length && chosen.has(queue[0]!.id)) queue.shift();
          const next = queue.shift();
          if (next && chosen.size < limit) {
            chosen.add(next.id);
            progress = true;
          }
        }
      }
    }
  };
  choose(
    ordered.filter(
      (c) =>
        frequencies.get(c.id)! <= config.rareResourceCount &&
        (sources.get(c.id)!.has("heading") || sources.get(c.id)!.has("frontMatter")),
    ),
    Math.floor(config.poolPerDimension * config.rareReservation),
  );
  choose(ordered, config.poolPerDimension);
  return [...chosen];
}
