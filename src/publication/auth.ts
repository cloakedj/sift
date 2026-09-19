import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { Errors } from "../errors/index.js";
import { DEFAULT_WORKERS_AI_MODEL } from "./consts.js";
import type { WranglerCommand } from "./types.js";

const execute = promisify(execFile);

/**
 * Delegate OAuth refresh/storage to Wrangler's supported CLI. Capture both streams
 * so tokens and Wrangler diagnostics never bypass our presentation boundary.
 */
export const runWrangler: WranglerCommand = (args) =>
  Effect.gen(function* () {
    const executable = yield* Errors.attempt(
      () =>
        join(
          dirname(createRequire(import.meta.url).resolve("wrangler/package.json")),
          "bin/wrangler.js",
        ),
      "CONFIGURATION",
    );
    const result = yield* Errors.async(
      (signal) =>
        execute(process.execPath, [executable, ...args, "--json"], {
          signal,
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
        }),
      "CONFIGURATION",
    ).pipe(
      Effect.mapError(() =>
        Errors.create(
          "CONFIGURATION",
          "Wrangler authentication failed; run npx wrangler login or set CLOUDFLARE_API_TOKEN",
        ),
      ),
    );
    return yield* Errors.attempt(() => JSON.parse(result.stdout) as unknown, "CONFIGURATION");
  });

export class CloudflareAuthService {
  public constructor(private readonly _run: WranglerCommand = runWrangler) {}

  public config() {
    return Effect.gen(this, function* () {
      const vectorizeIndex = process.env.CLOUDFLARE_VECTORIZE_INDEX;
      if (!vectorizeIndex)
        return yield* Errors.fail(
          "CONFIGURATION",
          "Set CLOUDFLARE_VECTORIZE_INDEX to an existing 768-dimension cosine index",
        );
      if (
        process.env.CLOUDFLARE_WORKERS_AI_MODEL &&
        process.env.CLOUDFLARE_WORKERS_AI_MODEL !== DEFAULT_WORKERS_AI_MODEL
      )
        return yield* Errors.fail(
          "CONFIGURATION",
          "Publication currently supports only the pinned BGE base model",
        );
      let apiToken = process.env.CLOUDFLARE_API_TOKEN;
      let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      if (!apiToken) {
        const auth = yield* this._run(["auth", "token"]);
        if (
          !auth ||
          typeof auth !== "object" ||
          !("token" in auth) ||
          typeof auth.token !== "string" ||
          !auth.token.trim()
        )
          return yield* Errors.fail(
            "CONFIGURATION",
            "Wrangler returned no usable token; run npx wrangler login",
          );
        apiToken = auth.token;
      }
      if (!accountId) {
        const identity = yield* this._run(["whoami"]);
        const accounts = (identity as { accounts?: { id?: unknown }[] } | null)?.accounts;
        if (
          !Array.isArray(accounts) ||
          accounts.length !== 1 ||
          typeof accounts[0]?.id !== "string"
        )
          return yield* Errors.fail(
            "CONFIGURATION",
            "Set CLOUDFLARE_ACCOUNT_ID explicitly when Wrangler cannot select exactly one account",
          );
        accountId = accounts[0].id;
      }
      return { accountId, apiToken, vectorizeIndex, model: DEFAULT_WORKERS_AI_MODEL };
    });
  }
}
