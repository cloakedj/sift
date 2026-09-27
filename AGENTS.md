# Coding standards

- Use Oxfmt for formatting and Oxlint for linting. Run `npm run format`, `npm run lint`, and `npm run format:check` before submitting changes. Keep semantic fixture contents unchanged unless intentionally updating fixtures; tooling excludes `tests/fixtures` and generated/local state.
- Add multiline JSDoc selectively where a function's name and types do not adequately explain its behavior: complex orchestration, non-obvious algorithms, important side effects, failure behavior, or invariants. Explain what callers or maintainers need to know rather than restating the name. Do not require comments on every function, class, constructor, accessor, or straightforward wrapper. When JSDoc is warranted, put `/**`, description lines prefixed with ` *`, and ` */` on separate lines. Use `@param` and `@returns` only when they clarify behavior; do not duplicate TypeScript types.

- Organize related files in a directory named for their shared scope. Keep entry points thin.
- Within each scope, put shared types in `types.ts`, constant values in `consts.ts`, and reusable functions in `utils.ts`. Avoid unrelated global dumping grounds.
- Route all user-facing messages and structured output through `src/messages`. Do not call console methods elsewhere, including provider adapters and examples.
- Messages have a relevance label (for example `Scenario` or `Onboarding`), a severity (`info`, `warning`, `error`, `debug`), and optional styling tags. Keep JSON stdout free of diagnostic prefixes; route diagnostics to stderr in JSON mode.
- Keep credential-free tests distinct from real-service evidence. Never claim a semantic checkpoint passed using mocks alone.
- Centralize error definitions and the shared error contract in `src/errors`: code, reason, message, metadata, and retryability. Use `Errors.fail` in Effect services and `Errors.raise` only in synchronous parsers/guards; never construct or throw ad hoc native errors. Normalize external failures at boundaries and serialize through the same pipeline. Do not persist raw provider bodies, credentials, or stacks.
- Build on Effect throughout: typed failure channels, Context/Layer dependency injection, structured concurrency, cancellation, and scoped resource acquisition/release. Use promises only at external API boundaries and test/runtime entry points, not for application orchestration.
- Prefer classes for services, stateful components, and meaningful behavior. Pure stateless utilities may remain functions. Use explicit `public`, `private`, and `protected` modifiers. Prefix every private/protected method and variable with `_`; do not use JavaScript `#` members.
- Keep error reporting at presentation boundaries; lower layers return structured failures instead of independently logging/rethrowing them.
