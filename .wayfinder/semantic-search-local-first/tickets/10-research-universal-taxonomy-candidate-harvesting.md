# Research universal taxonomy candidate harvesting

Labels: wayfinder:research
Parent: Fast Semantic Search Engine on Jev
Status: closed
Assignee: cloakedj
Blocked by: Decide semantic record schema

## Question

What language-light candidate harvesting approaches can feed Jev taxonomy governance without building language-specific code analyzers? Compare generic tokenization, path/heading/frontmatter extraction, identifier splitting, Tree-sitter as optional plugin, NLP term extraction, embedding clustering, and Jev-assisted validation. Decide what should be core vs plugin.

## Resolution

Completed delegated primary-source research and reviewed the report: [Universal taxonomy candidate harvesting](../../../docs/research/universal-taxonomy-candidate-harvesting.md).

A language-light core can propose labels from paths, headings, bounded front matter, tokens/phrases, and heuristic identifier splitting, then submit bounded evidence to Jev governance. Unicode segmentation is not semantic term extraction; front matter is format-specific; identifier splitting is heuristic. Tree-sitter requires language grammars, while NLP and clustering introduce additional dependencies/tuning and do not establish taxonomy quality by themselves. These remain deferred, consistent with the map.

The report compares code-only, text-only, and mixed corpora and cites primary specifications/docs. No project-specific quality benchmark or paid inference experiment was performed. Recommended caps and weights are not approved defaults; Choice option limits do not establish full request budgets or multilabel behavior.

Remaining policy choices are captured in [Decide taxonomy harvesting policy](12-decide-taxonomy-harvesting-policy.md), without reopening the approved automatic, reversible governance model.

Research ran through a background agent; no branch was created because this directory is not a Git repository. Only planning/research artifacts were changed.

## Checkpoint unlocked

The core-harvester policy can now be selected from sourced alternatives without depending on language-specific analyzers or a plugin framework for v1.
