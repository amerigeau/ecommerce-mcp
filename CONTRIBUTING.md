# Contributing

Bugs and pull requests are welcome. Keep the diff small.

- Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before you open a PR.
- A new platform is a new file under `src/adapters/` that implements `StoreAdapter`. Don't special-case it in the tools.
- Don't send shop URLs, API keys, customer data, or order exports in an issue. A failing test with fake data is enough.
- Writes stay behind preview, then apply. A tool that mutates the shop in one call will not be merged.
