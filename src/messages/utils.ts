import { LEVEL_LABELS } from "./consts.js";
import type { Message, MessageTable } from "./types.js";

export function formatTable(table: MessageTable): string {
  // Cell controls must not introduce new lines or terminal escape sequences.
  // oxlint-disable-next-line no-control-regex
  const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ");
  const rows = [table.columns.map((column) => column.heading), ...table.rows].map((row) =>
    table.columns.map((_, index) => clean(row[index] ?? "")),
  );
  const widths = table.columns.map((_, index) =>
    Math.max(...rows.map((row) => row[index]!.length)),
  );
  const render = (row: string[]) =>
    row
      .map((cell, index) =>
        table.columns[index]!.align === "right"
          ? cell.padStart(widths[index]!)
          : cell.padEnd(widths[index]!),
      )
      .join("  ")
      .trimEnd();
  return [
    render(rows[0]!),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.slice(1).map(render),
  ].join("\n");
}

// Tags remain structured metadata until the renderer gains styling support.
export const formatMessage = (message: Message) =>
  `${message.label}: [${LEVEL_LABELS[message.level]}] ${message.text}${message.error ? ` [${message.error.code}]` : ""}`;
