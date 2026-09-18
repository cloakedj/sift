import type { ErrorDetails } from "../errors/types.js";

export type MessageLevel = "info" | "warning" | "error" | "debug";
export interface Message {
  label: string;
  level: MessageLevel;
  text: string;
  tags?: readonly string[];
  error?: ErrorDetails;
}
export interface MessageSink {
  message(message: Message, diagnostic: boolean): void;
  output(value: string): void;
}
export interface MessageOptions {
  sink?: MessageSink;
  diagnosticsToStderr?: boolean;
}
