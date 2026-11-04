# SPEC — memory v1 (Phase 0)

Phase 2 migration (callers switched from ~/.optmem/memo to memory CLI) completed 2026-11-04.

Date: 2026-11-03. Status: design, decisions made, implementation pending.

## 1. Purpose

Give AI agents (and humans) one stable memory interface that:

1. Wraps the existing `optmem` store without changing its data or UX.
2. Allows swapping the backend later (agent-shared-memory, SQLite, …) via an
   adapter without touching callers.
3. Travels across machines (han VPS, Mac personal) over git.
4. Keeps secrets out of notes and serializes writes.

Non-goals (v1): multi-adapter concurrent use, auto-swap/rotation, web UI,
auto-signup of keys, semantic search.

## 2. Scope

In scope:
- Adapter contract + single active adapter selection.
- Config file, CLI, identity/attribution, sync (git), single-writer lock,
  secrets scan, migration from optmem, deployment checklist.

Out of scope (pushed to v1+):
- Semantic/vector recall, multi-adapter federation, conflict auto-merge,
  encrypted stores, UI.

## 3. Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────┐
│  agent/CLI   │────▶│  memory gateway     │────▶│  adapter     │
│  (caller)    │     │  (lock, config,     │     │  (optmem)    │
└──────────────┘     │   identity, sync)   │     └──────┬───────┘
                     └─────────────────────┘            │
                                                        ▼
                                                  ~/.optmem/memory
                                                  (git worktree)
```

- Gateway owns: config load, active-adapter resolution, write lock, identity
  injection, sync hooks.
- Adapter owns: storage semantics (wake/note/recall/…).
- Transport: git (push/pull) over SSH, same as optmem today.

## 4. Data model

### Memory entry (canonical, adapter-normalized)

```go
type Memory struct {
    ID        string    // adapter-assigned, stable within adapter
    Text      string    // <= 280 bytes (optmem constraint; adapters may relax)
    CreatedAt time.Time // UTC
    Machine   string    // "han" | "mac" | "oscar-..." (attribution)
    Tags      []string  // optional, v1.1
}
```

### Store layout (optmem adapter)

```
~/.optmem/memory/          # git worktree (unchanged)
├── MEMORY.md              # identity + index (hand-maintained)
├── TREE/                  # rebuildable node summaries (memo nap)
└── (optmem internal files)
```

`MEMORY.md` is the human-readable identity/attribution anchor. Adapters MUST
not delete it. See §8.

## 5. Adapter contract

TypeScript interface (Bun runtime, no native deps). Adapters implement all
methods. Errors are thrown (not returned); the gateway catches and maps to
exit codes (SPEC §14).

```ts
export interface Adapter {
  // lifecycle
  init(cfg: AdapterConfig, signal?: AbortSignal): Promise<void>;
  metadata(): AdapterMeta;

  // memory ops
  wake(part?: number, total?: number): Promise<WakeResult>;
  note(text: string): Promise<void>;            // <= 280 bytes enforced by adapter
  recall(pattern: string): Promise<Memory[]>;
  zoom(block: string): Promise<ZoomResult>;
  nap(block: string, text: string): Promise<void>; // compress node (text = compressed line)
  forget(id: string): Promise<void>;           // tombstone or no-op (see §6)
  config(key: string, value: string): Promise<void>; // adapter-local setting
  import(src: string): Promise<ImportReport>;

  // sync hooks (gateway may call; adapter may no-op)
  push(): Promise<void>;
  pull(): Promise<void>;
  syncStatus(): Promise<SyncStatus>;
}

export interface AdapterMeta {
  name: string;            // "optmem"
  version: string;         // semver of adapter
  capabilities: string[];  // subset of {wake,note,recall,zoom,nap,forget,config,import,push,pull}
  dataLocation: string;    // absolute path
}

