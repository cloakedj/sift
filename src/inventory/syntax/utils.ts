import { dirname, extname, normalize, join } from "node:path";
import type { InventoryChunk } from "../types.js";
import type { SourceLink } from "../structure/types.js";

/**
 * Resolve only indexed declarations; ambiguous imports and external modules remain unlinked.
 */
export function linkCodeReferences(chunks: InventoryChunk[]): void {
  const paths = new Map<string, InventoryChunk[]>();
  for (const chunk of chunks) {
    const group = paths.get(chunk.path) ?? [];
    group.push(chunk);
    paths.set(chunk.path, group);
  }
  for (const chunk of chunks) {
    if (!chunk.structure) continue;
    const siblings = paths.get(chunk.path)!;
    const links: SourceLink[] = [];
    const add = (target: InventoryChunk, basis: SourceLink["basis"]) => {
      if (target.id !== chunk.id && !links.some((link) => link.id === target.id))
        links.push({ id: target.id, relation: "reference", basis });
    };
    for (const reference of chunk.structure.references ?? []) {
      if (reference.startByte !== undefined) {
        const target = siblings.find(
          (item) => item.startByte <= reference.startByte! && item.endByte > reference.startByte!,
        );
        if (target) add(target, "bound-symbol");
      } else if (reference.module?.startsWith(".")) {
        const requested = normalize(join(dirname(chunk.path), reference.module))
          .split("\\")
          .join("/");
        const stem = requested.replace(/\.(?:mjs|cjs|js)$/, "");
        const possible = new Set([
          requested,
          ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"].map((extension) => stem + extension),
          ...(!extname(requested)
            ? ["/index.ts", "/index.tsx", "/index.js"].map((suffix) => requested + suffix)
            : []),
        ]);
        const matches = [...paths.keys()].filter((path) => possible.has(path));
        if (matches.length !== 1) continue;
        const targets = paths
          .get(matches[0]!)!
          .filter((item) => item.structure?.exported && item.structure.symbol === reference.symbol);
        if (new Set(targets.map((target) => target.structure?.unit?.id ?? target.id)).size === 1)
          for (const target of targets) add(target, "indexed-import");
      }
    }
    chunk.structure.related = links;
  }
}
