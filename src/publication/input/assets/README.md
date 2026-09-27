# Pinned BGE tokenizer assets

Source: `BAAI/bge-base-en-v1.5`, Hugging Face revision `a5beb1e3e68b9ab74eb54cfd186867f64f240e1a`.

- [tokenizer.json](https://huggingface.co/BAAI/bge-base-en-v1.5/raw/a5beb1e3e68b9ab74eb54cfd186867f64f240e1a/tokenizer.json)
- [tokenizer_config.json](https://huggingface.co/BAAI/bge-base-en-v1.5/raw/a5beb1e3e68b9ab74eb54cfd186867f64f240e1a/tokenizer_config.json)

These are unmodified upstream bytes; formatting excludes this directory and tests verify SHA-256 values in `../consts.ts`. TypeScript JSON imports copy the artifacts into the production build. No runtime downloads or model weights are needed.

The upstream model card declares MIT licensing and links to [FlagEmbedding's license](https://github.com/FlagOpen/FlagEmbedding/blob/master/LICENSE), reproduced in `LICENSE`. The build copies the attribution and license alongside the JSON assets. The tokenizer implementation is the separately Apache-2.0-licensed npm dependency `@huggingface/tokenizers@0.2.0`.

The credential-free reference cases in `tests/support/bge-tokenizer-reference.json` were generated with Python `tokenizers==0.22.2` (Rust backend): `Tokenizer.from_file(tokenizer.json)`, `no_truncation()`, `no_padding()`, then `encode(text, add_special_tokens=True).ids`. That Python dependency is only a reference-generation tool, not a runtime or test dependency.

Upstream token counts do not prove parity with Cloudflare's deployed tokenizer. See `docs/research/bge-tokenizer-input-bounds.md` for limitations.