export type AdapterConfig = Record<string, unknown>;
```

Method semantics:
- `Init`: idempotent; validates config + data dir + binary.
- `Wake`: returns paged parts; caller pages via `part`/`total` (optmem style).
- `Note`: validates <= 280 bytes UTF-8; rejects secrets (adapter-side guard
  calls scan); attributes machine from config.
- `Recall`: regex, case-insensitive, over all memory lines.
- `Zoom`: expand a node block id (e.g. "16-31").
- `Nap`: compress a node; rebuilds TREE.
- `Forget`: optmem has no native delete. Adapter implements tombstone by
  appending a `~forget:<id>` marker line (v1) OR no-op with documented
  limitation. **Decision: tombstone markers in v1** (reversible, audit-friendly).
  Hard delete deferred to v2.
- `Config`: set adapter-local key (e.g. `optmem.memo_bin`).
- `Import`: ingest from a file/path or another adapter's export; dedups by
  exact text match.

System-level commands (gateway, not adapter):
- `list-adapters` → []AdapterMeta from registry.
- `use-adapter <name>` → writes `active_adapter` to config (requires restart
  of long-lived gateway; CLI reads per invocation so immediate).
- `status` → active adapter meta + sync status + lock state + identity.

## 6. Adapter registry

Hardcoded registry in v1 (no dynamic loading). New adapter = code change +
rebuild. Dynamic import via `import()` deferred to v2 (Bun supports it; we
keep it simple and explicit for v1).

```ts
const registry: Record<string, () => Adapter> = {
  optmem: () => new OptmemAdapter(),
};
```

## 7. Config format

Location: `$MEMORY_CONFIG` or `$XDG_CONFIG_HOME/memory/config.yaml`
(default `~/.config/memory/config.yaml`). Single human-editable file.

```yaml
# ~/.config/memory/config.yaml
active_adapter: optmem

identity:
  user: faris
  machine: han          # han | mac | oscar-... ; per-machine
  # machine is also recorded in MEMORY.md (source of truth on conflict)

adapters:
  optmem:
    data_dir: ~/.optmem/memory
    memo_bin: ~/.optmem/memo
    git_remote: git@github.com:farishan/optmem.git
    max_bytes: 280

sync:
  transport: git
  auto_push: false       # manual push by default (safer)
  auto_pull: false
  lock_file: ~/.local/state/memory/write.lock

secrets:
  scanner: ~/.local/share/memory/scan-secrets.sh
  block_on_match: true
