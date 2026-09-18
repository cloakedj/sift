import type { DiscoveryPolicy } from "./types.js";

export const CHUNKER_VERSION = "generic-v1";
export const MAX_CHUNK_BYTES = 8192;
export const MAX_CHUNK_LINES = 48;
export const OVERLAP_LINES = 8;
// Source-configurable policy; removals deliberately permit overriding defaults.
export const defaultPolicy: DiscoveryPolicy = {
  hiddenDirectories: true,
  directories: new Set([
    ".git",
    ".jev",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".turbo",
    "coverage",
    "__pycache__",
  ]),
  files: new Set([
    ".env",
    ".npmrc",
    ".pypirc",
    "credentials",
    "credentials.json",
    "id_rsa",
    "id_ed25519",
    "id_dsa",
    "id_ecdsa",
  ]),
  extensions: new Set([
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".wasm",
  ]),
  patterns: [/^\.env\./i, /^(?:credentials|secrets?)[.-]/i, /^service[-_]?account.*\.json$/i],
};
