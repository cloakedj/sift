import type { ErrorDetails } from "../errors/types.js";

export type MessageLevel = "info" | "warning" | "error" | "debug";
export interface Message {
  label: string;
  level: MessageLevel;
  text: string;
  tags?: readonly string[];
  error?: ErrorDetails;
}
export interface MessageTable {
  columns: readonly { heading: string; align?: "left" | "right" }[];
  rows: readonly (readonly string[])[];
}
export interface MessageSink {
  message(message: Message, diagnostic: boolean): void;
  output(value: string): void;
}
export interface ActivityHandle {
  update(text: string): void;
  stop(): void;
}
export interface ProgressHandle {
  update(current: number, payload?: Record<string, unknown>): void;
  increment(delta?: number, payload?: Record<string, unknown>): void;
  stop(): void;
}
export interface ProgressOptions {
  label: string;
  total: number;
  initial?: number;
  payload?: Record<string, unknown>;
}
export interface MessageOptions {
  sink?: MessageSink;
  diagnosticsToStderr?: boolean;
  enableProgress?: boolean;
}
