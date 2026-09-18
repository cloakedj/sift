import {
  lstat,
  readdir,
  readFile,
  mkdir,
  writeFile,
  rename,
  rm,
  appendFile,
} from "node:fs/promises";
import { Context, Effect, Layer } from "effect";
import { Errors } from "../errors/index.js";

export class FileSystemService {
  public stat(path: string) {
    return Errors.async(() => lstat(path), "IO", { path, operation: "stat" });
  }
  public list(path: string) {
    return Errors.async(() => readdir(path), "IO", { path, operation: "list" });
  }
  public read(path: string) {
    return Errors.async((signal) => readFile(path, { encoding: "utf8", signal }), "IO", {
      path,
      operation: "read",
    });
  }
  public mkdir(path: string) {
    return Effect.uninterruptible(
      Errors.async(() => mkdir(path, { recursive: true }), "IO", { path, operation: "mkdir" }),
    );
  }
  // Mutations must settle before scoped finalizers release locks/remove temp files.
  public write(path: string, data: string, exclusive = false) {
    return Effect.uninterruptible(
      Errors.async(() => writeFile(path, data, { flag: exclusive ? "wx" : "w" }), "IO", {
        path,
        operation: "write",
      }),
    );
  }
  public append(path: string, data: string) {
    return Effect.uninterruptible(
      Errors.async(() => appendFile(path, data), "IO", { path, operation: "append" }),
    );
  }
  public rename(from: string, to: string) {
    return Effect.uninterruptible(
      Errors.async(() => rename(from, to), "IO", { path: to, operation: "rename" }),
    );
  }
  public remove(path: string) {
    return Effect.uninterruptible(
      Errors.async(() => rm(path, { force: true }), "IO", { path, operation: "remove" }),
    );
  }
  public readJson<T>(path: string) {
    return this.read(path).pipe(
      Effect.flatMap((raw) => Errors.attempt(() => JSON.parse(raw) as T, "INVALID_DATA", { path })),
      Effect.catchIf(
        (error) => error.metadata.nativeCode === "ENOENT",
        () => Effect.succeed(undefined),
      ),
    );
  }
}
export class FileSystem extends Context.Tag("FileSystem")<FileSystem, FileSystemService>() {}
export const FileSystemLive = Layer.succeed(FileSystem, new FileSystemService());
