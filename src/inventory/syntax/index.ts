import ts from "typescript-ast";
import { hash } from "../../shared/utils.js";
import { CHUNKER_VERSION, MAX_CHUNK_BYTES, MAX_CHUNK_LINES } from "../consts.js";
import type { InventoryChunk } from "../types.js";
import type { ChunkStructure, SourceUnit } from "../structure/types.js";
import type { SourceReference } from "./types.js";

export class SyntaxChunker {
  /**
   * Parse only supplied source (no disk access or module execution). Declarations
   * and class members are retrieval boundaries. Invalid syntax falls back to the
   * streaming reader; oversized declarations retain shared symbol identity.
   * References are based on bound symbols, not matching identifier spellings.
   */
  public chunk(text: string, path: string, resourceId: string): InventoryChunk[] | undefined {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const host: ts.CompilerHost = {
      getSourceFile: (name) => (name === path ? source : undefined),
      getDefaultLibFileName: () => "",
      writeFile: () => {},
      getCurrentDirectory: () => "",
      getDirectories: () => [],
      fileExists: (name) => name === path,
      readFile: (name) => (name === path ? text : undefined),
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
    };
    const program = ts.createProgram([path], { noLib: true, noResolve: true, allowJs: true }, host);
    if (program.getSyntacticDiagnostics(source).length) return undefined;
    const checker = program.getTypeChecker();
    const spans: {
      start: number;
      end: number;
      node: ts.Node;
      parent?: ts.Node;
      structure: ChunkStructure;
    }[] = [];
    const nameOf = (node: ts.Node): string | undefined => {
      if (ts.isConstructorDeclaration(node)) return "constructor";
      if (ts.isVariableStatement(node))
        return node.declarationList.declarations
          .map((item) => item.name.getText(source))
          .join(", ");
      if ("name" in node && node.name && ts.isIdentifier(node.name as ts.Node))
        return (node.name as ts.Identifier).text;
      return undefined;
    };
    const add = (
      node: ts.Node,
      start: number,
      end: number,
      container?: string,
      parent?: ts.Node,
    ) => {
      while (start < end && /\s/u.test(text[start]!)) start++;
      const name = nameOf(node);
      spans.push({
        start,
        end,
        node,
        parent,
        structure: {
          mode: "syntax",
          symbol: container && name ? `${container}.${name}` : name,
          container,
          exported:
            ts.canHaveModifiers(node) &&
            !!ts.getModifiers(node)?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword),
          references: [],
          related: [],
        },
      });
    };
    for (const node of source.statements) {
      if (ts.isClassDeclaration(node) && node.members.length) {
        add(node, node.getFullStart(), node.members[0]!.getFullStart());
        for (const member of node.members)
          add(member, member.getFullStart(), member.end, node.name?.text, node);
        add(node, node.members.at(-1)!.end, node.end);
      } else if (
        ts.isImportDeclaration(node) &&
        spans.length &&
        ts.isImportDeclaration(spans.at(-1)!.node)
      ) {
        spans.at(-1)!.end = node.end;
      } else add(node, node.getFullStart(), node.end);
    }
    if (!spans.some((span) => span.structure.symbol)) return undefined;
    const bytesAt = new Uint32Array(text.length + 1);
    let offset = 0;
    for (let index = 0; index < text.length;) {
      const point = String.fromCodePoint(text.codePointAt(index)!);
      bytesAt[index] = offset;
      offset += Buffer.byteLength(point);
      index += point.length;
      bytesAt[index] = offset;
    }
    const byteAt = (position: number) => bytesAt[position]!;
    const resourceHash = hash(text);
    const entities = new Map<ts.Node, SourceUnit>();
    const entityFor = (node: ts.Node, parent?: ts.Node): SourceUnit => {
      const existing = entities.get(node);
      if (existing) return existing;
      const span = spans.find((item) => item.node === node)!;
      const start = span.start;
      const end = Math.max(
        node.end,
        ...spans.filter((item) => item.node === node).map((item) => item.end),
      );
      const parentEntity = parent ? entityFor(parent) : undefined;
      const contentHash = hash(text.slice(start, end));
      const entity = {
        id: hash(`${resourceId}:${CHUNKER_VERSION}:entity:${start}:${end}:${contentHash}`),
        parentId: parentEntity?.id ?? resourceId,
        resourceId,
        resourceHash,
        label: span.structure.symbol,
        kind: ts.SyntaxKind[node.kind]!,
        startByte: byteAt(start),
        endByte: byteAt(end),
        startLine: source.getLineAndCharacterOfPosition(start).line + 1,
        endLine: source.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line + 1,
        contentHash,
      };
      entities.set(node, entity);
      return entity;
    };
    for (const span of spans) {
      span.structure.unit = entityFor(span.node, span.parent);
      span.structure.label = span.structure.symbol;
      span.structure.ancestors = span.parent ? [entityFor(span.parent)] : [];
      const references = new Map<string, SourceReference>();
      const visit = (node: ts.Node) => {
        if (node.end <= span.start || node.getStart(source) >= span.end) return;
        if (ts.isIdentifier(node)) {
          const declaration = checker.getSymbolAtLocation(node)?.declarations?.[0];
          if (declaration) {
            let reference: SourceReference | undefined;
            if (ts.isImportSpecifier(declaration)) {
              const imported = declaration.parent.parent.parent;
              if (ts.isImportDeclaration(imported) && ts.isStringLiteral(imported.moduleSpecifier))
                reference = {
                  module: imported.moduleSpecifier.text,
                  symbol: (declaration.propertyName ?? declaration.name).text,
                };
            } else {
              const target = spans.find(
                (item) =>
                  declaration.getStart(source) >= item.start &&
                  declaration.getStart(source) < item.end,
              );
              if (target && target !== span) reference = { startByte: byteAt(target.start) };
            }
            if (reference) references.set(JSON.stringify(reference), reference);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(span.node);
      span.structure.references = [...references.values()];
    }
    const chunks: InventoryChunk[] = [];
    for (const span of spans) {
      let start = span.start;
      while (start < span.end) {
        let end = start;
        let bytes = 0;
        let lines = 0;
        while (end < span.end) {
          const point = String.fromCodePoint(text.codePointAt(end)!);
          const size = Buffer.byteLength(point);
          if (bytes + size > MAX_CHUNK_BYTES) break;
          bytes += size;
          end += point.length;
          if (point === "\n" && ++lines >= MAX_CHUNK_LINES) break;
        }
        const content = text.slice(start, end);
        const startByte = byteAt(start);
        const endByte = byteAt(end);
        const chunkHash = hash(content);
        chunks.push({
          id: hash(`${resourceId}:${CHUNKER_VERSION}:${startByte}:${endByte}:${chunkHash}`),
          resourceId,
          path,
          startByte,
          endByte,
          startLine: source.getLineAndCharacterOfPosition(start).line + 1,
          endLine: source.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line + 1,
          chunkHash,
          text: content,
          structure: { ...span.structure, related: [] },
        });
        start = end;
      }
    }
    const groups = new Map<string, InventoryChunk[]>();
    for (const chunk of chunks) {
      const id = chunk.structure!.unit!.id;
      const group = groups.get(id) ?? [];
      group.push(chunk);
      groups.set(id, group);
    }
    for (const group of groups.values())
      group.forEach((chunk, index) => {
        chunk.structure!.part = { index, count: group.length };
      });
    return chunks;
  }
}
