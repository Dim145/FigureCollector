# Architecture

FigureCollector is a small but layered app. The architecture is dictated by two non-negotiables:

1. **Hardened containers** — `FROM scratch` backend, distroless nginx, read-only filesystems. Dictates how config flows in and how state flows out.
2. **Offline-first PWA** — TanStack Query cache + service worker + IndexedDB. Dictates how the API surfaces are designed (idempotent mutations, deterministic IDs).

Sub-pages:

- [Stack](stack.md) — every dependency and why
- [Data model](data-model.md) — the Postgres schema, table by table
- [Security contract](security.md) — what the system guarantees and what it does not
