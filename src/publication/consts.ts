export const PUBLICATION_FILE = "publication.json";
export const DEFAULT_WORKERS_AI_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_BATCH_SIZE = 16;
export const GET_VECTOR_BATCH_SIZE = 20;
export const DELETE_VECTOR_BATCH_SIZE = 20;
// Old search readers get a grace period; eligible cleanup resumes on publish.
export const GENERATION_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MAX_QUERY_TOP_K = 50;
export const MAX_EMBEDDING_BYTES = 500;
// A newly created index took several minutes to expose its first mutations.
export const VISIBILITY_POLL_ROUNDS = 12;
export const VISIBILITY_MAX_DELAY_SECONDS = 30;
// Mutation-processing wait (opt-in): poll index info before per-vector visibility checks.
export const MUTATION_POLL_INTERVAL_MS = 1000;
export const MUTATION_POLL_MAX_SECONDS = 300;
// Measured on a 175-chunk corpus: parallel reads and one large upsert cut publish time
// 2–4×; stays well inside Cloudflare API limits (max 1000 vectors per upsert).
export const PUBLICATION_CONCURRENCY = 8;
export const UPSERT_BATCH_SIZE = 500;
