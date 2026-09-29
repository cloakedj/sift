import { join, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { Errors } from "../errors/index.js";
import { FileSystem, type FileSystemService } from "../filesystem/index.js";
import { InventoryServiceTag, type InventoryService } from "../inventory/index.js";
import { INDEX_FILE, MAX_HITS } from "./consts.js";
import type { LexicalIndex } from "./types.js";
import { scoreChunk, tokenize } from "./utils.js";

export class LexicalService {
  public constructor(
    private readonly _fs: FileSystemService,
    private readonly _inventory: InventoryService,
  ) {}
  public build(rootArg = ".") {
    return Effect.gen(this, function* () {
      const inventory = yield* this._inventory.discover(rootArg);
      if (!inventory.complete)
        return yield* Errors.fail(
          "INCOMPLETE",
          "Discovery incomplete; lexical index was not written",
        );
      const index: LexicalIndex = {
        version: 1,
        root: inventory.root,
        chunks: inventory.chunks.map((chunk) => ({
          ...chunk,
          terms: tokenize(`${chunk.path}\n${chunk.text}`),
        })),
      };
      const path = join(inventory.root, ".jev", INDEX_FILE);
      yield* this._fs.mkdir(join(inventory.root, ".jev"));
      yield* this._fs.write(path, JSON.stringify(index, null, 2));
      return { files: inventory.resources.length, chunks: index.chunks.length, path };
    });
  }
  public recover(query: string, root = ".", limit = MAX_HITS) {
    return Effect.gen(this, function* () {
      const terms = tokenize(query);
      if (!terms.length)
        return yield* Errors.fail("INVALID_ARGUMENT", "Search query cannot be empty");
      const inventory = yield* this._inventory.discover(root);
      if (!inventory.complete)
        return yield* Errors.fail(
          "INCOMPLETE",
          "Discovery incomplete; lexical fallback unavailable",
        );
      const resources = new Map(inventory.resources.map((resource) => [resource.id, resource]));
      return inventory.chunks
        .map((chunk) => {
          const indexed = { ...chunk, terms: tokenize(`${chunk.path}\n${chunk.text}`) };
          return {
            chunk: indexed,
            resource: resources.get(chunk.resourceId)!,
            score: scoreChunk(indexed, query, terms),
          };
        })
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
        .slice(0, limit);
    });
  }
  public search(query: string, root = ".") {
    return Effect.gen(this, function* () {
      const terms = tokenize(query);
      if (!terms.length)
        return yield* Errors.fail("INVALID_ARGUMENT", "Search query cannot be empty");
      const index = yield* this._fs.readJson<LexicalIndex>(join(resolve(root), ".jev", INDEX_FILE));
      if (!index)
        return yield* Errors.fail(
          "NOT_FOUND",
          "No lexical diagnostic index. Run `npm run cli -- index <root>` first. Hybrid search does not require this diagnostic index.",
        );
      if (index.version !== 1 || !Array.isArray(index.chunks))
        return yield* Errors.fail("INVALID_DATA", "Invalid lexical diagnostic index");
      return index.chunks
        .map((chunk) => ({ chunk, score: scoreChunk(chunk, query, terms) }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_HITS);
    });
  }
}
export class Lexical extends Context.Tag("Lexical")<Lexical, LexicalService>() {}
export const LexicalLive = Layer.effect(
  Lexical,
  Effect.gen(function* () {
    return new LexicalService(yield* FileSystem, yield* InventoryServiceTag);
  }),
);
