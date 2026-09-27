export const QUESTION_SET_VERSION = "candidate-relevance-v1";
export const MAX_CANDIDATES = 8;
export const MAX_PAYLOAD_BYTES = 32_768;
export const CONCURRENCY = 3;
export const RELEVANCE_CRITERIA = [
  "The chunk does not support answering the query",
  "The chunk is related, but insufficient to answer the query",
  "The chunk directly supports answering the query",
] as const;
