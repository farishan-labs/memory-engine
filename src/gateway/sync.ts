import { spawnSync } from "node:child_process";
import { expand } from "./config";

export interface SyncStatus {
  dirty: boolean;
  ahead: number;
  behind: number;
  branch?: string;
}

function runGit(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function pull(dataDir: string): { ok: boolean; message: string } {
  const cwd = expand(dataDir);
  const r = runGit(["pull", "--ff-only"], cwd);
  if (r.code !== 0) {
    return { ok: false, message: `pull failed: ${r.stderr.trim() || r.stdout.trim()}` };
  }
  return { ok: true, message: r.stdout.trim() || "Already up to date." };
}

export function push(dataDir: string, machine: string): { ok: boolean; message: string } {
  const cwd = expand(dataDir);
  // scan-secrets is invoked by caller before push; here we just commit+push.
  const status = runGit(["status", "--porcelain"], cwd);
  if (status.code !== 0) return { ok: false, message: status.stderr.trim() };
  if (!status.stdout.trim()) return { ok: true, message: "Nothing to commit." };

  const add = runGit(["add", "-A"], cwd);
  if (add.code !== 0) return { ok: false, message: add.stderr.trim() };

  const ts = new Date().toISOString();
  const commit = runGit(
    ["commit", "-m", `memory: push on ${machine} (${ts})`, "--author", `faris <faris@${machine}>`],
    cwd,
  );
  if (commit.code !== 0) return { ok: false, message: commit.stderr.trim() };

  const push = runGit(["push"], cwd);
  if (push.code !== 0) return { ok: false, message: push.stderr.trim() };
  return { ok: true, message: (commit.stdout + "\n" + push.stdout).trim() };
}

export function syncStatus(dataDir: string): SyncStatus {
  const cwd = expand(dataDir);
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const porcelain = runGit(["status", "--porcelain"], cwd);
  const counts = runGit(["rev-list", "--left-right", "--count", "HEAD...@{u}"], cwd);
  let ahead = 0;
  let behind = 0;
  if (counts.code === 0) {
    const parts = counts.stdout.trim().split(/\s+/);
    ahead = parseInt(parts[0] ?? "0", 10) || 0;
    behind = parseInt(parts[1] ?? "0", 10) || 0;
  }
  return {
    dirty: !!porcelain.stdout.trim(),
    ahead,
    behind,
    branch: branch.code === 0 ? branch.stdout.trim() : undefined,
  };
}