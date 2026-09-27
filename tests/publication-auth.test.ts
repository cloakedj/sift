import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { CloudflareAuthService } from "../src/publication/auth.js";
import { Errors } from "../src/errors/index.js";

const keys = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_VECTORIZE_INDEX",
  "CLOUDFLARE_WORKERS_AI_MODEL",
];

test("Cloudflare configuration supports Wrangler OAuth, explicit token precedence, and ambiguous-account rejection", async () => {
  const previous = keys.map((key) => process.env[key]);
  try {
    keys.forEach((key) => delete process.env[key]);
    process.env.CLOUDFLARE_VECTORIZE_INDEX = "fixture";
    const calls: string[][] = [];
    const auth = new CloudflareAuthService((args) => {
      calls.push(args);
      return Effect.succeed(
        args[0] === "auth"
          ? { token: "private-token", type: "oauth" }
          : { accounts: [{ id: "account" }] },
      );
    });
    const config = await Effect.runPromise(auth.config());
    assert.equal(config.accountId, "account");
    assert.equal(config.apiToken, "private-token");
    assert.deepEqual(calls, [["auth", "token"], ["whoami"]]);
    process.env.CLOUDFLARE_ACCOUNT_ID = "explicit-account";
    process.env.CLOUDFLARE_API_TOKEN = "explicit-token";
    calls.length = 0;
    assert.equal((await Effect.runPromise(auth.config())).apiToken, "explicit-token");
    assert.deepEqual(calls, []);
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    const ambiguous = new CloudflareAuthService((args) =>
      Effect.succeed(
        args[0] === "auth" ? { token: "secret" } : { accounts: [{ id: "a" }, { id: "b" }] },
      ),
    );
    const result = await Effect.runPromise(Effect.either(ambiguous.config()));
    assert.equal(result._tag, "Left");
    assert.ok(!JSON.stringify(result).includes("secret"));
    const invalid = new CloudflareAuthService(() => Effect.succeed({ token: "" }));
    assert.equal((await Effect.runPromise(Effect.either(invalid.config())))._tag, "Left");
    const unavailable = new CloudflareAuthService(() =>
      Errors.fail("CONFIGURATION", "Login required"),
    );
    assert.equal((await Effect.runPromise(Effect.either(unavailable.config())))._tag, "Left");
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
