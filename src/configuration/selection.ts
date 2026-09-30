import { dirname, join, relative, resolve } from "node:path";
import { Effect } from "effect";
import ignore, { type Ignore } from "ignore";
import { Minimatch } from "minimatch";
import { Errors } from "../errors/index.js";
import type { FileSystemService } from "../filesystem/index.js";
import type { ResolvedConfig } from "./types.js";

export class SelectionService {
  private readonly _include: Minimatch[] | undefined;
  private readonly _exclude: Minimatch[];
  private readonly _ignores = new Map<string, Ignore>();

  public constructor(
    private readonly _fs: FileSystemService,
    private readonly _settings: ResolvedConfig,
  ) {
    const compile = (pattern: string) =>
      new Minimatch(pattern.replace(/\/$/, "/**"), { dot: true, nonegate: true, nocomment: true });
    this._include = _settings.config.discovery?.include?.map(compile);
    this._exclude = (_settings.config.discovery?.exclude ?? []).map(compile);
  }

  public loadIgnore(directory: string) {
    if (!this._settings.config.discovery?.respectGitignore || this._ignores.has(directory))
      return Effect.void;
    const path = join(directory, ".gitignore");
    return this._fs.stat(path).pipe(
      Effect.flatMap((info) => (info.isSymbolicLink() ? Effect.succeed("") : this._fs.read(path))),
      Effect.catchIf(
        (error) => error.metadata.nativeCode === "ENOENT",
        () => Effect.succeed(""),
      ),
      Effect.flatMap((raw) =>
        Errors.attempt(
          () => {
            this._ignores.set(directory, ignore().add(raw));
          },
          "INVALID_DATA",
          { path },
        ),
      ),
    );
  }

  public prepare(root: string) {
    const directories: string[] = [];
    for (let current = dirname(root); ; current = dirname(current)) {
      const path = relative(this._settings.base, current);
      if (path === ".." || path.startsWith("../") || path.startsWith("..\\")) break;
      directories.unshift(current);
      if (current === this._settings.base || current === dirname(current)) break;
    }
    return Effect.forEach(directories, (directory) => this.loadIgnore(directory), {
      discard: true,
    });
  }

  /**
   * Excludes prune subtrees; includes select files, never prematurely prune their parents.
   */
  public reason(file: string, directory: boolean): string | undefined {
    if (resolve(file) === this._settings.path) return "configuration file";
    const path = relative(this._settings.base, file).split("\\").join("/");
    if (!path) return undefined;
    const segments = path.split("/");
    for (let depth = 1; depth <= segments.length; depth++) {
      const candidate = segments.slice(0, depth).join("/");
      const isDirectory = depth < segments.length || directory;
      if (
        this._exclude.some(
          (pattern) => pattern.match(candidate) || (isDirectory && pattern.match(`${candidate}/`)),
        )
      )
        return "excluded by configuration";
    }
    let ignored = false;
    for (const [base, rules] of this._ignores) {
      const local = relative(base, file).split("\\").join("/");
      if (!local || local === ".." || local.startsWith("../")) continue;
      const result = rules.test(directory ? `${local}/` : local);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    if (ignored) return "gitignored";
    if (!directory && this._include && !this._include.some((pattern) => pattern.match(path)))
      return "not included by configuration";
    return undefined;
  }
}
