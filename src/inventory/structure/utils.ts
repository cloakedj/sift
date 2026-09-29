import type { InventoryChunk, InventoryResource } from "../types.js";
import type { SourceUnit, SourceLink } from "./types.js";
import { Errors } from "../../errors/index.js";
import { hash } from "../../shared/utils.js";

/**
 * Read the exact original region, including descendants, only from its source
 * version. Retrieval links are navigation hints, not validity dependencies.
 */
export function reassembleUnit(
  unit: SourceUnit,
  resource: InventoryResource,
  source: Buffer,
): string {
  if (
    unit.resourceId !== resource.id ||
    unit.resourceHash !== resource.resourceHash ||
    hash(source) !== resource.resourceHash
  )
    return Errors.raise("INCOMPLETE", "Cannot reassemble a unit from a different source version");
  if (
    !Number.isInteger(unit.startByte) ||
    !Number.isInteger(unit.endByte) ||
    unit.startByte < 0 ||
    unit.endByte > source.length ||
    unit.endByte <= unit.startByte
  )
    return Errors.raise("INVALID_DATA", "Invalid unit source range");
  const bytes = source.subarray(unit.startByte, unit.endByte);
  if (hash(bytes) !== unit.contentHash)
    return Errors.raise("INCOMPLETE", "Unit content hash does not match source");
  return bytes.toString("utf8");
}

/**
 * Link continuation pieces and hierarchy representatives without connecting
 * unrelated sections. Only immediate neighbors in the same parent are adjacent.
 * Contains edges point to one representative per child, not every child piece.
 */
export function linkStructure(chunks: InventoryChunk[]): void {
  const files = new Map<string, InventoryChunk[]>();
  for (const chunk of chunks) {
    const file = files.get(chunk.resourceId) ?? [];
    file.push(chunk);
    files.set(chunk.resourceId, file);
  }
  for (const file of files.values()) {
    const units = new Map<string, InventoryChunk[]>();
    for (const chunk of file) {
      const id = chunk.structure?.unit?.id;
      if (!id) continue;
      const parts = units.get(id) ?? [];
      parts.push(chunk);
      units.set(id, parts);
    }
    const siblings = new Map<string, InventoryChunk[]>();
    for (const parts of units.values()) {
      parts.sort((a, b) => a.startByte - b.startByte);
      const parent = parts[0]!.structure!.unit!.parentId;
      const group = siblings.get(parent) ?? [];
      group.push(parts[0]!);
      siblings.set(parent, group);
      parts.forEach((chunk, index) => {
        chunk.structure!.part = { index, count: parts.length };
      });
    }
    for (const group of siblings.values()) group.sort((a, b) => a.startByte - b.startByte);
    for (const chunk of file) {
      const structure = chunk.structure;
      if (!structure) continue;
      const links: SourceLink[] = structure.related.filter((link) => link.relation === "reference");
      const add = (target: InventoryChunk | undefined, relation: SourceLink["relation"]) => {
        if (target && target.id !== chunk.id && !links.some((link) => link.id === target.id))
          links.push({ id: target.id, relation, basis: "source-structure" });
      };
      const unit = structure.unit;
      if (unit) {
        const parts = units.get(unit.id)!;
        const index = parts.indexOf(chunk);
        add(parts[index - 1], "continuation");
        add(parts[index + 1], "continuation");
        for (const ancestor of [
          unit.parentId,
          ...(structure.ancestors ?? []).map((item) => item.id),
        ])
          add(units.get(ancestor)?.[0], "container");
        for (const child of siblings.get(unit.id) ?? []) add(child, "contains");
        const group = siblings.get(unit.parentId)!;
        const position = group.findIndex((item) => item.structure!.unit!.id === unit.id);
        add(group[position - 1], "adjacent");
        add(group[position + 1], "adjacent");
      } else {
        const index = file.indexOf(chunk);
        add(file[index - 1], "adjacent");
        add(file[index + 1], "adjacent");
      }
      structure.related = links;
    }
  }
}
