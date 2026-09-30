import { extname } from "node:path";
import { Errors } from "../errors/index.js";
import type { Inventory } from "../inventory/types.js";
import { hash } from "../shared/utils.js";
import { FRONT_MATTER_FIELDS, HARVEST_CONFIG, SOURCE_PRIORITY } from "./consts.js";
import type { Candidate, CandidateSource, Evidence, Harvest, HarvestConfig } from "./types.js";
import {
  compareText,
  identifierForms,
  normalizeLabel,
  resourceTexts,
  selectCandidates,
} from "./utils.js";

// Deliberately conservative YAML subset, with no aliases, tags, nested objects,
// folded scalars or expression evaluation. Unsupported metadata warns; body survives.
class FrontMatterParser {
  private _scalar(value: string): string {
    const text = value.trim();
    if (/^[&*!>|{[]/.test(text)) Errors.raise("FRONT_MATTER", "unsupported YAML value");
    if (text.startsWith('"')) {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "string") Errors.raise("FRONT_MATTER", "expected a string");
      return parsed;
    }
    if (text.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(text)) Errors.raise("FRONT_MATTER", "malformed quoted string");
      return text.slice(1, -1).replace(/''/g, "'");
    }
    if (!text || /^(?:null|true|false|[-+]?\d+(?:\.\d+)?)$/i.test(text) || /:\s|\s#/.test(text))
      Errors.raise("FRONT_MATTER", "expected a plain string");
    return text;
  }
  private _stringList(raw: string): string[] {
    if (!raw.endsWith("]")) Errors.raise("FRONT_MATTER", "malformed string list");
    const body = raw.slice(1, -1);
    if (!body.trim()) return [];
    const values: string[] = [];
    let start = 0;
    let quote = "";
    for (let i = 0; i < body.length; i++) {
      const character = body[i]!;
      if (quote) {
        if (quote === '"' && character === "\\") {
          i++;
          continue;
        }
        if (character === quote) {
          if (quote === "'" && body[i + 1] === "'") {
            i++;
            continue;
          }
          quote = "";
        }
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ",") {
        values.push(this._scalar(body.slice(start, i)));
        start = i + 1;
      }
    }
    if (quote) Errors.raise("FRONT_MATTER", "unterminated quoted string");
    values.push(this._scalar(body.slice(start)));
    return values;
  }
  /**
   * Parse only bounded string and string-list front matter, preserving source offsets.
   * Unsupported YAML fails explicitly so callers can warn and still harvest body text.
   */
  public parse(text: string, maxBytes: number) {
    const lines = text.split(/(?<=\n)/);
    if (lines[0]?.trim() !== "---")
      return { values: [] as { value: string; start: number; end: number }[], end: 0 };
    let offset = lines[0].length;
    let field: string | undefined;
    const values: { value: string; start: number; end: number }[] = [];
    const fields = new Set<string>();
    for (const line of lines.slice(1)) {
      if (Buffer.byteLength(text.slice(0, offset + line.length)) > maxBytes)
        Errors.raise("FRONT_MATTER", "front matter exceeds byte cap");
      if (line.trim() === "---") return { values, end: offset + line.length };
      if (!line.trim() || /^\s*#/.test(line)) {
        offset += line.length;
        continue;
      }
      const top = /^([\w-]+):\s*(.*?)\s*$/.exec(line);
      const item = /^\s+-\s+(.+?)\s*$/.exec(line);
      if (top) {
        field = top[1]!;
        if (fields.has(field)) Errors.raise("FRONT_MATTER", "duplicate metadata field");
        fields.add(field);
        const raw = top[2]!;
        if (/[&*!]/.test(raw.replace(/"[^"]*"|'[^']*'/g, "")))
          Errors.raise("FRONT_MATTER", "YAML aliases and tags are unsupported");
        if (raw) {
          let parsed: string[];
          if (raw.startsWith("[")) {
            parsed = this._stringList(raw);
          } else parsed = [this._scalar(raw)];
          if (FRONT_MATTER_FIELDS.has(field))
            for (const value of parsed)
              values.push({ value, start: offset, end: offset + line.length });
        }
      } else if (item && field) {
        const value = this._scalar(item[1]!);
        if (FRONT_MATTER_FIELDS.has(field))
          values.push({ value, start: offset, end: offset + line.length });
      } else Errors.raise("FRONT_MATTER", "unsupported or malformed front matter structure");
      offset += line.length;
    }
    return Errors.raise("FRONT_MATTER", "unterminated front matter");
  }
}

/**
 * Collect source-linked candidates without treating them as approved labels.
 * Apply per-source budgets and rare-label reservation while retaining overflow
 * and exclusions for inspection; malformed front matter does not discard the resource.
 */
export function harvestCandidates(
  inventory: Inventory,
  config: HarvestConfig = HARVEST_CONFIG,
): Harvest {
  const map = new Map<string, Candidate>();
  const excluded: Harvest["excluded"] = [];
  const warnings: Harvest["warnings"] = [];
  const texts = resourceTexts(inventory);
  for (const resource of inventory.resources) {
    const text = texts.get(resource.id) ?? "";
    const add = (value: string, source: CandidateSource, start?: number, end?: number) => {
      const name = normalizeLabel(value);
      if (!name || !/\p{L}/u.test(name)) return;
      if ([...name].length > config.maxLabelLength) {
        if (!excluded.some((entry) => entry.name === name && entry.resourceId === resource.id))
          excluded.push({ name, resourceId: resource.id, reason: "label exceeds code-point cap" });
        return;
      }
      const id = hash(name);
      const candidate = map.get(id) ?? { id, name, evidence: [] };
      if (candidate.evidence.some((e) => e.resourceId === resource.id && e.source === source))
        return;
      const evidence: Evidence = {
        resourceId: resource.id,
        resourceHash: resource.resourceHash,
        source,
        original: value,
        snippet: [...(start === undefined ? value : text.slice(start, end))]
          .slice(0, config.maxSnippetLength)
          .join(""),
      };
      if (start !== undefined && end !== undefined) {
        evidence.startByte = Buffer.byteLength(text.slice(0, start));
        evidence.endByte = Buffer.byteLength(text.slice(0, end));
        evidence.startLine = text.slice(0, start).split("\n").length;
        evidence.endLine = text
          .slice(0, Math.max(start, end - (text[end - 1] === "\n" ? 1 : 0)))
          .split("\n").length;
      }
      candidate.evidence.push(evidence);
      map.set(id, candidate);
    };
    for (const segment of resource.path.split(/[/.]+/))
      for (const form of identifierForms(segment)) add(form, "path");
    let bodyStart = 0;
    if ([".md", ".mdx"].includes(extname(resource.path).toLowerCase())) {
      try {
        const metadata = new FrontMatterParser().parse(text, config.maxFrontMatterBytes);
        bodyStart = metadata.end;
        for (const item of metadata.values) add(item.value, "frontMatter", item.start, item.end);
      } catch (cause) {
        const error = Errors.normalize(cause, "FRONT_MATTER");
        warnings.push({
          path: resource.path,
          message: `Front matter ignored: ${error.message}`,
          details: Errors.serialize(error),
        });
      }
    }
    const markdown = [".md", ".mdx", ".markdown"].includes(extname(resource.path).toLowerCase());
    let offset = 0;
    for (const line of text.split(/(?<=\n)/)) {
      if (offset < bodyStart) {
        offset += line.length;
        continue;
      }
      const heading = markdown ? /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line) : null;
      if (heading) add(heading[1]!, "heading", offset, offset + line.length);
      for (const match of line.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)) {
        if (/[A-Z_$]/.test(match[0]) || /\p{Ll}\p{Lu}/u.test(match[0]))
          for (const form of identifierForms(match[0]))
            add(form, "identifier", offset + match.index!, offset + match.index! + match[0].length);
      }
      if (!heading) {
        for (const sentence of line.matchAll(/[^.!?。！？\n]+/gu)) {
          const words = [...sentence[0].matchAll(/[\p{L}\p{N}]+/gu)];
          for (let i = 0; i < words.length; i++)
            for (let count = 1; count <= 3 && i + count <= words.length; count++) {
              const first = words[i]!;
              const last = words[i + count - 1]!;
              const start = offset + sentence.index! + first.index!;
              const end = offset + sentence.index! + last.index! + last[0].length;
              add(
                words
                  .slice(i, i + count)
                  .map((word) => word[0])
                  .join(" "),
                "body",
                start,
                end,
              );
            }
        }
      }
      offset += line.length;
    }
  }
  const candidates = [...map.values()].sort((a, b) => compareText(a.name, b.name));
  const frequencies = new Map(
    candidates.map((candidate) => [
      candidate.id,
      new Set(candidate.evidence.map((e) => e.resourceId)).size,
    ]),
  );
  const byResourceSource = new Map<string, Candidate[]>();
  for (const candidate of candidates)
    for (const evidence of candidate.evidence) {
      const key = `${evidence.resourceId}\0${evidence.source}`;
      const pool = byResourceSource.get(key) ?? [];
      pool.push(candidate);
      byResourceSource.set(key, pool);
    }
  const eligible = new Set<string>();
  for (const resource of inventory.resources)
    for (const source of SOURCE_PRIORITY) {
      const pool = byResourceSource.get(`${resource.id}\0${source}`) ?? [];
      pool.sort(
        (a, b) => frequencies.get(b.id)! - frequencies.get(a.id)! || compareText(a.name, b.name),
      );
      for (const candidate of pool.slice(0, config.perResource[source])) eligible.add(candidate.id);
    }
  const selected = selectCandidates(
    candidates.filter((c) => eligible.has(c.id)),
    config,
  );
  const selectedSet = new Set(selected);
  return {
    candidates,
    selected,
    overflow: candidates.filter((c) => !selectedSet.has(c.id)).map((c) => c.id),
    excluded,
    warnings,
  };
}
