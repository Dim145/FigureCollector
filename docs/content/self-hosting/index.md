# Self-hosting

FigureCollector is designed for self-hosting from the kernel up. Three sub-pages:

- [**Container hardening**](hardening.md) — the security contract: `FROM scratch`, distroless nginx, read-only, `cap_drop ALL`.
- [**Backup & restore**](backup.md) — Postgres + Garage bucket.
- [**Self-host the docs**](docs.md) — yes, this very documentation can be deployed as its own hardened container alongside the app.

For the actual *bring-up* commands, see [Getting started → Production](../getting-started/production.md).

## Why self-host?

- **Your data, your hardware.** Collection metadata is personal; figurine photos can be NSFW; pre-order details map to actual purchases. None of that belongs in a third-party SaaS.
- **No SaaS lock-in.** Postgres dump + Garage bucket export = a full backup you can move anywhere.
- **Deterministic builds.** Every release is a pinned image on GHCR; no surprise dependency updates.
- **Visible security.** The Dockerfiles and compose files are auditable. The `FROM scratch` backend has nothing to attack — no shell, no libc, no package manager.
