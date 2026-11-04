# memory — unified agent memory (Phase 0)

Standalone, adapter-based memory interface for AI agents. Phase 0 wraps the
existing `optmem` store behind a stable adapter contract so future backends
(agent-shared-memory, SQLite, etc.) can plug in without changing callers.

- **Single active adapter** at a time. No concurrent multi-adapter use in v1.
- **Standalone repo**: `~/dev/personal/memory` (this directory). Git transport for sync.
- **Wraps optmem**: no data migration in Phase 0 — same store, same notes.

## Quick start

```sh
# install (once)
cd ~/dev/personal/memory && bun install && bun run build
# produces ~/.local/bin/memory (compiled single binary via bun build --compile)

# daily use (delegates to active adapter = optmem)
memory wake
memory note "decided X because Y"
memory recall 'regex'
memory status
memory push        # git push store
memory pull        # git pull store
memory --version   # print CLI version
```

## Files

- `SPEC.md` — full specification, config schema, adapter contract, migration, deployment.
- `adapters/README.md` — adapter contract + optmem adapter notes.
- `DEPLOY.md` — deployment steps for han (VPS) and Mac (personal mode).

## Identity

Per-machine stores. Identity recorded in `MEMORY.md` at the store root
(Oscar / han / Mac). See SPEC §Identity.

## Secrets

Never store secrets in notes. Run `scripts/scan-secrets.sh` before every commit.
See SPEC §Secrets hygiene.

## Status

Phase 0 (design + wrap) shipped. Phase 2 migration (callers switched from ~/.optmem/memo to memory CLI) completed 2026-11-04. v1 implementation follows. Open questions in SPEC §Open questions.