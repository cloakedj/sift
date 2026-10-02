import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { Errors, type AppError } from "../errors/index.js";
import { Configuration, ConfigurationService } from "../configuration/index.js";
import { SelectionService } from "../configuration/selection.js";
import { FileSystem, type FileSystemService } from "../filesystem/index.js";
import type { ActivityHandle } from "../messages/types.js";
import { CHUNKER_VERSION, MAX_CHUNK_BYTES, MAX_CHUNK_LINES, defaultPolicy } from "./consts.js";
import { ResourceReader } from "./reader.js";
import { linkCodeReferences } from "./syntax/utils.js";
import { linkStructure } from "./structure/utils.js";
import type { DiscoveryPolicy, Inventory, InventoryCache, ResourceSnapshot } from "./types.js";
import { hash } from "../shared/utils.js";

export class InventoryService {
  public constructor(
    private readonly _fs: FileSystemService,
    private readonly _configuration: ConfigurationService = new ConfigurationService(_fs),
  ) {}

  public configuration(root: string) {
    return this._configuration.load(root);
  }
  /**
   * Inventory permitted resources without inference. Optional onboarding caches
   * reuse chunks only after byte hashing; cache-free discovery performs no writes.
   */
  public discover(
    rootArg: string,
    policy: DiscoveryPolicy = defaultPolicy,
    activity?: ActivityHandle,
    cache?: InventoryCache,
  ): Effect.Effect<Inventory, AppError> {
    return Effect.gen(this, function* () {
      const root = resolve(rootArg);
      const rootInfo = yield* this._fs.stat(root);
      const base = rootInfo.isDirectory() ? root : dirname(root);
      const settings = yield* this.configuration(root);
      const selection = yield* Errors.attempt(
        () => new SelectionService(this._fs, settings),
        "INVALID_ARGUMENT",
      );
      activity?.update("Onboarding: preparing discovery rules and ignore files");
      yield* selection.prepare(root);
      const effectivePolicy = {
        ...policy,
        hiddenDirectories: settings.config.discovery?.hiddenDirectories ?? policy.hiddenDirectories,
      };
      const inventory: Inventory = {
        configuration: settings,
        schemaVersion: 1,
        mode: "dry-run",
        root,
        chunkerVersion: CHUNKER_VERSION,
        limits: { maxChunkBytes: MAX_CHUNK_BYTES, maxChunkLines: MAX_CHUNK_LINES },
        resources: [],
        chunks: [],
        skipped: [],
        failures: [],
        complete: true,
        inferenceCalls: 0,
        published: false,
      };
      yield* this._visit(root, base, effectivePolicy, inventory, selection, activity, cache);
      activity?.update(
        `Onboarding: linking code references across ${inventory.chunks.length} chunks`,
      );
      yield* Effect.yieldNow();
      linkCodeReferences(inventory.chunks);
      activity?.update(
        `Onboarding: linking document structure across ${inventory.chunks.length} chunks`,
      );
      yield* Effect.yieldNow();
      linkStructure(inventory.chunks);
      inventory.complete = inventory.failures.length === 0;
      return inventory;
    });
  }
  private _visit(
    file: string,
    base: string,
    policy: DiscoveryPolicy,
    inventory: Inventory,
    selection: SelectionService,
    activity?: ActivityHandle,
    cache?: InventoryCache,
  ): Effect.Effect<void, AppError> {
    const path = relative(base, file).split("\\").join("/") || ".";
    return Effect.gen(this, function* () {
      activity?.update(
        `Onboarding: discovering resources — ${inventory.resources.length} read, ${inventory.chunks.length} chunks, ${inventory.skipped.length} skipped, ${inventory.failures.length} failed`,
      );
      const info = yield* this._fs.stat(file);
      const name = basename(file);
      if (info.isSymbolicLink()) {
        inventory.skipped.push({ path, reason: "symlink" });
        return;
      }
      const reason = selection.reason(file, info.isDirectory());
      if (reason) {
        inventory.skipped.push({ path, reason });
        return;
      }
      if (info.isDirectory()) {
        if (policy.directories.has(name) || (policy.hiddenDirectories && name.startsWith("."))) {
          inventory.skipped.push({ path, reason: "denylisted directory" });
          return;
        }
        yield* selection.loadIgnore(file);
        for (const entry of (yield* this._fs.list(file)).sort())
          yield* this._visit(
            join(file, entry),
            base,
            policy,
            inventory,
            selection,
            activity,
            cache,
          );
      } else if (info.isFile()) {
        if (
          policy.files.has(name.toLowerCase()) ||
          policy.extensions.has(extname(name).toLowerCase()) ||
          policy.patterns.some((pattern) => pattern.test(name))
        ) {
          inventory.skipped.push({ path, reason: "denylisted file" });
          return;
        }
        const cachePath = `inventory-${hash(`${CHUNKER_VERSION}:${file}:${path}`)}.json`;
        const cached = cache ? yield* cache.read<ResourceSnapshot>(cachePath) : undefined;
        if (
          cached !== undefined &&
          (!cached ||
            !cached.resource ||
            typeof cached.resource.resourceHash !== "string" ||
            typeof cached.resource.uri !== "string" ||
            typeof cached.resource.path !== "string" ||
            !Array.isArray(cached.chunks) ||
            cached.chunks.some(
              (chunk) =>
                !chunk ||
                typeof chunk.id !== "string" ||
                typeof chunk.text !== "string" ||
                typeof chunk.chunkHash !== "string" ||
                typeof chunk.resourceId !== "string" ||
                typeof chunk.startByte !== "number" ||
                typeof chunk.endByte !== "number",
            ))
        )
          return yield* Errors.fail("INVALID_DATA", "Invalid cached resource snapshot", {
            path: cachePath,
          });
        const result = yield* new ResourceReader(file, path).read(cached);
        // Persist before cross-file links mutate chunks; links are rebuilt from
        // the current permitted corpus, never resurrected from an old snapshot.
        if (cache?.write && JSON.stringify(cached?.resource) !== JSON.stringify(result.resource))
          yield* cache.write(cachePath, result);
        inventory.resources.push(result.resource);
        for (const chunk of result.chunks) inventory.chunks.push(chunk);
      } else inventory.skipped.push({ path, reason: "not a regular file" });
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          if (error.code === "BINARY_RESOURCE")
            inventory.skipped.push({ path, reason: error.reason });
          else
            inventory.failures.push({
              path,
              error: error.message,
              details: Errors.serialize(error),
            });
        }),
      ),
    );
  }
}
export class InventoryServiceTag extends Context.Tag("Inventory")<
  InventoryServiceTag,
  InventoryService
>() {}
export const InventoryLive = Layer.effect(
  InventoryServiceTag,
  Effect.gen(function* () {
    return new InventoryService(yield* FileSystem, yield* Configuration);
  }),
);
export const discoverInventory = (
  root: string,
  policy = defaultPolicy,
  activity?: ActivityHandle,
) => Effect.flatMap(InventoryServiceTag, (service) => service.discover(root, policy, activity));
