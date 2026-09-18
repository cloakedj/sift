# Research Cloudflare Vectorize fit

Labels: wayfinder:research
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee: cloakedj
Blocked by:

## Question

What primary-source constraints determine using Cloudflare Workers AI embeddings and Vectorize retrieval from day one for Jev-derived semantic records/query intents?

Investigate suitable embedding models (dimensions, input limits, query/document roles, truncation, version identity), direct CLI REST access versus a Worker, authentication and minimum permissions, Vectorize metrics/filtering/top-k behavior, index and namespace isolation, batch/rate limits, pricing, mutation visibility, stale-vector prevention, resumability, and replacement embedding-space publication. Identify which API guarantees support the approved completeness requirements and which require application logic.

This research is unblocked by the approved Cloudflare pivot; it must precede final backend configuration, not depend on it. No provisioning or credentials are needed to read the public documentation.

## Checkpoint unlocked

The Workers AI model and Vectorize configuration/request path can be chosen against verified constraints, without implementing a local backend or migration.

## Resolution

Findings: [Cloudflare Workers AI + Vectorize fit](../../../docs/research/cloudflare-workers-ai-vectorize-fit.md)

Cloudflare supports the cloud-first path, but completeness, stale-vector prevention, embedding-space identity, publication state, and retry/resume guarantees remain application responsibilities. Recommended default for the follow-up decision is Workers AI `@cf/baai/bge-base-en-v1.5` with `pooling: "cls"`, a Vectorize index using 768 dimensions and cosine metric, direct CLI REST calls first, small operational metadata in Vectorize, and local Jev semantic records as the source of truth.
