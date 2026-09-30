import cliProgress from "cli-progress";
import ora, { type Ora } from "ora";
import { Context, Effect, Layer } from "effect";
import { Errors, type AppError } from "../errors/index.js";
import type {
  ActivityHandle,
  Message,
  MessageOptions,
  MessageSink,
  MessageTable,
  ProgressHandle,
  ProgressOptions,
} from "./types.js";
import { formatMessage, formatTable } from "./utils.js";

export class ConsoleSink implements MessageSink {
  public message(message: Message, diagnostic: boolean): void {
    const method =
      message.level === "error"
        ? "error"
        : message.level === "warning"
          ? "warn"
          : diagnostic
            ? "error"
            : message.level === "debug"
              ? "debug"
              : "info";
    console[method](formatMessage(message));
  }
  public output(value: string): void {
    console.log(value);
  }
}

class NoopProgressHandle implements ProgressHandle {
  public update(_current: number, _payload?: Record<string, unknown>): void {}
  public increment(_delta = 1, _payload?: Record<string, unknown>): void {}
  public stop(): void {}
}

class CliProgressHandle implements ProgressHandle {
  private readonly _bar: cliProgress.SingleBar;
  private _current: number;
  public constructor(options: ProgressOptions) {
    this._current = options.initial ?? 0;
    this._bar = new cliProgress.SingleBar(
      {
        stream: process.stderr,
        hideCursor: true,
        clearOnComplete: true,
        stopOnComplete: true,
        format: `${options.label} [{bar}] {percentage}% | {value}/{total} | {stage}`,
      },
      cliProgress.Presets.shades_classic,
    );
    this._bar.start(options.total, this._current, { stage: "starting", ...options.payload });
  }
  public update(current: number, payload: Record<string, unknown> = {}): void {
    this._current = current;
    this._bar.update(current, payload);
  }
  public increment(delta = 1, payload: Record<string, unknown> = {}): void {
    this.update(this._current + delta, payload);
  }
  public stop(): void {
    this._bar.stop();
  }
}

class SpinnerHandle implements ActivityHandle {
  private readonly _spinner: Ora;
  public constructor(text: string) {
    this._spinner = ora({ text, stream: process.stderr, discardStdin: false }).start();
  }
  public update(text: string): void {
    this._spinner.text = text;
  }
  public stop(): void {
    this._spinner.stop();
  }
}

class ReportingActivityHandle implements ActivityHandle {
  private _lastText = "";
  private _lastReported = 0;
  public constructor(
    private readonly _sink: MessageSink,
    private readonly _diagnostic: boolean,
  ) {}
  public update(text: string): void {
    const now = Date.now();
    if (text === this._lastText || (this._lastReported && now - this._lastReported < 1000)) return;
    this._lastText = text;
    this._lastReported = now;
    const match = /^(.*?):\s+(.+)$/.exec(text);
    this._sink.message(
      {
        label: match?.[1] ?? "Activity",
        level: "info",
        text: match?.[2] ?? text,
        tags: ["progress"],
      },
      this._diagnostic,
    );
  }
  public stop(): void {}
}

class DelayedSpinnerHandle implements ActivityHandle {
  private readonly _timer: ReturnType<typeof setTimeout> | undefined;
  private _handle: ActivityHandle | undefined;
  private _text: string;
  public constructor(
    text: string,
    private readonly _start: (text: string) => ActivityHandle,
    delayMilliseconds: number,
  ) {
    this._text = text;
    this._timer = setTimeout(() => {
      this._handle = this._start(this._text);
    }, delayMilliseconds);
  }
  public update(text: string): void {
    this._text = text;
    this._handle?.update(text);
  }
  public stop(): void {
    if (this._timer) clearTimeout(this._timer);
    this._handle?.stop();
  }
}

export class MessageService {
  private readonly _sink: MessageSink;
  private readonly _diagnosticsToStderr: boolean;
  private readonly _enableProgress: boolean;
  private _active: { stop(): void } | undefined;

  public constructor(options: MessageOptions = {}) {
    this._sink = options.sink ?? new ConsoleSink();
    this._diagnosticsToStderr = options.diagnosticsToStderr ?? false;
    this._enableProgress =
      !this._diagnosticsToStderr && !!process.stderr.isTTY && (options.enableProgress ?? true);
  }
  public report(message: Message) {
    return Errors.attempt(
      () => {
        this._active?.stop();
        this._sink.message(message, this._diagnosticsToStderr);
      },
      "IO",
      { operation: "message" },
    );
  }
  public table(message: Omit<Message, "text">, table: MessageTable) {
    return Errors.attempt(() => formatTable(table), "INVALID_DATA").pipe(
      Effect.flatMap((text) => this.report({ ...message, text: `\n${text}` })),
    );
  }
  public error(label: string, error: AppError) {
    return this.report({
      label,
      level: "error",
      text: error.message,
      tags: [error.code],
      error: Errors.serialize(error),
    });
  }
  public json(value: unknown) {
    return Errors.attempt(
      () => {
        this._active?.stop();
        this._sink.output(JSON.stringify(value));
      },
      "IO",
      { operation: "json-output" },
    );
  }
  public output(value: string) {
    return Errors.attempt(
      () => {
        this._active?.stop();
        this._sink.output(value);
      },
      "IO",
      { operation: "output" },
    );
  }
  /** Replace the current display; scoped callers stop their own handle on exit. */
  public spinner(_text: string): ActivityHandle {
    this._active?.stop();
    const handle = this._enableProgress
      ? new SpinnerHandle(_text)
      : new ReportingActivityHandle(this._sink, this._diagnosticsToStderr);
    this._active = handle;
    return handle;
  }
  public activity(text: string, delayMilliseconds = 350) {
    return this.delayedActivity(text, delayMilliseconds);
  }
  /**
   * Announce a stage in logs and render it immediately on interactive terminals.
   * The display is released on failure or interruption as well as success.
   */
  public stage(label: string, text: string) {
    return Effect.gen(this, function* () {
      yield* this.report({ label, level: "info", text });
      return yield* this.immediateActivity(`${label}: ${text}`);
    });
  }
  public immediateActivity(text: string) {
    return Effect.acquireRelease(
      Effect.sync(() => this.spinner(text)),
      (handle) => Effect.sync(() => handle.stop()),
    );
  }
  public delayedActivity(text: string, delayMilliseconds = 350) {
    return Effect.acquireRelease(
      Effect.sync(() => {
        this._active?.stop();
        const handle = new DelayedSpinnerHandle(
          text,
          (updatedText) => this.spinner(updatedText),
          delayMilliseconds,
        );
        this._active = handle;
        return handle;
      }),
      (handle) => Effect.sync(() => handle.stop()),
    );
  }
  public progress(options: ProgressOptions) {
    this._active?.stop();
    const handle =
      this._enableProgress && options.total > 0
        ? new CliProgressHandle(options)
        : new NoopProgressHandle();
    this._active = handle;
    return handle;
  }
}
export class Messages extends Context.Tag("Messages")<Messages, MessageService>() {}
export const MessagesLive = Layer.succeed(Messages, new MessageService());
export const createMessages = (options: MessageOptions = {}) => new MessageService(options);
