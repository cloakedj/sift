import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("experimental and diagnostic CLI options reject invalid combinations before provider work", () => {
  const id = "a".repeat(64);
  const cases: [string[], RegExp][] = [
    [["--diversify"], /--diversify requires --rerank/],
    [["--diversify", "--rerank", "--semantic-only"], /hybrid discovery/],
    [["--diversify", "--rerank", "--show-intent"], /require retrieval/],
    [["--trace-chunk", id], /full --explain --json/],
    [["--trace-chunk", id, "--json"], /full --explain --json/],
    [["--trace-chunk", id, "--explain", "--json", "--agent"], /omit --agent/],
    [["--trace-chunk", id, "--explain", "--json", "--show-intent"], /require retrieval/],
    [["--trace-chunk", "invalid", "--explain", "--json"], /SHA-256 chunk IDs/],
    [["--trace-chunk", id, "--trace-chunk", id, "--explain", "--json"], /distinct SHA-256/],
    [["--lexical-scorer", "tfidf"], /--lexical-scorer must be one of bm25, legacy, none/],
    [["--lexical-scorer", "current", "--json"], /--lexical-scorer must be one of/],
    [["--lexical-scorer", "none", "--semantic-only"], /--lexical-scorer requires hybrid discovery/],
    [["--lexical-scorer", "bm25", "--show-intent"], /require retrieval/],
  ];
  for (const [args, expected] of cases) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli/index.ts", "search", "question", ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TYPESAFE_API_KEY: "",
          CLOUDFLARE_API_TOKEN: "",
          CLOUDFLARE_ACCOUNT_ID: "",
        },
      },
    );
    assert.equal(result.status, 1);
    // Human-mode scope presentation is allowed; JSON stdout must stay empty on error.
    if (args.includes("--json")) assert.equal(result.stdout, "");
    assert.match(result.stderr, /INVALID_ARGUMENT/);
    assert.match(result.stderr, expected);
  }
});
