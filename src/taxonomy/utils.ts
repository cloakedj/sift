import type { Inventory, InventoryResource } from "../inventory/types.js";
import type { Candidate, HarvestConfig } from "./types.js";
import { SOURCE_PRIORITY } from "./consts.js";

export const normalizeLabel = (value: string) =>
  value.normalize("NFC").toLowerCase().trim().replace(/\s+/gu, " ");
export const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function resourceText(inventory: Inventory, resource: InventoryResource) {
  const pieces: Buffer[] = [];
  let end = 0;
  for (const chunk of inventory.chunks
    .filter((chunk) => chunk.resourceId === resource.id)
    .sort((a, b) => a.startByte - b.startByte)) {
    if (chunk.endByte <= end) continue;
    pieces.push(Buffer.from(chunk.text).subarray(Math.max(0, end - chunk.startByte)));
    end = chunk.endByte;
  }
  return Buffer.concat(pieces).toString("utf8");
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

// Round-robin resource selection within each priority tier, with global frequency
// ranking inside each resource. Sorting uses code-point order, not locale/discovery order.
export function selectCandidates(candidates: Candidate[], config: HarvestConfig) {
  const frequency = (candidate: Candidate) =>
    new Set(candidate.evidence.map((e) => e.resourceId)).size;
  const chosen = new Set<string>();
  const ordered = [...candidates].sort(
    (a, b) => frequency(b) - frequency(a) || compareText(a.name, b.name),
  );
  const choose = (pool: Candidate[], limit: number) => {
    for (const source of SOURCE_PRIORITY) {
      const resources = [
        ...new Set(
          pool.flatMap((c) =>
            c.evidence.filter((e) => e.source === source).map((e) => e.resourceId),
          ),
        ),
      ].sort(compareText);
      const queues = resources.map((resource) =>
        pool.filter((c) =>
          c.evidence.some((e) => e.source === source && e.resourceId === resource),
        ),
      );
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
        frequency(c) <= config.rareResourceCount &&
        c.evidence.some((e) => e.source === "heading" || e.source === "frontMatter"),
    ),
    Math.floor(config.poolPerDimension * config.rareReservation),
  );
  choose(ordered, config.poolPerDimension);
  return [...chosen];
}
