import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Stream } from "effect";
import { Errors } from "../errors/index.js";
import { hash } from "../shared/utils.js";
import { CHUNKER_VERSION, MAX_CHUNK_BYTES, MAX_CHUNK_LINES, OVERLAP_LINES } from "./consts.js";
import type { InventoryChunk, Unit } from "./types.js";

export class ResourceReader {
  private readonly _id: string;
  private readonly _uri: string;
  private readonly _digest = createHash("sha256");
  private readonly _decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  private readonly _chunks: InventoryChunk[] = [];
  private readonly _document: boolean;
  private _window: Unit[] = [];
  private _pending = Buffer.alloc(0);
  private _offset = 0;
  private _line = 1;
  private _bytes = 0;
  private _lastEmittedEnd = -1;

  public constructor(
    private readonly _file: string,
    private readonly _path: string,
  ) {
    this._uri = pathToFileURL(_file).href;
    this._id = hash(this._uri);
    this._document = [".md", ".markdown", ".txt", ".rst"].includes(extname(_file).toLowerCase());
  }
  /**
   * Stream the source into validated chunks and release the stream on completion or failure.
   */
  public read() {
    return Effect.scoped(
      Effect.gen(this, function* () {
        const stream = yield* Effect.acquireRelease(
          Errors.attempt(() => createReadStream(this._file, { highWaterMark: 64 * 1024 }), "IO", {
            path: this._path,
          }),
          (stream) =>
            Effect.sync(() => {
              stream.destroy();
            }),
        );
        yield* Stream.fromAsyncIterable(stream as AsyncIterable<Buffer>, (cause) =>
          Errors.normalize(cause, "IO", { path: this._path }),
        ).pipe(
          Stream.runForEach((buffer) =>
            Errors.attempt(() => this._consume(buffer), "IO", { path: this._path }),
          ),
        );
        yield* Errors.attempt(
          () => {
            if (this._pending.length) this._accept(this._pending);
            this._emit();
          },
          "IO",
          { path: this._path },
        );
        return {
          resource: {
            id: this._id,
            uri: this._uri,
            path: this._path,
            resourceHash: this._digest.digest("hex"),
            bytes: this._bytes,
            chunkCount: this._chunks.length,
          },
          chunks: this._chunks,
        };
      }),
    );
  }
  /**
   * Materialize the current window once with stable hashes and source ranges.
   */
  private _emit(): void {
    if (!this._window.length || this._window.at(-1)!.end <= this._lastEmittedEnd) return;
    const text = this._window.map((unit) => unit.text).join("");
    const first = this._window[0]!;
    const last = this._window.at(-1)!;
    const chunkHash = hash(text);
    this._chunks.push({
      id: hash(`${this._id}:${CHUNKER_VERSION}:${first.start}:${last.end}:${chunkHash}`),
      resourceId: this._id,
      path: this._path,
      startLine: first.line,
      endLine: last.line,
      startByte: first.start,
      endByte: last.end,
      chunkHash,
      text,
    });
    this._lastEmittedEnd = last.end;
  }
  /**
   * Decode a bounded UTF-8 unit and advance the chunk window with configured overlap.
   */
  private _accept(buffer: Buffer): void {
    let text: string;
    try {
      text = this._decoder.decode(buffer);
    } catch {
      return Errors.raise("BINARY_RESOURCE", "invalid UTF-8");
    }
    const unit = { text, start: this._offset, end: this._offset + buffer.length, line: this._line };
    this._offset += buffer.length;
    if (text.endsWith("\n")) this._line++;
    if (this._document && /^\s{0,3}#{1,6}\s/.test(text)) {
      this._emit();
      this._window = [];
    }
    const exceeds = () =>
      this._window.length > 0 &&
      (unit.end - this._window[0]!.start > MAX_CHUNK_BYTES ||
        unit.line - this._window[0]!.line >= MAX_CHUNK_LINES);
    if (exceeds()) {
      this._emit();
      this._window = this._document ? [] : this._window.slice(-OVERLAP_LINES);
      while (exceeds()) this._window.shift();
    }
    this._window.push(unit);
    if (this._document && text.trim() === "") {
      this._emit();
      this._window = [];
    }
  }
  /**
   * Hash incoming bytes, reject binary controls, and split pending data on UTF-8 boundaries.
   */
  private _consume(buffer: Buffer): void {
    this._digest.update(buffer);
    this._bytes += buffer.length;
    if (buffer.some((byte) => byte < 32 && ![9, 10, 12, 13].includes(byte)))
      Errors.raise("BINARY_RESOURCE", "binary control bytes");
    this._pending = Buffer.concat([this._pending, buffer]);
    while (this._pending.length) {
      const newline = this._pending.indexOf(10);
      let length: number;
      if (newline >= 0 && newline < MAX_CHUNK_BYTES) length = newline + 1;
      else if (this._pending.length > MAX_CHUNK_BYTES) {
        length = MAX_CHUNK_BYTES;
        while (length > 0 && (this._pending[length]! & 0xc0) === 0x80) length--;
        if (!length) Errors.raise("BINARY_RESOURCE", "invalid UTF-8");
      } else break;
      this._accept(this._pending.subarray(0, length));
      this._pending = this._pending.subarray(length);
    }
  }
}
