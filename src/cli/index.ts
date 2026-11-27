#!/usr/bin/env bun
import { getAdapter, listAdapters } from "../adapter/registry";
import { getIdentity } from "../gateway/identity";
import type { Adapter } from "../adapter/types";
import { loadConfig, saveConfig, ensureConfig, configPath, expand } from "../gateway/config";
import { withWriteLock, withReadLock } from "../gateway/lock";
import { pull as gitPull, push as gitPush, syncStatus } from "../gateway/sync";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

function usage(): void {
  console.log(`memory — unified agent memory (Phase 0)

Usage:
  memory wake [--part N] [--total T]
  memory note "<text>"
  memory recall "<regex>"
  memory zoom <block>
  memory nap <block> <text...>
  memory forget <id>
  memory config <key> <value>
  memory import <path>
  memory list-adapters
  memory use-adapter <name>
  memory status
  memory push
  memory pull
  memory init
`);
}

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

function parseFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

async function getActiveAdapter(): Promise<{ adapter: Adapter; cfg: ReturnType<typeof loadConfig> }> {
  const cfg = loadConfig();
  const adapterCfg = (cfg.adapters?.[cfg.active_adapter] ?? {}) as Record<string, unknown>;
  adapterCfg.machine = getIdentity().machine;
  const adapter = getAdapter(cfg.active_adapter);
  await adapter.init(adapterCfg);
  return { adapter, cfg };
}

