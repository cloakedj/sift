# Context

## Glossary

**Taxonomy candidate**:
A proposed semantic label supported by evidence from source resources, awaiting Jev governance rather than already belonging to the taxonomy registry.
_Avoid_: Treating harvested words as approved labels

**Query intent**:
The Jev-derived structured representation of a user's raw search query, used for embedding, retrieval, scoring, and explanation.
_Avoid_: Query signature, search signature

**Embedding space**:
A shared representation in which chunk and query vectors are compatible for similarity comparison. Equal vector dimensions alone do not establish compatibility.
_Avoid_: Vector database (which stores vectors rather than defining their meaning)

**Search confidence**:
A user-facing judgment of how strongly the semantic search system believes its returned candidates answer the query, based on retrieval strength, ambiguity, query-intent confidence, and optional Jev scoring. It is reported as labels by default, with numeric details reserved for explanation output.
_Avoid_: Treating vector similarity alone as confidence

- **Jev**: TypeSafe’s flagship System One model. It evaluates typed questions against state and returns structured results directly; it is not the product being built in this repository.
- **Search engine**: The product being built here: a fast semantic code/document search tool built on top of Jev/TypeSafe where Jev powers structured semantic judgments and scores.
- **Cloud-backed semantic search**: Search that keeps source resources and semantic records locally while using remote services for inference, embedding generation, and vector retrieval. Local records do not imply an offline query path.
- **Lexical search**: Search based on tokens, exact terms, paths, and text scoring. It may be used for diagnostics or fallback, but it is not the desired product experience.
- **Semantic search**: Search based on meaning-oriented representations of chunks and queries, powered primarily by Jev-structured judgments/scores and optionally by embeddings/vector lookup.
- **Semantic signature**: Structured metadata derived from a chunk, such as purpose, concepts, actions, APIs, risks, or domains. This is a candidate alternative or complement to numeric embeddings.
- **Taxonomy registry**: The evolving set of labels used to classify resources and chunks, seeded by source configuration/plugins and extended by onboarding through Jev-governed promotion, merge, and deprecation decisions.
- **Onboarding receipt**: An append-only historical record of what happened during onboarding, such as candidate harvesting, Jev classification, taxonomy promotion, embedding, or pipeline events. Receipts are audit/debug/training material, not required for search to work.
- **Resource**: Any source item being indexed, such as a source file, markdown document, config file, text document, scraped page, or other text-bearing artifact.
- **Chunk**: A bounded piece of a resource, usually a line/byte range, indexed as a search unit.
- **Embedding provider**: A component that turns text into vectors. It may be local or remote.
- **Vector backend**: A component that stores and queries vectors. It may be local or remote.
- **Checkpoint**: A concrete development state that can be tested to validate progress before moving to the next stage.
