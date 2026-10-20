import { DEFAULT_WORKERS_AI_MODEL } from "../../publication/consts.js";
import type { PublicationManifest } from "../../publication/types.js";
import { hashIdentity } from "../../publication/utils.js";

/**
 * A verification is reusable only for the same verified publication (fingerprint/namespace,
 * verification time, source index run, backend, model) and the same Cloudflare configuration
 * (index, explicit account, model). Credentials are never part of it.
 */
export const verificationKey = (publication: PublicationManifest, env = process.env) =>
  hashIdentity({
    version: 1,
    publication: {
      fingerprint: publication.fingerprint,
      namespace: publication.namespace,
      verifiedAt: publication.verifiedAt,
      sourceIndexRunId: publication.sourceIndexRunId,
      backend: publication.vectorBackend,
      model: publication.embeddingSpace.model,
    },
    index: env.CLOUDFLARE_VECTORIZE_INDEX ?? null,
    account: env.CLOUDFLARE_ACCOUNT_ID ?? null,
    model: env.CLOUDFLARE_WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL,
  });
