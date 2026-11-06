import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterConfig, AdapterMeta, ImportReport, Memory, SyncStatus, WakeResult, ZoomResult } from "../../adapter/types";
import { expand } from "../../gateway/config";
import { pull as gitPull, push as gitPush, syncStatus as gitSyncStatus } from "../../gateway/sync";

function memoBin(cfg: AdapterConfig): string {
  const v = cfg.memo_bin;
  return typeof v === "string" ? expand(v) : expand("~/.optmem/memo");
}

function dataDir(cfg: AdapterConfig): string {
  const v = cfg.data_dir;
  return typeof v === "string" ? expand(v) : expand("~/.optmem/memory");
}

async function runMemo(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

export class OptmemAdapter implements Adapter {
  private cfg: AdapterConfig = {};
  private bin = "";
  private dir = "";
  private gitRemote = "git@github.com:farishan/memory-data.git";

  async init(cfg: AdapterConfig): Promise<void> {
    this.cfg = cfg;
    this.bin = memoBin(cfg);
    this.dir = dataDir(cfg);
    if (typeof cfg.git_remote === "string") this.gitRemote = cfg.git_remote;

    if (!existsSync(this.bin)) {
      throw new Error(`optmem: memo binary not found at ${this.bin}`);
    }
    // data dir must be a git worktree
    const r = await runMemo(this.bin, ["wake"]);
    if (r.code !== 0 && !r.stderr.includes("No memory")) {
      // allow "No memories yet" style; just check binary runs
    }
    // best-effort: ensure dir exists
    if (!existsSync(this.dir)) {
      throw new Error(`optmem: data dir not found at ${this.dir}`);
    }
  }

  metadata(): AdapterMeta {
    return {
      name: "optmem",
      version: "0.1.0",
      capabilities: ["wake", "note", "recall", "zoom", "nap", "forget", "config", "import", "push", "pull"],
      dataLocation: this.dir,
    };
  }

  async wake(part?: number, total?: number): Promise<WakeResult> {
    const args = ["wake"];
    if (part !== undefined) args.push(String(part));
    if (total !== undefined) args.push(String(total));
    const r = await runMemo(this.bin, args);
    if (r.code !== 0) throw new Error(`optmem: wake failed: ${r.stderr.trim() || r.stdout.trim()}`);
    const text = r.stdout;
    const m = text.match(/part \d+ of (\d+)/);
    const t = m && m[1] ? parseInt(m[1], 10) : 1;
    return { parts: [text], total: t };
  }

  async note(text: string): Promise<void> {
    const max = typeof this.cfg.max_bytes === "number" ? this.cfg.max_bytes : 280;
    if (Buffer.byteLength(text, "utf8") > max) {
      throw new Error(`optmem: note too long (${Buffer.byteLength(text, "utf8")} bytes, limit ${max})`);
    }
    const r = await runMemo(this.bin, ["note", text]);
    if (r.code !== 0) throw new Error(`optmem: note failed: ${r.stderr.trim() || r.stdout.trim()}`);
    if (r.stdout.trim()) process.stdout.write(r.stdout);
  }

  async recall(pattern: string): Promise<Memory[]> {
    const r = await runMemo(this.bin, ["recall", pattern]);
    if (r.code !== 0) throw new Error(`optmem: recall failed: ${r.stderr.trim() || r.stdout.trim()}`);
    const out: Memory[] = [];
    for (const line of r.stdout.split("\n")) {
      const m = line.match(/^#(\d+)\s+(\S+)\s+(.*)$/);
      if (m && m[1] && m[2] && m[3] !== undefined) {
        out.push({ id: m[1], text: m[3], createdAt: m[2] });
      }
    }
    return out;
  }

  async zoom(block: string): Promise<ZoomResult> {
    const r = await runMemo(this.bin, ["zoom", block]);
    if (r.code !== 0) throw new Error(`optmem: zoom failed: ${r.stderr.trim() || r.stdout.trim()}`);
    return { lines: r.stdout.split("\n").filter((l) => l.length > 0) };
  }

  async nap(block: string, text: string): Promise<void> {
    const r = await runMemo(this.bin, ["nap", block, text]);
    if (r.code !== 0) throw new Error(`optmem: nap failed: ${r.stderr.trim() || r.stdout.trim()}`);
    if (r.stdout.trim()) process.stdout.write(r.stdout);
  }

  async forget(id: string): Promise<void> {
    // tombstone marker
    const r = await runMemo(this.bin, ["note", `~forget:${id}`]);
    if (r.code !== 0) throw new Error(`optmem: forget failed: ${r.stderr.trim() || r.stdout.trim()}`);
  }

  async config(key: string, value: string): Promise<void> {
    const allowed = new Set(["memo_bin", "data_dir", "git_remote", "max_bytes"]);
    if (!allowed.has(key)) {
      throw new Error(`optmem: unknown config key ${key}`);
    }
    // adapter-local config is persisted by the gateway; here we just validate.
    if (key === "memo_bin" || key === "data_dir" || key === "git_remote") {
      // no further validation
    }
    if (key === "max_bytes") {
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 1 || n > 280) throw new Error("optmem: max_bytes must be 1..280");
    }
    // persist via env? For v1, store in a sidecar file.
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { homedir } = await import("node:os");
    const p = join(homedir(), ".local", "state", "memory", "adapter-config.json");
    mkdirSync(dirname(p), { recursive: true });
    let cur: Record<string, unknown> = {};
    try {
      const { readFileSync } = await import("node:fs");
      cur = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      // ignore
    }
    if (!cur.optmem || typeof cur.optmem !== "object") cur.optmem = {};
    (cur.optmem as Record<string, unknown>)[key] = value;
    writeFileSync(p, JSON.stringify(cur, null, 2), "utf8");
  }

  async import(src: string): Promise<ImportReport> {
    const { readFileSync } = await import("node:fs");
    const lines = readFileSync(src, "utf8").split("\n");
    let imported = 0;
    let skipped = 0;
    let firstId: string | undefined;
    let lastId: string | undefined;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // expected "YYYY-MM-DD <text>"
      const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(.*)$/);
      if (!m || !m[2]) continue;
      const text = m[2].trim();
      if (!text) continue;
      try {
        await this.note(text);
        imported++;
      } catch {
        skipped++;
      }
    }
    return { imported, skipped, firstId, lastId };
  }

  async push(): Promise<void> {
    const { push } = await import("../../gateway/sync");
    const { getIdentity } = await import("../../gateway/identity");
    const machine = getIdentity().machine;
    const res = push(this.dir, machine);
    if (!res.ok) throw new Error(`optmem: push failed: ${res.message}`);
  }

  async pull(): Promise<void> {
    const { pull } = await import("../../gateway/sync");
    const res = pull(this.dir);
    if (!res.ok) throw new Error(`optmem: pull failed: ${res.message}`);
  }

  async syncStatus(): Promise<SyncStatus> {
    const { syncStatus } = await import("../../gateway/sync");
    const s = syncStatus(this.dir);
    return s;
  }
}