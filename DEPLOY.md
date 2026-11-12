# Deployment — memory (Phase 0) to han (VPS) and Mac (personal mode)

Repo: https://github.com/farishan-labs/memory-engine
Binary: `~/.local/bin/memory` (compiled single binary via `bun build --compile`)

## Prerequisites (both machines)
- Git + SSH key with read access to `farishan-labs/memory-engine` and `farishan/memory-data`
- `~/.optmem/memory` clone present (optmem store) — do NOT modify it
- `~/.local/bin` on PATH
- **Bun is NOT required on target machines.** The `memory` binary is a
  self-contained compiled executable (Bun runtime embedded). Build once on
  Oscar (or any build host) and copy the binary. Only the build host needs Bun.

---

## han (VPS) — Ubuntu, ZeroClaw

### 1. Ship prebuilt binary (no Bun needed on han)
From Oscar (build host):
```sh
# build (on Oscar)
cd ~/dev/labs/memory-engine && bun run build
# copy binary + memo script + scanner to han
scp ~/.local/bin/memory ubuntu@<han-tailscale-ip>:~/.local/bin/memory
scp ~/.optmem/memo ubuntu@<han-tailscale-ip>:~/.optmem/memo
scp ~/dev/labs/memory-engine/scripts/scan-secrets.sh ubuntu@<han-tailscale-ip>:~/.local/share/memory/scan-secrets.sh
```
On han:
```sh
chmod +x ~/.local/bin/memory ~/.optmem/memo ~/.local/share/memory/scan-secrets.sh
# (optional) clone repo read-only for docs/scripts reference:
git clone git@github.com:farishan-labs/memory-engine.git ~/dev/labs/memory-engine
```

### 2. Config
```sh
mkdir -p ~/.config/memory ~/.local/state/memory
cat > ~/.config/memory/config.yaml <<'EOF'
active_adapter: optmem
identity:
  user: faris
  machine: han
adapters:
  optmem:
    data_dir: ~/.optmem/memory
    memo_bin: ~/.optmem/memo
    git_remote: git@github.com:farishan/memory-data.git
    max_bytes: 280
sync:
  transport: git
  auto_push: false
  auto_pull: false
  lock_file: ~/.local/state/memory/write.lock
secrets:
  scanner: ~/.local/share/memory/scan-secrets.sh
  block_on_match: true
EOF
chmod +x ~/dev/labs/memory-engine/scripts/scan-secrets.sh
```

### 3. Identity anchor
Ensure `~/.optmem/memory/MEMORY.md` has `Machine: han` (source of truth on conflict).

### 4. Verify
```sh
memory status        # adapter optmem, data dir, sync status
memory wake | head   # should print memory context
memory list-adapters # optmem
```

### 5. (optional) nightly pull
```sh
# crontab -e
0 3 * * * /home/ubuntu/.local/bin/memory pull >/dev/null 2>&1
```

### han-specific notes
- han runs as `ubuntu`; ensure `~/.optmem/memo` is executable and `~/.optmem/memory` is a git worktree.
- SSH key for git: `~/.ssh/` deploy key or personal key with read access.
- No OpenCode on VPS (ZeroClaw only) — `memory` is CLI-only there, fine.
- Lock file must be on local disk (default is) — do not put on NFS.

---

## Mac (personal mode) — macOS

### 1. Ship prebuilt binary (no Bun needed on Mac)
From Oscar (build host), build a macOS binary (requires Bun on a Mac or
cross-compile; Bun supports `--target`):
```sh
# on a Mac build host (or Oscar if targeting linux only):
cd ~/dev/labs/memory-engine && bun build --compile --target=bun-darwin-arm64 src/cli/index.ts --outfile memory-mac-arm64
# for Intel Macs: --target=bun-darwin-x64
```
Copy to Mac:
```sh
scp memory-mac-arm64 <user>@<mac-tailscale-ip>:~/.local/bin/memory
scp ~/.optmem/memo <user>@<mac-tailscale-ip>:~/.optmem/memo
scp ~/dev/labs/memory-engine/scripts/scan-secrets.sh <user>@<mac-tailscale-ip>:~/.local/share/memory/scan-secrets.sh
chmod +x ~/.local/bin/memory ~/.optmem/memo ~/.local/share/memory/scan-secrets.sh
```
Alternative: enable Remote Login on the Mac and run the above; or copy via
AirDrop/USB and install manually.

### 2. Config
```sh
mkdir -p ~/.config/memory ~/.local/state/memory
cat > ~/.config/memory/config.yaml <<'EOF'
active_adapter: optmem
identity:
  user: faris
  machine: mac
adapters:
  optmem:
    data_dir: ~/.optmem/memory
    memo_bin: ~/.optmem/memo
    git_remote: git@github.com:farishan/memory-data.git
    max_bytes: 280
sync:
  transport: git
  auto_push: false
  auto_pull: false
  lock_file: ~/.local/state/memory/write.lock
secrets:
  scanner: ~/.local/share/memory/scan-secrets.sh
  block_on_match: true
EOF
chmod +x ~/dev/labs/memory-engine/scripts/scan-secrets.sh
```

### 3. Identity anchor
Ensure `~/.optmem/memory/MEMORY.md` has `Machine: mac`.

### 4. Verify
```sh
memory status
memory wake | head
memory list-adapters
```

### 5. Daily habit
- `memory pull` before work, `memory push` after (manual; auto_* off by default).
- On the Hubton-owned work Mac, use personal mode only; do not store work secrets in the memory store.

### Mac-specific notes
- `proper-lockfile` works on macOS; `flock(1)` is not default — the CLI uses the Node package, fine.
- Bun compiled binary works on macOS (arm64/x64). Rebuild on the Mac (do not copy the Linux binary).
- Git auth via `gh` CLI (personal account farishan) or SSH key.

---

## Post-deploy validation (all machines)
- [ ] `memory status` green
- [ ] `memory wake` prints context
- [ ] `memory note "deploy test on <machine>"` succeeds
- [ ] `memory push` commits + pushes without secrets-scan block
- [ ] On a second machine, `memory pull` sees the new note
- [ ] `MEMORY.md` identity line matches machine

## Rollback
- `memory` is additive; `~/.optmem/memo` keeps working. If `memory` breaks, fall back to `~/.optmem/memo <cmd>` directly.
- To remove: `rm ~/.local/bin/memory`, keep `~/.optmem/` untouched.

## Open follow-ups
- [done 2026-11-04] Migrate AGENTS.md + opencode plugin to call `memory` instead of `~/.optmem/memo` (Phase 2).
- Decide Mac identity name (currently "mac"; could be "oscar-mac" if same person).
- Create GitHub remote for `farishan-labs/memory-engine` (done on Oscar; clone on others uses it).