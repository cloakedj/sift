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
