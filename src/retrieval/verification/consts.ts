export const VERIFICATION_SCHEMA_VERSION = 1;
/** `.sift/` file holding the verified Cloudflare target of the active publication. */
export const VERIFICATION_FILE = "verified-target.json";
/** Re-verify at least this often even when nothing local changed (external index edits). */
export const VERIFICATION_TTL_MS = 60 * 60 * 1000;
