import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

async function sources(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sources(path)));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

// Lightweight architectural guardrails, not a replacement for a full linter.
test("source guards central errors/console and underscore-prefixed private members", async () => {
  const violations: string[] = [];
  for (const path of await sources("src")) {
    const source = (await readFile(path, "utf8")).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    if (/\bthrow\s/.test(source) && !path.startsWith("src/errors/"))
      violations.push(`${path}: throw outside central error factory`);
    if (/\bnew\s+Error\s*\(/.test(source)) violations.push(`${path}: native Error constructor`);
    if (/#[_a-zA-Z]\w*\s*(?:[=(:;])/.test(source)) violations.push(`${path}: # private member`);
    if (/\bconsole\s*[.[]/.test(source) && !path.startsWith("src/messages/"))
      violations.push(`${path}: console outside message service`);
    for (const match of source.matchAll(
      /\b(?:private|protected)\s+(?:(?:readonly|static)\s+)*([\w$]+)/g,
    )) {
      if (!match[1]!.startsWith("_"))
        violations.push(`${path}: private/protected member lacks _ prefix`);
    }
    if (/\basync\s+(?:function|[\w$]+\s*\()/.test(source) && !path.startsWith("src/runtime/"))
      violations.push(`${path}: async orchestration outside runtime boundary`);
  }
  assert.deepEqual(violations, []);
});
