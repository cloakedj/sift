export const QUESTION_SET_VERSION = "chunk-classification-v1";
export const PROJECTION_VERSION = "semantic-projection-v4";
export const CLASSIFICATION_CONCURRENCY = 3;
export const CLASSIFICATION_PAYLOAD_BYTES = 150_000; // App guardrail, not a provider token guarantee.
export const EMBEDDING_DOCUMENT_BYTES = 500; // Kept aligned with the conservative publication preflight.
export const PROJECTION_SYMBOL_BYTES = 80;
export const PROJECTION_MIN_LABEL_SCORE = 0.75;
export const PROJECTION_LABELS_PER_DIMENSION = 3;
export const RESOURCE_KINDS = {
  code: "Source code",
  document: "Prose/documentation",
  configuration: "Configuration or structured data",
  other: "Other text-bearing resource",
} as const;
export const SCORE_CRITERIA = [
  "Not relevant to this chunk",
  "Related but secondary",
  "Central to this chunk",
] as const;
export const MEDIA_TYPES: Record<string, { mediaType: string; language?: string }> = {
  ".ts": { mediaType: "text/typescript", language: "typescript" },
  ".tsx": { mediaType: "text/typescript", language: "typescript" },
  ".js": { mediaType: "text/javascript", language: "javascript" },
  ".py": { mediaType: "text/x-python", language: "python" },
  ".md": { mediaType: "text/markdown" },
  ".mdx": { mediaType: "text/markdown" },
  ".json": { mediaType: "application/json" },
  ".yaml": { mediaType: "application/yaml" },
  ".yml": { mediaType: "application/yaml" },
};
