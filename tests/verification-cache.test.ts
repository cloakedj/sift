import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { FileSystemService } from "../src/filesystem/index.js";
import { CloudflareAuthService } from "../src/publication/auth.js";
import type { PublicationManifest } from "../src/publication/types.js";
import { VerificationCache } from "../src/retrieval/verification/index.js";
import { VERIFICATION_FILE, VERIFICATION_TTL_MS } from "../src/retrieval/verification/consts.js";
import { verificationKey } from "../src/retrieval/verification/utils.js";

const publication = {
  fingerprint: "f",
  namespace: "n",
  verifiedAt: "2026-10-20T00:00:00.000Z",
  sourceIndexRunId: "run",
  vectorBackend: { provider: "cloudflare-vectorize", accountId: "acct", index: "idx" },
  embeddingSpace: { model: "@cf/baai/bge-base-en-v1.5" },
} as unknown as PublicationManifest;

test("verification keys change with the verified publication and Cloudflare configuration only", () => {
  const env = { CLOUDFLARE_VECTORIZE_INDEX: "idx" };
  const base = verificationKey(publication, env);
  assert.equal(verificationKey(publication, { ...env, CLOUDFLARE_API_TOKEN: "x" }), base);
  assert.notEqual(verificationKey(publication, { CLOUDFLARE_VECTORIZE_INDEX: "other" }), base);
  assert.notEqual(verificationKey(publication, { ...env, CLOUDFLARE_ACCOUNT_ID: "a" }), base);
  assert.notEqual(
    verificationKey({ ...publication, verifiedAt: "2026-10-21T00:00:00.000Z" }, env),
    base,
  );
  assert.notEqual(verificationKey({ ...publication, fingerprint: "g" }, env), base);
  assert.notEqual(verificationKey({ ...publication, sourceIndexRunId: "run2" }, env), base);
  assert.notEqual(
    verificationKey(publication, { ...env, CLOUDFLARE_WORKERS_AI_MODEL: "@cf/other" }),
    base,
  );
});

test("verification cache stores no credentials, expires, and treats corruption as a miss", async () => {
  const root = await mkdtemp(join(tmpdir(), "sift-verify-cache-"));
  try {
    let now = Date.parse("2026-10-20T00:00:00.000Z");
    const fs = new FileSystemService();
    const cache = new VerificationCache(root, fs, () => now);
    const target = { accountId: "acct", vectorizeIndex: "idx", model: "m", apiToken: "secret" };
    await Effect.runPromise(cache.put("k", target));
    const raw = await fs.read(join(root, VERIFICATION_FILE)).pipe(Effect.runPromise);
    assert.ok(!raw.includes("secret"), "credentials are never persisted");
    assert.equal((await Effect.runPromise(cache.get("k")))?.accountId, "acct");
    assert.equal(await Effect.runPromise(cache.get("other")), undefined);
    now += VERIFICATION_TTL_MS;
    assert.equal(await Effect.runPromise(cache.get("k")), undefined, "expired");
    await writeFile(join(root, VERIFICATION_FILE), "{not json");
    assert.equal(await Effect.runPromise(cache.get("k")), undefined);
    await Effect.runPromise(cache.clear());
    await Effect.runPromise(cache.clear());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a trusted account skips account discovery, but an explicit account always wins", async () => {
  const keys = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_VECTORIZE_INDEX"];
  const previous = keys.map((key) => process.env[key]);
  try {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    process.env.CLOUDFLARE_API_TOKEN = "token";
    process.env.CLOUDFLARE_VECTORIZE_INDEX = "idx";
    const calls: string[][] = [];
    const auth = new CloudflareAuthService(((args: string[]) => {
      calls.push(args);
      return Effect.succeed({ accounts: [{ id: "discovered" }] });
    }) as never);
    assert.equal((await Effect.runPromise(auth.config({ accountId: "acct" }))).accountId, "acct");
    assert.equal(calls.length, 0);
    assert.equal((await Effect.runPromise(auth.config())).accountId, "discovered");
    assert.equal(calls.length, 1);
    process.env.CLOUDFLARE_ACCOUNT_ID = "explicit";
    assert.equal(
      (await Effect.runPromise(auth.config({ accountId: "acct" }))).accountId,
      "explicit",
    );
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
