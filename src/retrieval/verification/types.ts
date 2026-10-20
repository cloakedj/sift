import type { VERIFICATION_SCHEMA_VERSION } from "./consts.js";

export interface VerificationEntry {
  schemaVersion: typeof VERIFICATION_SCHEMA_VERSION;
  key: string;
  /** Non-secret: the account the publication lives in (also in the publication manifest). */
  accountId: string;
  index: string;
  model: string;
  verifiedAt: string;
}
