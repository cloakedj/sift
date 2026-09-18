# Decide Vectorize migration path

Labels: wayfinder:grilling
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee:
Blocked by: Research Cloudflare Vectorize fit, Define development checkpoints

## Question

How should the engine move from local semantic vectors to Cloudflare Vectorize? Decide whether Vectorize is a backend switch, sync target, dual-write mode, import/export destination, or remote-only option. Define privacy boundaries, config, credentials, index naming, and the first remote checkpoint.

## Scope closure

The user approved Workers AI embeddings and Vectorize retrieval from day one. There is no local vector backend to migrate, so backend switching, dual-write migration, and local/remote parity are out of scope. This is a scope closure, not a migration decision on the route.

Still-relevant setup questions (credentials, configuration, privacy/remote metadata, index naming, and the first remote checkpoint) move to [Decide embedding and local vector backend](05-decide-embedding-and-local-vector-backend.md), whose question now covers the Cloudflare path after [Research Cloudflare Vectorize fit](08-research-vectorize-fit.md).

## Former checkpoint (retired)

The same Jev-derived semantic records can be searched locally or through Vectorize behind a backend config switch.