function scanSecrets(scanner: string): { ok: boolean; output: string } {
  const p = expand(scanner);
  if (!existsSync(p)) return { ok: true, output: "scanner not found; skipping" };
  const r = spawnSync("bash", [p], { encoding: "utf8" });
  return { ok: r.status === 0, output: (r.stdout + r.stderr).trim() };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-V")) {
    console.log("memory 0.2.0");
    return;
  }
  if (args.length === 0) {
    usage();
    return;
  }
  const cmd = args[0]!;
  const rest = args.slice(1);

  switch (cmd) {
    case "init": {
      const cfg = ensureConfig();
      const stateDir = join(homedir(), ".local", "state", "memory");
      mkdirSync(stateDir, { recursive: true });
      const lockFile = expand(cfg.sync.lock_file);
      mkdirSync(dirname(lockFile), { recursive: true });
      if (!existsSync(lockFile)) writeFileSync(lockFile, "", "utf8");
      console.log(`Created config at ${configPath()}`);
      console.log(`Active adapter: ${cfg.active_adapter}`);
      console.log("Run `memory status` to verify.");
      return;
    }

    case "list-adapters": {
      console.log(listAdapters().join("\n"));
      return;
    }

    case "use-adapter": {
      if (rest.length !== 1) die("usage: memory use-adapter <name>");
      const name = rest[0]!;
      if (!listAdapters().includes(name)) die(`Unknown adapter: ${name}`);
      const cfg = loadConfig();
      cfg.active_adapter = name;
      saveConfig(cfg);
      console.log(`Active adapter set to ${name}.`);
      return;
    }

    case "status": {
      const { adapter, cfg } = await getActiveAdapter();
      const meta = adapter.metadata();
      const ss = await adapter.syncStatus();
      console.log(`adapter: ${meta.name} ${meta.version}`);
      console.log(`data: ${meta.dataLocation}`);
      console.log(`capabilities: ${meta.capabilities.join(", ")}`);
      console.log(`identity: ${getIdentity().user}@${getIdentity().machine}`);
      console.log(`sync: dirty=${ss.dirty} ahead=${ss.ahead} behind=${ss.behind} branch=${ss.branch ?? "?"}`);
      return;
    }

    case "wake": {
      const part = parseFlag(rest, "--part");
      const total = parseFlag(rest, "--total");
      const { adapter } = await getActiveAdapter();
      const res = await withReadLock(() => adapter.wake(part ? parseInt(part, 10) : undefined, total ? parseInt(total, 10) : undefined));
      console.log(res.parts.join("\n"));
      return;
    }

    case "note": {
      if (rest.length !== 1) die('usage: memory note "<text>"');
      const text = rest[0]!;
      const { adapter, cfg } = await getActiveAdapter();
      await withWriteLock(cfg.sync.lock_file, async () => {
        try { await adapter.pull(); } catch (e) { /* best-effort */ }
        await adapter.note(text);
        const scan = scanSecrets(cfg.secrets.scanner);
        if (scan.ok || !cfg.secrets.block_on_match) {
          try { await adapter.push(); } catch (e) { console.error("push failed:", e instanceof Error ? e.message : String(e)); }
        } else {
          console.error(scan.output);
          console.error("push blocked by secrets scan.");
        }
      });
      return;
    }

    case "recall": {
      if (rest.length !== 1) die('usage: memory recall "<regex>"');
      const { adapter } = await getActiveAdapter();
      const mems = await withReadLock(() => adapter.recall(rest[0]!));
      for (const m of mems) {
        console.log(`#${m.id} ${m.createdAt} ${m.text}`);
      }
      if (mems.length === 0) console.log("No match.");
      return;
    }

    case "zoom": {
      if (rest.length !== 1) die("usage: memory zoom <block>");
      const { adapter } = await getActiveAdapter();
      const res = await withReadLock(() => adapter.zoom(rest[0]!));
      console.log(res.lines.join("\n"));
      return;
    }

    case "nap": {
      if (rest.length < 2) die('usage: memory nap <block> <text...>');
      const block = rest[0]!;
      const text = rest.slice(1).join(" ");
      const { adapter, cfg } = await getActiveAdapter();
      await withWriteLock(cfg.sync.lock_file, async () => {
        try { await adapter.pull(); } catch (e) { /* best-effort */ }
        await adapter.nap(block, text);
        const scan = scanSecrets(cfg.secrets.scanner);
        if (scan.ok || !cfg.secrets.block_on_match) {
          try { await adapter.push(); } catch (e) { console.error("push failed:", e instanceof Error ? e.message : String(e)); }
        } else {
          console.error(scan.output);
          console.error("push blocked by secrets scan.");
        }
      });
      return;
    }

    case "forget": {
      if (rest.length !== 1) die("usage: memory forget <id>");
      const { adapter, cfg } = await getActiveAdapter();
      await withWriteLock(cfg.sync.lock_file, async () => {
        try { await adapter.pull(); } catch (e) { /* best-effort */ }
        await adapter.forget(rest[0]!);
        const scan = scanSecrets(cfg.secrets.scanner);
        if (scan.ok || !cfg.secrets.block_on_match) {
          try { await adapter.push(); } catch (e) { console.error("push failed:", e instanceof Error ? e.message : String(e)); }
        } else {
          console.error(scan.output);
          console.error("push blocked by secrets scan.");
        }
      });
      console.log(`Forgot ${rest[0]!}.`);
      return;
    }

    case "config": {
      if (rest.length !== 2) die("usage: memory config <key> <value>");
      const key = rest[0]!;
      const value = rest[1]!;
      const cfg = loadConfig();
      let parts = key.split(".");
      // adapter-prefixed keys (e.g. optmem.max_bytes) target cfg.adapters.<name>
      let cur: any = cfg;
      if (parts.length >= 2 && cfg.adapters && cfg.adapters[parts[0]!]) {
        cur = cfg.adapters[parts[0]!];
        parts = parts.slice(1);
      }
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]!;
        if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
        cur = cur[p];
      }
      const last = parts[parts.length - 1]!;
      const num = Number(value);
      cur[last] = isNaN(num) || value === "" ? value : num;
      const { adapter } = await getActiveAdapter();
      if (parts.length === 1 && cfg.adapters && cfg.adapters[cfg.active_adapter]) {
        // single-segment adapter key
      }
      if (key.split(".").length === 2 && key.split(".")[0] === cfg.active_adapter) {
        try {
          await adapter.config(key.split(".")[1]!, value);
        } catch {
          // validation failed; continue
        }
      }
      saveConfig(cfg);
      console.log(`Set ${key} = ${value}`);
      return;
    }

    case "import": {
      if (rest.length !== 1) die("usage: memory import <path>");
      const { adapter, cfg } = await getActiveAdapter();
      const report = await withWriteLock(cfg.sync.lock_file, async () => {
        try { await adapter.pull(); } catch (e) { /* best-effort */ }
        const r = await adapter.import(rest[0]!);
        const scan = scanSecrets(cfg.secrets.scanner);
        if (scan.ok || !cfg.secrets.block_on_match) {
          try { await adapter.push(); } catch (e) { console.error("push failed:", e instanceof Error ? e.message : String(e)); }
        } else {
          console.error(scan.output);
          console.error("push blocked by secrets scan.");
        }
        return r;
      });
      console.log(`Imported ${report.imported}, skipped ${report.skipped}.`);
      return;
    }

    case "push": {
      const { adapter, cfg } = await getActiveAdapter();
      const scan = scanSecrets(cfg.secrets.scanner);
      if (!scan.ok && cfg.secrets.block_on_match) {
        console.error(scan.output);
        die("push blocked by secrets scan.", 4);
      }
      await withWriteLock(cfg.sync.lock_file, async () => {
        await adapter.push();
      });
      console.log("Pushed.");
      return;
    }

    case "pull": {
      const { adapter, cfg } = await getActiveAdapter();
      await withWriteLock(cfg.sync.lock_file, async () => {
        await adapter.pull();
      });
      console.log("Pulled.");
      return;
    }

    default:
      usage();
      die(`Unknown command: ${cmd}`, 1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(3);
});