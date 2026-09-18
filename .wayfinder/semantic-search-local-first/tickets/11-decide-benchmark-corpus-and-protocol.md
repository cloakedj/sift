# Decide benchmark corpus and measurement protocol

Labels: wayfinder:grilling
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee: cloakedj
Blocked by: Define development checkpoints

## Question

Which concrete scoped fixture contents, human-authored expected resources, tuning/held-out query split, and 1,000/10,000-chunk scale corpora should implement the approved development gates? Specify the repeatable measurement protocol (sample counts, warmup, cache state, stage timing, service/model/configuration recording, and error accounting) so p50/p95 and relevance results can be compared meaningfully. Do not select hard latency budgets without measurements or assume identical Jev outputs across runs.

The nine gates and product-command contract are defined in [Define development checkpoints](07-define-dev-checkpoints.md). This decision specifies their benchmark inputs and protocol, not the deferred comprehensive integrated Jev grading suite.

## Discussion

### Approved direction — first round

- Small code-only, text-only, and mixed fixtures represent a fictional service covering authentication, retries, caching, and deletion. Include misleading keyword matches and correct answers expressed without query terms. Share concepts across scopes but use distinct resources.
- Use 24 queries per scope: 12 tuning and 12 held-out, covering paraphrases, negative preferences, filters, ambiguous matches, and unanswerable questions. The human approves expected resources before results are inspected; related paraphrases remain in the same split.
- Scale corpora use pinned, permissively licensed real code/documents with selection manifests, without duplicate padding. Curated fixtures prove correctness; scale corpora primarily measure performance.
- Measure 100 searches per mode after five warmups: uncached intent, cached intent, and Jev-reranked searches. Record errors separately, report per-stage/end-to-end p50/p95, and measure three fresh onboarding runs per scale. Freeze and record configuration; select latency budgets afterward.

### Approved details — second round

- Shared scenarios: expired-session rejection versus permission denial; bounded transient-failure retries versus permanent rejection; cache reuse until expiry versus invalidation after update; soft deletion versus permanent erasure. Represent them as executable code, prose procedures, and complementary code/document pairs.
- Each 12-query split contains four paraphrases, two negative-preference queries, two explicit-filter queries, two ambiguous queries, and two unanswerable queries. Tuning and held-out cases differ, rather than merely rewording the same questions.
- Run serial CLI invocations against an already-visible index. End-to-end timing includes process startup. Uncached tests clear only relevant query-intent cache entries; cached tests prepopulate them. Disable result caching. Measure reranked searches with cached intent and verify actual scoring. Provider-side caching is uncontrolled and documented.
- Count 100 measured attempts without replacing failures. Report success-only latency percentiles alongside failure rates, failure durations, retries, and timeouts.
- Three fresh onboarding runs per scale reuse no local inference/embedding artifacts and use isolated remote namespaces. Measure through verified retrieval visibility rather than accepted writes.

### Approved details — final round

- Django code/docs plus TypeScript compiler code are approved for the later scale tests, not the small correctness fixtures. The user's source approval was conditional on this being later scale testing.
- Preserve complete resources, select deterministically until each nominal 1,000/10,000-chunk target is reached, and report actual counts. The smaller corpus is a subset of the larger. Freeze chunking configuration and manifests; verify sufficient eligible content before accepting the corpus.
- Use 10 fixed queries × 10 repetitions per mode, with seeded interleaving and five excluded warmups per mode. Keep queries identical across scales. Select reranking cases during tuning, then freeze them. Report failure to trigger scoring without replacing the attempt.
- Record corpus hashes, model identifiers, configuration, CLI version, machine/network context, stage timings, and retry counts.

## Resolution

Approved through live discussion. The three approval rounds above constitute the benchmark-input and measurement policy for the existing development gates. This resolves the planning decision, not fixture implementation or evidence that any gate has passed.

### Scope and implementation handoff

- Small fictional code/text/mixed fixtures are the relevance oracle; the real upstream corpora are reserved for the later scale checkpoint, at nominal 1,000 and 10,000 chunks (actual counts may exceed targets to preserve whole resources).
- Fixture construction must encode the approved scenarios and split allocation, with human-approved expected resource identities before inspecting search results. Existing top-three, distractor-ordering, and unanswerable-confidence criteria remain defined by Define development checkpoints.
- Scale construction must preserve license notices and exclude generated, vendored, and separately licensed material. Pin source commits and selection manifests rather than following moving branches. No duplicate padding; sufficient eligible chunks must be demonstrated during construction.
- Candidate pins inspected through the upstream GitHub API during this discussion: Django `2abf9d2cf8602f0ddc0db4ec1a33769b41b4232a`; TypeScript `8973583d51329c2ef0ed16f13781b68a7f7d249f`. These are candidate snapshots, not verified corpus manifests or evidence of adequate chunk counts. Root licenses inspected: [Django BSD-3-Clause](https://github.com/django/django/blob/2abf9d2cf8602f0ddc0db4ec1a33769b41b4232a/LICENSE) and [TypeScript Apache-2.0](https://github.com/microsoft/TypeScript/blob/8973583d51329c2ef0ed16f13781b68a7f7d249f/LICENSE.txt); file-level eligibility still requires checking during selection.
- Apply the approved three search modes and 100-attempt protocol separately at each scale. Keep warmups out of measured samples, failures visible, cache conditions explicit, and raw timings available alongside reported percentiles. Three fresh onboarding runs per scale establish an initial indexing baseline; they do not provide a robust tail-latency estimate.
- Freeze and record service/model/configuration and corpus identity for comparison. Do not assume repeated Jev inference produces identical outputs. No hard latency budgets or final calibrated ranking defaults are selected here.
- No implementation or paid benchmark execution was authorized by this decision. The deferred comprehensive integrated Jev grading suite remains out of scope.
