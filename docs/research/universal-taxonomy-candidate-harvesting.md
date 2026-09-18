# Universal taxonomy candidate harvesting

## Scope and source status

This note answers `.wayfinder/semantic-search-local-first/tickets/10-research-universal-taxonomy-candidate-harvesting.md` for the approved cloud-backed semantic-search plan (local source records, remote Jev inference and Cloudflare embeddings/retrieval). It does **not** reopen deferred plugin/framework scope from `.wayfinder/semantic-search-local-first/MAP.md`; any Tree-sitter or language-specific/parser extension below is described as a later extension point, not approved MVP scope.

Sources actually inspected: Unicode UAX #29 and #31, CommonMark 0.31.2, YAML 1.2.2, Jekyll and Hugo front matter docs, Python lexical reference, ECMAScript spec, Tree-sitter docs, scikit-learn text/clustering docs, and TypeSafe/Jev docs. No inaccessible primary source was used.

## Verified facts

- Unicode UAX #29 defines default boundaries for grapheme clusters, words, and sentences, and allows implementations to choose the default rules or a declared profile/tailoring; it explicitly notes that word segmentation for Thai, Lao, Chinese, and Japanese commonly requires more than the default boundary results. Sources: [UAX #29 overview](https://www.unicode.org/reports/tr29/), [UAX29-C1/C2/C3 conformance](https://www.unicode.org/reports/tr29/#Conformance), [word-boundary note](https://www.unicode.org/reports/tr29/#Conformance).
- Unicode UAX #31 defines identifier guidance around `ID_Start`/`ID_Continue`, says individual programming languages have their own identifier standards and conventions, and allows profiles that add/remove characters. Source: [UAX #31](https://www.unicode.org/reports/tr31/).
- CommonMark defines ATX headings (`#` through six `#`) and Setext headings (underlined with `=` or `-`), including precedence and indentation details; CommonMark is therefore a better source for Markdown heading harvesting than an ad-hoc `^#` regex. Source: [CommonMark 0.31.2 ATX headings](https://spec.commonmark.org/0.31.2/#atx-headings), [Setext headings](https://spec.commonmark.org/0.31.2/#setext-headings).
- YAML uses `---` as a directives/document separator, supports mappings/sequences/scalars, tags, anchors, aliases, and application-specific tags; YAML representations do not preserve comments, mapping key order, or tag handles as representation details. Source: [YAML 1.2.2 overview](https://yaml.org/spec/1.2.2/), [YAML `---`](https://yaml.org/spec/1.2.2/#example-directives-document), [YAML processes/model](https://yaml.org/spec/1.2.2/#processes-and-models).
- “Front matter” is not a CommonMark construct in the inspected CommonMark spec; it is an ecosystem convention. Jekyll requires valid YAML between triple-dashed lines at the start of a file, while Hugo supports front matter in YAML, TOML, or JSON with different delimiters. Sources: [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/), [Jekyll front matter](https://jekyllrb.com/docs/front-matter/), [Hugo front matter](https://gohugo.io/content-management/front-matter/).
- Python names are Unicode-based identifiers with `xid_start`/`xid_continue`, and Python adds underscore to `xid_start`; ECMAScript `IdentifierName` is based on Unicode UAX #31 with modifications and permits `$` and `_` anywhere in an `IdentifierName`. Sources: [Python lexical identifiers](https://docs.python.org/3/reference/lexical_analysis.html#identifiers), [ECMAScript names and keywords](https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-names-and-keywords).
- Tree-sitter is a parser generator and incremental parsing library that builds concrete syntax trees for source files, has parsers for many languages, exposes syntax-tree node ranges/types, and supports S-expression query patterns over syntax trees. Sources: [Tree-sitter intro](https://tree-sitter.github.io/tree-sitter/), [basic parsing](https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html), [query syntax](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html).
- scikit-learn’s `TfidfVectorizer` converts raw documents into TF-IDF feature matrices and supports word/character analyzers, stop words, token patterns, document-frequency thresholds, and n-gram ranges; scikit-learn also documents k-means clustering for grouping samples. Sources: [TfidfVectorizer](https://scikit-learn.org/stable/modules/generated/sklearn.feature_extraction.text.TfidfVectorizer.html), [text feature extraction](https://scikit-learn.org/stable/modules/feature_extraction.html#text-feature-extraction), [k-means](https://scikit-learn.org/stable/modules/clustering.html#k-means).
- TypeSafe/Jev `systemone` accepts a `state`, `model`, and typed questions; `Choice` returns selected option, probabilities, and confidence; `Score` returns a probability-weighted score, probabilities, legend, and confidence. Source: [TypeSafe API](https://docs.typesafe.ai/api.md), [Choice](https://docs.typesafe.ai/primitives/choice.md), [Score](https://docs.typesafe.ai/primitives/score.md), [confidence](https://docs.typesafe.ai/confidence.md).
- TypeSafe docs say questions against the same state are evaluated in parallel, a request budget is about 32,000 tokens / 150,000 English characters, a `Choice` accepts up to 255 options, and a `Score` needs at least two and up to ten levels. Sources: [TypeSafe primitives](https://docs.typesafe.ai/primitives.md), [Choice options](https://docs.typesafe.ai/primitives/choice.md), [Score levels](https://docs.typesafe.ai/primitives/score.md).

## Comparison by corpus type

| Approach | Code-only corpus | Text-only corpus | Mixed corpus | Core fit |
|---|---|---|---|---|
| Path/URI segments | Strong: module/package names often reveal domain and dependency terms. | Moderate: directory hierarchy and filenames reveal topics. | Strong common denominator. | Yes |
| CommonMark headings | Weak unless comments/docs are Markdown. | Strong for `.md`/docs. | Strong for docs side of mixed repos. | Yes for Markdown-like files |
| Front matter | Useful for docs sites but format-specific and unsafe to overgeneralize because Jekyll and Hugo differ. | Useful when present. | Useful only with strict caps and parser support. | Minimal, conservative |
| Unicode/token n-grams | Useful for comments, strings, identifiers after splitting. | Strong generic baseline. | Strong common denominator. | Yes |
| Identifier splitting | Strong, but heuristic because language specs define legal identifier characters, not semantic naming styles. | Weak except filenames/inline code. | Strong for code side. | Yes, heuristic |
| Tree-sitter | Strong structure if grammar exists. | Weak except Markdown/markup grammars. | Strong but adds parser/plugin scope. | Not MVP core; deferred extension |
| NLP noun/term extraction | Weak for code tokens; better for comments. | Stronger on prose. | Useful but library/model dependency adds tuning surface. | Later optional experiment |
| Embedding clustering | Can group related chunks but requires embedding pass and cluster labeling. | Useful for topic discovery. | Useful after baseline records exist. | Later experiment, not first pass |
| Jev validation/governance | Strong for validating noisy candidates against typed questions. | Strong. | Strong and already in plan. | Yes, bounded governance |

## Recommendations

### Minimal MVP core

1. Harvest candidate labels before model calls from path segments, file stems, Markdown headings, bounded front matter keys/string/list values, token n-grams, and split identifiers. Keep media type as a resource/classification hint and chunk ranges as provenance, not automatically as semantic label candidates. Apply the approved denylist before harvesting or remote calls.
2. Normalize candidates deterministically: Unicode normalize, lowercase for matching while preserving a display snapshot, split separators (`/`, `.`, `_`, `-`, whitespace), split camel/Pascal/acronym boundaries heuristically, singularize only with very conservative suffix rules or not at all, and keep source spans/provenance.
3. Score locally before Jev: frequency, document frequency, source weight (`path > heading/frontmatter > identifier > body token` for code; `heading/frontmatter > path > body token` for docs), length, stoplist hits, and entropy/ubiquity penalties.
4. Send bounded, explainable candidate pools to Jev for governance/classification using `Choice`/`Score`, keeping each `Choice` below TypeSafe’s 255-option maximum and using `Score` dimensions with explicitly described levels.
5. Persist promoted labels in taxonomy with stable IDs and keep all candidate evidence in append-only receipts or run metadata, not in the search-critical semantic record except selected label scores.

### Practical bounded budgets

Recommended initial caps, to tune after checkpoints:

- Per resource: max 16 path candidates, 20 heading candidates, 30 front matter candidates, 64 identifier candidates, 64 body token/phrase candidates.
- Per chunk: max 40 candidates passed as evidence to classification.
- Proposed per-run governance pool: max 200 candidates per taxonomy dimension (`domains`, `concepts`, `operations`, `dependencies`, `risks`, `evidenceKinds`). This is an unvalidated tuning proposal, not a safe request-size guarantee. Batch separately by the combined state/question/options token budget. A single Choice selects one alternative, not a multilabel taxonomy: use independent candidate judgments where multiple labels can apply. The 255-option ceiling is only relevant to individual Choice questions.
- Candidate text: cap candidate labels to 80 chars and evidence snippets to 240 chars.
- Provenance: keep `{candidate, normalizedKey, sources:[path|heading|frontmatter|identifier|body|cluster|jev], resourceIds/chunkIds, counts, localScore, firstSeenRunId}`.

### Core vs deferred

- **Core now:** generic scanners, CommonMark heading parser behavior, conservative front matter extraction, Unicode-aware tokenization, identifier splitting heuristics, TF/DF ranking logic, bounded Jev governance.
- **Deferred, not approved MVP scope:** Tree-sitter language plugins, framework-aware analyzers, full NLP pipelines, embedding-cluster label discovery, and any plugin framework. These can be evaluated later after the MVP proves that language-light harvesting is sufficient.

## Limitations and evidence gaps

- Unicode word boundaries are not equivalent to semantic terms, and UAX #29 itself allows tailoring and notes harder languages; multilingual quality needs later fixture coverage.
- Identifier splitting has no universal standard: inspected language specs define valid identifier characters, not how to split `HTTPServerID` into concepts.
- Front matter is ecosystem-specific, not CommonMark; YAML features such as aliases/tags can be too expressive for safe taxonomy harvesting, so the MVP should parse only simple bounded data.
- TF-IDF and k-means are generic statistical tools; they do not prove taxonomy quality without benchmark corpora and human/Jev validation.
- No recall/precision evidence exists yet for this project’s code-only, text-only, or mixed fixtures; the next checkpoint should measure missed relevant chunks and noisy label promotions.

## Remaining human decisions

1. Confirm the exact initial caps above, especially global Jev governance pool size.
2. Choose whether front matter is MVP for all Markdown-like files or only for known extensions (`.md`, `.mdx`).
3. Approve the local scoring weights per source kind before implementation.
4. Choose how uncertain candidate judgments are retained/deferred within the already-approved automatic, soft, reversible taxonomy governance. Mandatory human review is not an approved requirement.
5. Define overflow/fairness behavior for candidate caps across large resources and mixed corpora so the first or most frequent files do not exhaust the pool and suppress rare useful terms.

All budgets, source weights, and core extraction recommendations above are proposals, not user-approved implementation choices. The comparison table expresses expected fit, not measured quality on this project's fixtures.
