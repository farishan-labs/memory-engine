import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";

export interface MemoryConfig {
  active_adapter: string;
  identity: {
    user: string;
    machine: string;
  };
  adapters: Record<string, Record<string, unknown>>;
  sync: {
    transport: string;
    auto_push: boolean;
    auto_pull: boolean;
    lock_file: string;
  };
  secrets: {
    scanner: string;
    block_on_match: boolean;
  };
}

const DEFAULT_CONFIG: MemoryConfig = {
  active_adapter: "optmem",
  identity: { user: "faris", machine: "oscar" },
  adapters: {
    optmem: {
      data_dir: "~/.optmem/memory",
      memo_bin: "~/.optmem/memo",
      git_remote: "git@github.com:farishan/memory-data.git",
      max_bytes: 280,
    },
  },
  sync: {
    transport: "git",
    auto_push: false,
    auto_pull: false,
    lock_file: "~/.local/state/memory/write.lock",
  },
  secrets: {
    scanner: "~/dev/memory/scripts/scan-secrets.sh",
    block_on_match: true,
  },
};

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

export function configPath(): string {
  const env = process.env.MEMORY_CONFIG;
  if (env) return expandHome(env);
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? xdg : join(homedir(), ".config");
  return join(base, "memory", "config.yaml");
}

export function expand(p: string): string {
  return expandHome(p);
}

export function loadConfig(): MemoryConfig {
  const p = configPath();
  if (!existsSync(p)) {
    return structuredClone(DEFAULT_CONFIG);
  }
  const raw = readFileSync(p, "utf8");
  const parsed = parse(raw) as Partial<MemoryConfig> | null;
  if (!parsed || typeof parsed !== "object") {
    return structuredClone(DEFAULT_CONFIG);
  }
  // shallow merge with defaults
  const cfg: MemoryConfig = {
    active_adapter: parsed.active_adapter ?? DEFAULT_CONFIG.active_adapter,
    identity: { ...DEFAULT_CONFIG.identity, ...(parsed.identity ?? {}) },
    adapters: { ...DEFAULT_CONFIG.adapters, ...(parsed.adapters ?? {}) },
    sync: { ...DEFAULT_CONFIG.sync, ...(parsed.sync ?? {}) },
    secrets: { ...DEFAULT_CONFIG.secrets, ...(parsed.secrets ?? {}) },
  };
  // env override for machine (emergency, logged)
  if (process.env.MEMORY_MACHINE) {
    process.stderr.write(`memory: MEMORY_MACHINE override -> ${process.env.MEMORY_MACHINE}\n`);
    cfg.identity.machine = process.env.MEMORY_MACHINE;
  }
  return cfg;
}

export function saveConfig(cfg: MemoryConfig): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, stringify(cfg), "utf8");
}

export function ensureConfig(): MemoryConfig {
  const p = configPath();
  if (!existsSync(p)) {
    const cfg = structuredClone(DEFAULT_CONFIG);
    saveConfig(cfg);
    return cfg;
  }
  return loadConfig();
}