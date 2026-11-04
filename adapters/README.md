# Adapters

## Contract

See `SPEC.md` §5. Every adapter implements the `Adapter` interface:

```ts
export interface Adapter {
  init(cfg: AdapterConfig, signal?: AbortSignal): Promise<void>;
  metadata(): AdapterMeta;

  wake(part?: number, total?: number): Promise<WakeResult>;
  note(text: string): Promise<void>;
  recall(pattern: string): Promise<Memory[]>;
  zoom(block: string): Promise<ZoomResult>;
  nap(block: string, text: string): Promise<void>;
  forget(id: string): Promise<void>;
  config(key: string, value: string): Promise<void>;
  import(src: string): Promise<ImportReport>;

  push(): Promise<void>;
  pull(): Promise<void>;
  syncStatus(): Promise<SyncStatus>;
}
```

### Capability negotiation

`Metadata().Capabilities` advertises supported ops. Gateway returns
`ErrUnsupported` for ops not advertised (e.g. a backend without `forget`).
optmem advertises all except native forget (emulated via tombstone).

### Error contract

- Wrap errors with adapter name: `optmem: ...`.
- `ErrNotFound`, `ErrConflict`, `ErrUnsupported`, `ErrSecretDetected` are
  sentinel errors defined in `internal/adapter`.

## optmem adapter

Name: `optmem`. Version: 0.1.0 (Phase 0 wrap).

### How it works

Shells out to `~/.optmem/memo` (configurable `memo_bin`) via `Bun.spawn`.
Parses stdout/stderr. No direct file writes except via memo binary (single
source of truth).

Mapping:
| memory op | optmem command |
|-----------|----------------|
| Wake      | `memo wake` (with `--part`/`--total` passthrough) |
| Note      | `memo note "<text>"` |
| Recall    | `memo recall <regex>` |
| Zoom      | `memo zoom <block>` |
| Nap       | `memo nap <block>` |
| Forget    | append tombstone marker line via `memo note "~forget:<id>"` |
| Config    | adapter-local only (memo_bin, data_dir); no optmem config mutation |
| Import    | read source lines → `memo note` each, dedup by exact text |
| Push/Pull | git ops on data_dir |
| SyncStatus| `git status --porcelain` + ahead/behind |

### Config keys (optmem)

- `data_dir` (default `~/.optmem/memory`)
- `memo_bin` (default `~/.optmem/memo`)
- `git_remote` (default `git@github.com:farishan/memory-data.git`)
- `max_bytes` (default 280)

### Validation (Init)

- `memo_bin` exists and executable.
- `data_dir` is a git worktree with remote matching `git_remote`.
- `MEMORY.md` present (warn if missing, not fatal).

### Limitations

- No native delete → tombstone markers (see SPEC §5 `Forget`).
- Recall is regex over raw lines; no structured query.
- Paged wake uses optmem's part/total protocol; gateway passes through.
- Cross-machine conflict resolution is manual (git).

### Adding a new adapter

1. Create `internal/adapters/<name>/` implementing `Adapter`.
2. Register in `internal/adapter/registry.go`.
3. Add config schema + docs here.
4. Add deployment notes to SPEC §13.
5. Tests: contract test suite in `internal/adapter/contract_test.go` (all
   adapters must pass).