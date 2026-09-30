import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Context, Effect } from "effect";
import { ConfigurationService } from "../../configuration/index.js";
import { CONFIG_FILENAME } from "../../configuration/consts.js";
import { Errors } from "../../errors/index.js";
import { FileSystemService } from "../../filesystem/index.js";
import { CORPUS_COMMANDS, CORPUS_STRING_OPTIONS } from "./consts.js";
import type { CorpusResolution } from "./types.js";

export class ResolvedCorpus extends Context.Reference<ResolvedCorpus>()("ResolvedCorpus", {
  defaultValue: (): CorpusResolution | undefined => undefined,
}) {}

export class CorpusResolver {
  public constructor(private readonly _fs = new FileSystemService()) {}

  /**
   * Only implicit CLI roots walk ancestors. Explicit roots and config overrides
   * preserve existing selection and state identity; absent configs fall back to cwd.
   * Only missing files are ignored, so inaccessible configs cannot silently widen scope.
   */
  public resolve(
    command: string | undefined,
    args: string[],
    config?: string,
    cwd = process.cwd(),
  ) {
    return Effect.gen(this, function* () {
      if (!command || !CORPUS_COMMANDS.has(command)) return { args };
      const parsed = yield* Errors.attempt(
        () =>
          parseArgs({
            args,
            allowPositionals: true,
            strict: false,
            options: {
              ...Object.fromEntries(
                CORPUS_STRING_OPTIONS.map((name) => [
                  name,
                  { type: "string" as const, multiple: name === "anchor" },
                ]),
              ),
              "no-discover-config": { type: "boolean" },
            },
          }),
        "INVALID_ARGUMENT",
      );
      const positionalRoot = command === "onboard" || command === "index";
      const explicitRoot = parsed.values.root as string | undefined;
      const suppliedRoot = explicitRoot ?? (positionalRoot ? parsed.positionals[0] : undefined);
      let root = resolve(cwd, suppliedRoot ?? ".");
      if (
        suppliedRoot === undefined &&
        config === undefined &&
        !parsed.values["no-discover-config"]
      ) {
        let directory = root;
        while (true) {
          const info = yield* this._fs.stat(join(directory, CONFIG_FILENAME)).pipe(
            Effect.catchIf(
              (error) => error.metadata.nativeCode === "ENOENT",
              () => Effect.succeed(undefined),
            ),
          );
          if (info) {
            if (info.isSymbolicLink())
              return yield* Errors.fail(
                "UNSAFE_PATH",
                "Refusing a symlinked corpus configuration",
                { path: join(directory, CONFIG_FILENAME) },
              );
            root = directory;
            break;
          }
          const parent = dirname(directory);
          if (parent === directory) break;
          directory = parent;
        }
      }
      const settings = yield* new ConfigurationService(this._fs).load(root);
      const info = yield* this._fs.stat(root);
      const resolution: CorpusResolution = {
        resolvedRoot: root,
        configPath: settings.path ?? null,
        stateDirectory: join(info.isDirectory() ? root : dirname(root), ".sift"),
      };
      return {
        args: suppliedRoot === undefined ? ["--root", root, ...args] : args,
        resolution,
      };
    });
  }
}