```

Rules:
- `active_adapter` must be a registered adapter name.
- Paths support `~` expansion.
- Config is the single source for adapter selection; env vars override only
  `MEMORY_CONFIG` path and `MEMORY_MACHINE` (emergency override, logged).
- Changing `active_adapter` does not migrate data; run `memory import` to move.

## 8. Identity & attribution

- Machines: `han` (VPS), `mac` (personal Mac), `oscar-*` (others).
- Each machine keeps its own store clone (same git remote).
- `MEMORY.md` at store root records identity + index; format:

```markdown
# Memory — <machine>
Owner: faris
Machine: han
Created: 2026-...
## Index
- (auto) ...
```

- On conflict between config `machine` and `MEMORY.md`, `MEMORY.md` wins and
  config is logged as drifted (not silently overwritten).
- Notes themselves are not prefixed with machine; attribution lives in
  `MEMORY.md` + git commit author. (Alternative: prefix every note — rejected
  for optmem compat, since optmem lines are the contract.)

## 9. Single-writer

- All write ops (`note`, `nap`, `forget`, `import`, `push`, `pull`) acquire an
  exclusive lock on `sync.lock_file` (default `~/.local/state/memory/write.lock`).
  Implementation: `proper-lockfile` (cross-platform; works on macOS + Linux).
  On Linux, `flock(1)` is an acceptable fallback for shell scripts.
- Lock timeout 10s; on timeout, gateway prints holder PID and exits non-zero
  (instructs agent to retry, never silently waits forever).
- Read ops (`wake`, `recall`, `zoom`, `status`) take shared lock.
- Cross-machine: git push/pull are the serialization boundary; conflicts
  surfaced, never auto-resolved.

## 10. Sync (git transport)

- `Push`: `git -C <data_dir> add -A && commit (if changes) && push`.
- `Pull`: `git -C <data_dir> pull --ff-only`; on non-ff, abort and report.
- Commit author: `faris <faris@<machine>>` (from identity).
- Commit message: `memory: <op> on <machine> (<timestamp>)`.
- Auto-push/pull off by default (manual). Agents should `memory push` at end
  of a session and `memory pull` at start.

## 11. Secrets hygiene

- `scripts/scan-secrets.sh` runs over staged diff + working tree before commit.
- Patterns: AWS/GCP/Azure keys, tokens (ghp_, sk-, xoxb-, etc.), private key
  headers, high-entropy strings > 20 chars, common password assignments.
- `block_on_match: true` → commit aborted, file+line reported.
- Rule: never store secrets in notes. If a secret is needed, store a reference
  (path/env var name), never the value.
- Pre-commit hook installed by `memory init` (optional, prompted).

## 12. Migration from optmem

Phase 0 is a wrap, not a move.

Steps:
1. Install `memory` CLI; default config points at existing `~/.optmem`.
2. `memory status` verifies adapter init + data dir + git remote.
3. `~/.optmem/memo` keeps working unchanged (backward compat — optmem binary
   is not modified).
4. Agents may use either; `memory` delegates to optmem for all ops in v1.
5. No data migration. Same files, same remote.
6. Optmem's `TREE/` and `MEMORY.md` remain authoritative.

Backward-compat decision: **keep optmem fully functional and independent.**
`memory` is an additive layer. If `memory` breaks, fall back to `~/.optmem/memo`
directly. Removal of optmem direct use is a v2 decision, not v1.

Import path for future adapters: `memory import --from optmem --to <adapter>`
exports optmem lines and ingests into target adapter; dedups by exact text.

## 13. Deployment checklist

### han (VPS)
- [ ] Clone/install `~/dev/personal/memory`, `bun install && bun run build` → `~/.local/bin/memory`.
- [ ] `mkdir -p ~/.config/memory ~/.local/state/memory`.
- [ ] Write config with `machine: han`, data_dir `~/.optmem/memory`.
- [ ] Verify `~/.optmem/memory` clone + remote `git@github.com:farishan/optmem.git`.
- [ ] SSH key for git remote present + tested (`ssh -T git@github.com`).
- [ ] `MEMORY.md` identity line = han.
- [ ] `memory status` green.
- [ ] cron/systemd (optional): nightly `memory pull`.

### Mac (personal mode)
- [ ] Same install; `machine: mac`.
- [ ] Git remote access via gh CLI (personal account).
- [ ] `MEMORY.md` identity line = mac.
- [ ] `memory status` green.
- [ ] Run `memory pull` before work, `memory push` after.

### Both
- [ ] `scan-secrets.sh` executable.
- [ ] Write lock dir writable.
- [ ] No secrets in `~/.optmem/memory` history (audit once).

## 14. CLI usage

```
memory wake [--part N] [--total T]
memory note "<text>"
memory recall "<regex>"
memory zoom <block>
memory nap <block> <text...>
memory forget <id>
memory config <key> <value>
memory import <path> [--from optmem]
memory list-adapters
memory use-adapter <name>
memory status
memory push
memory pull
memory init            # first-time: dirs, hook, identity
```

Exit codes: 0 ok, 1 user error, 2 lock timeout, 3 adapter error, 4 sync conflict.

## 15. File layout of this repo

```
~/dev/personal/memory/
├── README.md
├── SPEC.md
├── adapters/
│   └── README.md      # adapter contract + optmem adapter
├── src/
│   ├── cli/           # CLI entrypoint (Bun)
│   ├── gateway/       # config, lock, identity, sync
│   ├── adapter/       # interface + registry
│   └── adapters/
│       └── optmem/    # optmem adapter
├── scripts/
│   └── scan-secrets.sh
├── package.json
└── tsconfig.json
```

## 16. Open questions (decide before impl)

1. Tombstone format for `forget` — marker line `~forget:<id>` vs sidecar file.
   (Current decision: marker line; revisit if TREE rebuild breaks.)
2. Whether `note` auto-pushes. (Current: no, manual.)
3. Config location — `~/.config/memory` vs repo-local. (Current: XDG.)
4. Whether to add `memory forget` to optmem upstream later. (Current: adapter-only.)
5. Vector recall in v2 — embedding model choice deferred.

## 17. Risks

- optmem binary path drift → adapter `Init` validates and fails loud.
- Git conflicts across machines → surfaced, manual resolve; no auto-merge.
- Secret leakage → scan + block_on_match + review.
- Lock file on NFS/VPS → flock works on local fs; ensure lock_file on local disk (default is).
- Single-writer across machines not enforced by lock (per-machine lock only) → git is the cross-machine boundary.