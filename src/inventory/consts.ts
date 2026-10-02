import type { DiscoveryPolicy } from "./types.js";

export const CHUNKER_VERSION = "structure-v4";
export const MAX_STRUCTURE_BYTES = 1024 * 1024;
export const MAX_CHUNK_BYTES = 8192;
export const MAX_CHUNK_LINES = 48;
export const OVERLAP_LINES = 8;
// Source-configurable policy; removals deliberately permit overriding defaults.
export const defaultPolicy: DiscoveryPolicy = {
  hiddenDirectories: true,
  directories: new Set([
    ".git",
    ".sift",
    ".jev", // Legacy state remains excluded even when hidden directories are enabled.
    "node_modules",
    "dist",
    "build",
    ".next",
    ".turbo",
    "coverage",
    "__pycache__",
  ]),
  files: new Set([
    "sift.config.json",
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
