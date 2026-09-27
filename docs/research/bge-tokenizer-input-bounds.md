# BGE tokenizer-backed input bounds

## Finding

The current `@cf/baai/bge-base-en-v1.5` adapter's 500-byte guard should not yet be replaced with an unverified token estimate. A reproducible local tokenizer is feasible, but upstream tokenizer correctness and hosted-provider behavior are separate evidence requirements. No paid inference or hosted tokenization comparison was performed in this investigation.

Research was performed directly using public sources; no background-agent facility was available.

## Primary-source facts

- Cloudflare's [model page](https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/) explicitly lists **Maximum Input Tokens: 512** and **Output Dimensions: 768**. It also displays a separate context-window figure of 153,600; that is not evidence that one input may exceed 512 tokens.
- The [synchronous input schema](https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/sync-input.json) accepts a nonempty string or an array of nonempty strings, with `maxItems: 100`. It exposes `pooling`, but no truncation control or token-count option. Our 16-input batch bound is a local policy, not Cloudflare's documented maximum.
- The public model page/schema examined do not pin a tokenizer artifact revision or establish how overlength inputs are handled. Do not infer either rejection or truncation from this absence.
- The [upstream model API](https://huggingface.co/api/models/BAAI/bge-base-en-v1.5) resolved to revision `a5beb1e3e68b9ab74eb54cfd186867f64f240e1a` during this investigation. Pin this revision rather than `main` for local artifacts.
- Its [tokenizer configuration](https://huggingface.co/BAAI/bge-base-en-v1.5/blob/a5beb1e3e68b9ab74eb54cfd186867f64f240e1a/tokenizer_config.json) declares `BertTokenizer`, lowercasing, Chinese-character handling, and `model_max_length: 512`.
- Its [tokenizer artifact](https://huggingface.co/BAAI/bge-base-en-v1.5/blob/a5beb1e3e68b9ab74eb54cfd186867f64f240e1a/tokenizer.json) uses `BertNormalizer`, `BertPreTokenizer`, and WordPiece with 30,522 vocabulary entries, `##` continuation, `[UNK]`, and `max_input_chars_per_word: 100`. Its single-sequence postprocessor is `[CLS] A [SEP]`; therefore the 512-token budget includes two added tokens, leaving at most 510 encoded text tokens. Literal special-token strings must still be handled by the tokenizer, not a hand-written counting heuristic. Artifact-level truncation and padding are null.
- The [upstream model configuration](https://huggingface.co/BAAI/bge-base-en-v1.5/blob/a5beb1e3e68b9ab74eb54cfd186867f64f240e1a/config.json) declares `max_position_embeddings: 512`, independently consistent with that budget.

## Reproducible artifact checksums

SHA-256 of the raw files downloaded from the pinned revision, before reformatting:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `tokenizer.json` | 711396 | `d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66` |
| `tokenizer_config.json` | 366 | `9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3` |

Raw download base: `https://huggingface.co/BAAI/bge-base-en-v1.5/raw/a5beb1e3e68b9ab74eb54cfd186867f64f240e1a/`.

No model weights are needed to count tokens. The subsequent implementation bundles these exact upstream files under `src/publication/input/assets/`, with MIT attribution and checksum regression tests.

## Implementation candidate

Hugging Face's [Tokenizers.js repository and usage documentation](https://github.com/huggingface/tokenizers.js) describe a standalone JS/TS tokenizer accepting `tokenizer.json` and `tokenizer_config.json`, without model weights. The documented components include BERT normalization/pretokenization, WordPiece, and template postprocessing. The npm registry reported `@huggingface/tokenizers` version `0.2.0` during inspection. The subsequent implementation pins `0.2.0` and inspects its packaged encode API, which exposes explicit special-token handling and no truncation/padding options. Its BERT/WordPiece path was checked against the Rust reference cases below; this is not a general claim about every supported tokenizer.

## Recommended implementation sequence

1. Add a directory-scoped embedding-input service using Effect dependency injection. Bundle verified, license-attributed tokenizer artifacts locally, with a pinned library version. Token counting must not download files or acquire credentials at runtime. Ensure artifacts are available in both source and compiled execution.
2. Count the full encoded sequence with special tokens enabled and truncation/padding disabled. Preserve the exact string sent to Cloudflare: no new query prefix, normalization outside the tokenizer, or source-text projection changes.
3. Compare exact token IDs with a pinned upstream reference implementation. Include ASCII, accents/combining marks, CJK, emoji, punctuation, code identifiers, long unknown words, literal special tokens, and empty/whitespace/control inputs. Test full lengths of 511, 512, and 513 and retain full counts above the limit; a tokenizer that silently clips to 512 cannot serve as this guard.
4. Initially keep the byte guard as well. Test typed failures before remote calls, offline initialization, artifact integrity, cancellation boundaries, and compiled asset loading. Reuse one validator in publication, query preparation, and the adapter boundary; keep publication preflight ahead of mutations.
5. Record the local tokenizer revision/checksum and validation-policy version in diagnostics/provenance. Decide explicitly whether changing only admission policy requires publication migration; do not silently change existing embedding inputs or cache identity.
6. Before lifting the byte guard, perform a separately authorized, bounded hosted check with representative inputs above 500 bytes but below 512 local tokens, and inspect the provider's current documented behavior. A successful vector response alone does not prove absence of silent truncation. If hosted tokenizer parity remains unverified, disclose that limitation rather than claiming exact provider equivalence.

## Subsequent credential-free implementation

`EmbeddingInputService` lazily constructs the pinned tokenizer from local JSON imports, with constructor injection and an Effect Context/Layer available. The Cloudflare adapter now validates each input using this service before issuing a request. Unsupported models and inputs reduced to no text tokens fail explicitly. The 500-byte guard remains independently enforced, so longer locally valid inputs are still not admitted to hosted inference. Query/document text, pooling, and embedding identity are unchanged.

Exact token IDs match 14 cases generated with Python `tokenizers==0.22.2` (Rust backend), covering ASCII, accents/combining marks, CJK, emoji, punctuation/code, unknown long words, literal special tokens, whitespace and controls. Tests separately check complete lengths 511, 512, 513, and 1024 including `[CLS]`/`[SEP]`, typed rejection above 512, artifact hashes, unsupported models, and offline operation. Source and compiled execution were both exercised. All 50 credential-free tests, typecheck, build, lint, and formatting checks passed.

These are local tokenizer/reference checks, not hosted-tokenizer parity, hosted truncation guarantees, semantic relevance, or larger-project performance evidence. No new live inference was performed.
