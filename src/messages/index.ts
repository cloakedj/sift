import { Context, Layer } from "effect";
import { Errors, type AppError } from "../errors/index.js";
import type { Message, MessageOptions, MessageSink } from "./types.js";
import { formatMessage } from "./utils.js";

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

export class MessageService {
  private readonly _sink: MessageSink;
  private readonly _diagnosticsToStderr: boolean;

  public constructor(options: MessageOptions = {}) {
    this._sink = options.sink ?? new ConsoleSink();
    this._diagnosticsToStderr = options.diagnosticsToStderr ?? false;
  }
  public report(message: Message) {
    return Errors.attempt(() => this._sink.message(message, this._diagnosticsToStderr), "IO", {
      operation: "message",
    });
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
    return Errors.attempt(() => this._sink.output(JSON.stringify(value)), "IO", {
      operation: "json-output",
    });
  }
  public output(value: string) {
    return Errors.attempt(() => this._sink.output(value), "IO", { operation: "output" });
  }
}
export class Messages extends Context.Tag("Messages")<Messages, MessageService>() {}
export const MessagesLive = Layer.succeed(Messages, new MessageService());
export const createMessages = (options: MessageOptions = {}) => new MessageService(options);
