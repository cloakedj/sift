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
- **Context layer**: The product being built here: a resource-general provider of source-backed context for models and tools. It supplies relevant evidence and its limitations, not the consumer's final task answer.
_Avoid_: Codebase context layer, search engine when referring to the whole product
- **Cloud-backed semantic search**: Search that keeps source resources and semantic records locally while using remote services for inference, embedding generation, and vector retrieval. Local records do not imply an offline query path.
- **Lexical search**: Discovery based on literal strings, tokens, names, and source locations. Like semantic search, it finds candidates rather than establishing evidence strength.
- **Context anchor**: A caller-supplied literal or source location that directs discovery. It is a starting point, not an implicit exclusion of other relevant evidence.
- **Hybrid discovery**: Candidate discovery combining lexical and meaning-oriented matches while preserving how each candidate was found.
- **Semantic search**: Search based on meaning-oriented representations of chunks and queries, powered primarily by Jev-structured judgments/scores and optionally by embeddings/vector lookup.
- **Semantic signature**: Structured metadata derived from a chunk, such as purpose, concepts, actions, APIs, risks, or domains. This is a candidate alternative or complement to numeric embeddings.
- **Taxonomy registry**: The evolving set of labels used to classify resources and chunks, seeded by source configuration/plugins and extended by onboarding through Jev-governed promotion, merge, and deprecation decisions.
- **Onboarding receipt**: An append-only historical record of what happened during onboarding, such as candidate harvesting, Jev classification, taxonomy promotion, embedding, or pipeline events. Receipts are audit/debug/training material, not required for search to work.
- **Resource**: Any source item being indexed, such as a source file, markdown document, config file, text document, scraped page, or other text-bearing artifact.
- **Chunk**: A bounded retrieval piece belonging to a resource. A source unit may occupy one chunk or several linked continuation chunks.
- **Source unit**: A meaningful region within a resource, such as a function, class, document section, paragraph, or fenced block. Its identity is distinct from how it is divided into retrieval chunks.
_Avoid_: Source entity, declaration when referring to the general abstraction
- **Source structure**: The source-backed organization of units, including containment, continuation, adjacency, and explicit references.
- **Derived context**: Judgments or classifications based on source evidence, distinct from the source's own content and structure.
- **Retrieval relationship**: A source-backed connection that suggests where to seek supporting evidence. It does not by itself establish relevance or the validity of a derived judgment.
- **Validity dependency**: An input or condition on which a derived artifact's continued applicability depends, distinct from a navigation relationship.
- **Evidence coverage**: The scope and capabilities within which evidence was sought, including limitations; completing retrieval does not imply exhaustive coverage.
- **Response truncation**: Omission of discovered, eligible evidence because of an output budget, distinct from evidence that was never discovered or assessed.
- **Supporting context**: Related source evidence assessed alongside a primary retrieved chunk; structural proximity alone does not make it relevant.
- **Insufficient evidence**: A retrieval outcome in which the assessed evidence does not meet the answer policy, not a claim that the requested behavior is absent from the entire corpus.
- **Embedding provider**: A component that turns text into vectors. It may be local or remote.
- **Vector backend**: A component that stores and queries vectors. It may be local or remote.
- **Checkpoint**: A concrete development state that can be tested to validate progress before moving to the next stage.
