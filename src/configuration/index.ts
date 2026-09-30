import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Context, Effect, Layer } from "effect";
import { Errors, type AppError } from "../errors/index.js";
import { FileSystem, FileSystemService } from "../filesystem/index.js";
import { CONFIG_FILENAME } from "./consts.js";
import type { ResolvedConfig } from "./types.js";
import { parseConfig } from "./utils.js";

export class ConfigurationPath extends Context.Reference<ConfigurationPath>()("ConfigurationPath", {
  defaultValue: (): string | undefined => undefined,
}) {}

export class ConfigurationService {
  public constructor(private readonly _fs: FileSystemService) {}

  /**
   * Discover only at the selected root (or a file root's parent), never by walking
   * ancestors. Explicit paths are cwd-relative; selection patterns are config-relative.
   * Missing automatic config is allowed; an explicit missing config is an error.
   */
  public load(rootArg: string): Effect.Effect<ResolvedConfig, AppError> {
    return Effect.gen(this, function* () {
      const root = resolve(rootArg);
      const info = yield* this._fs.stat(root);
      const rootBase = info.isDirectory() ? root : dirname(root);
      const explicit = yield* ConfigurationPath;
      const path = explicit === undefined ? join(rootBase, CONFIG_FILENAME) : resolve(explicit);
      const raw = yield* this._fs.read(path).pipe(
        Effect.catchIf(
          (error) => explicit === undefined && error.metadata.nativeCode === "ENOENT",
          () => Effect.succeed(undefined),
        ),
      );
      if (raw === undefined)
        return { base: rootBase, config: { version: 1 } } satisfies ResolvedConfig;
      const base = dirname(path);
      const within = relative(base, root);
      if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within))
        return yield* Errors.fail(
          "INVALID_ARGUMENT",
          "Root must be inside the configuration directory",
          { path },
        );
      const config = yield* Errors.attempt(() => parseConfig(JSON.parse(raw)), "INVALID_DATA", {
        path,
      });
      return { path, base, config } satisfies ResolvedConfig;
    });
  }
}

export class Configuration extends Context.Tag("Configuration")<
  Configuration,
  ConfigurationService
>() {}
export const ConfigurationLive = Layer.effect(
  Configuration,
  Effect.map(FileSystem, (fs) => new ConfigurationService(fs)),
);
