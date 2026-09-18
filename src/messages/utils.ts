import { LEVEL_LABELS } from "./consts.js";
import type { Message } from "./types.js";

// Tags remain structured metadata until the renderer gains styling support.
export const formatMessage = (message: Message) =>
  `${message.label}: [${LEVEL_LABELS[message.level]}] ${message.text}${message.error ? ` [${message.error.code}]` : ""}`;
