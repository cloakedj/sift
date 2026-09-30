import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { Errors, type AppError } from "../errors/index.js";
import { Configuration, ConfigurationService } from "../configuration/index.js";
import { SelectionService } from "../configuration/selection.js";
import { FileSystem, type FileSystemService } from "../filesystem/index.js";
import { CHUNKER_VERSION, MAX_CHUNK_BYTES, MAX_CHUNK_LINES, defaultPolicy } from "./consts.js";
import { ResourceReader } from "./reader.js";
import { linkCodeReferences } from "./syntax/utils.js";
import { linkStructure } from "./structure/utils.js";
import type { DiscoveryPolicy, Inventory } from "./types.js";

export class InventoryService {
  public constructor(
    private readonly _fs: FileSystemService,
    private readonly _configuration: ConfigurationService = new ConfigurationService(_fs),
  ) {}

  public configuration(root: string) {
    return this._configuration.load(root);
  }
  /**
   * Inventory permitted resources and bounded chunks without inference or writes.
   */
  public discover(
    rootArg: string,
    policy: DiscoveryPolicy = defaultPolicy,
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
      yield* this._visit(root, base, effectivePolicy, inventory, selection);
      linkCodeReferences(inventory.chunks);
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
  ): Effect.Effect<void, AppError> {
    const path = relative(base, file).split("\\").join("/") || ".";
    return Effect.gen(this, function* () {
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
          yield* this._visit(join(file, entry), base, policy, inventory, selection);
      } else if (info.isFile()) {
        if (
          policy.files.has(name.toLowerCase()) ||
          policy.extensions.has(extname(name).toLowerCase()) ||
          policy.patterns.some((pattern) => pattern.test(name))
        ) {
          inventory.skipped.push({ path, reason: "denylisted file" });
          return;
        }
        const result = yield* new ResourceReader(file, path).read();
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
export const discoverInventory = (root: string, policy = defaultPolicy) =>
  Effect.flatMap(InventoryServiceTag, (service) => service.discover(root, policy));
